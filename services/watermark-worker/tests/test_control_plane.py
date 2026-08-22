import httpx
import pytest

from app.control_plane import ConvexWorkerClient
from app.errors import ControlPlaneError, OutputUploadError


def mock_client(status: str = "success", value: object = None) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == "https://joyous-anaconda-773.convex.cloud/api/mutation"
        payload = request.json() if hasattr(request, "json") else None
        # httpx Request has no json() helper; validate bytes instead.
        assert b'"workerToken":"test-token"' in request.content
        return httpx.Response(200, json={"status": status, "value": value, "errorMessage": "denied"})
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_claim_serializes_worker_credential_and_deserializes_lease() -> None:
    client = ConvexWorkerClient("https://joyous-anaconda-773.convex.cloud", "test-token", mock_client(value={
        "jobId": "jobs:1", "jobKey": "key", "type": "personalize", "inputStorageId": "storage:1", "profileId": "image-v1", "leaseExpiresAt": 123,
    }))
    job = client.claim("worker-a", ["cpu"])
    assert job is not None
    assert job.job_id == "jobs:1"
    assert job.lease_expires_at == 123


def test_control_plane_errors_remain_typed() -> None:
    client = ConvexWorkerClient("https://joyous-anaconda-773.convex.cloud", "test-token", mock_client(status="error"))
    with pytest.raises(ControlPlaneError, match="denied"):
        client.create_upload_url()


def test_direct_worker_transfers_keep_storage_urls_outside_mutation_payloads() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url == "https://source.example/leased":
            return httpx.Response(200, content=b"source bytes")
        assert request.url == "https://upload.example/direct"
        assert request.method == "POST"
        assert request.headers["content-type"] == "image/png"
        assert request.content == b"derived bytes"
        return httpx.Response(200, json={"storageId": "storage:derived"})

    client = ConvexWorkerClient("https://joyous-anaconda-773.convex.cloud", "test-token", httpx.Client(transport=httpx.MockTransport(handler)))
    assert client.download_input("https://source.example/leased") == b"source bytes"
    assert client.upload_output("https://upload.example/direct", b"derived bytes", "image/png") == "storage:derived"
    assert all(b"test-token" not in request.content for request in requests)


def test_upload_response_without_storage_id_remains_typed() -> None:
    client = ConvexWorkerClient(
        "https://joyous-anaconda-773.convex.cloud",
        "test-token",
        httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={}))),
    )
    with pytest.raises(OutputUploadError):
        client.upload_output("https://upload.example/direct", b"derived bytes", "image/png")
