import httpx
import pytest

from app.control_plane import ConvexWorkerClient
from app.errors import ControlPlaneError


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
