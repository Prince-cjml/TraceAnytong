import base64
import hashlib
import io

from PIL import Image

from app.control_plane import ClaimedJob
from app.errors import InputDownloadError, LeaseLostError
from app.execution import JobRunner, WorkerSettings


def png_bytes() -> bytes:
    image = Image.new("RGB", (160, 100), (120, 150, 180))
    out = io.BytesIO()
    image.save(out, "PNG")
    return out.getvalue()


def environment() -> dict[str, str]:
    return {
        "WORKER_CONVEX_URL": "https://joyous-anaconda-773.convex.cloud",
        "WORKER_CONVEX_TOKEN": "worker-only-token",
        "WORKER_ID": "test-worker",
        "WORKER_PROFILE_IMAGE_V1_SECRET_BASE64": base64.b64encode(b"deterministic-worker-key").decode(),
        "WORKER_PROFILE_IMAGE_V1_VERSION": "profile-2026-08",
        "WORKER_PROFILE_IMAGE_V1_KEY_VERSION": "key-1",
        "WORKER_PROFILE_IMAGE_V1_TILE_SIZE": "64",
    }


class FakeClient:
    def __init__(self, source: bytes, *, download_error: Exception | None = None, heartbeat_error: Exception | None = None) -> None:
        self.source = source
        self.download_error = download_error
        self.heartbeat_error = heartbeat_error
        self.calls: list[str] = []
        self.completed: dict | None = None
        self.failed: tuple[str, bool] | None = None
        self.job = ClaimedJob("jobs:1", "key", "personalize", "storage:1", "image-v1", 9_999_999)

    def claim(self, worker_id: str, capabilities: list[str]):
        self.calls.append("claim")
        return self.job

    def start(self, worker_id: str, job_id: str) -> None:
        self.calls.append("start")

    def heartbeat(self, worker_id: str, job_id: str) -> None:
        self.calls.append("heartbeat")
        if self.heartbeat_error:
            raise self.heartbeat_error

    def input(self, worker_id: str, job_id: str) -> dict:
        self.calls.append("input")
        return {
            "inputUrl": "https://storage.example/input",
            "mime": "image/png",
            "inputSha256": hashlib.sha256(self.source).hexdigest(),
            "traceHandle": "0123456789abcdef0123456789abcdef",
            "profileVersion": "profile-2026-08",
            "createdAt": 1_725_000_000,
            "wmCode": 42,
            "profileId": "image-v1",
        }

    def download_input(self, input_url: str) -> bytes:
        self.calls.append("download")
        if self.download_error:
            raise self.download_error
        return self.source

    def create_upload_url(self) -> str:
        self.calls.append("upload-url")
        return "https://storage.example/upload"

    def upload_output(self, upload_url: str, data: bytes, mime_type: str) -> str:
        self.calls.append("upload")
        assert mime_type == "image/png"
        assert data != self.source
        return "storage:derived"

    def complete(self, worker_id: str, job_id: str, output_storage_id: str, output_sha256: str, result: dict) -> dict:
        self.calls.append("complete")
        self.completed = {"storageId": output_storage_id, "sha256": output_sha256, "result": result}
        return {"status": "succeeded"}

    def fail(self, worker_id: str, job_id: str, error: str, retryable: bool) -> None:
        self.calls.append("fail")
        self.failed = (error, retryable)


def runner_for(client: FakeClient, env: dict[str, str] | None = None) -> JobRunner:
    values = env or environment()
    return JobRunner(WorkerSettings.from_env(values), client, env=values)


def test_run_once_personalizes_hashes_direct_uploads_and_keeps_secret_out_of_result() -> None:
    env = environment()
    client = FakeClient(png_bytes())
    outcome = runner_for(client, env).run_once()

    assert outcome.status == "succeeded"
    assert client.calls == ["claim", "start", "input", "heartbeat", "download", "heartbeat", "upload-url", "upload", "heartbeat", "complete"]
    assert client.completed is not None
    assert client.completed["storageId"] == "storage:derived"
    assert len(client.completed["sha256"]) == 64
    result = client.completed["result"]
    assert result["carrierEvidence"]["raw"]["wmCode"] == 42
    assert base64.b64decode(env["WORKER_PROFILE_IMAGE_V1_SECRET_BASE64"]) not in str(result).encode()
    assert "secret" not in result


def test_download_failure_is_recorded_as_retryable_without_uploading() -> None:
    client = FakeClient(png_bytes(), download_error=InputDownloadError("temporary storage outage"))
    outcome = runner_for(client).run_once()

    assert outcome.status == "failed"
    assert outcome.error_code == "INPUT_DOWNLOAD_ERROR"
    assert client.failed == ("INPUT_DOWNLOAD_ERROR", True)
    assert "upload" not in client.calls


def test_lease_loss_never_attempts_to_complete_or_fail() -> None:
    client = FakeClient(png_bytes(), heartbeat_error=LeaseLostError("job lease is no longer active"))
    outcome = runner_for(client).run_once()

    assert outcome.status == "lease_lost"
    assert client.failed is None
    assert "complete" not in client.calls


def test_profile_configuration_rejects_version_drift_and_keeps_key_internal() -> None:
    env = environment()
    env["WORKER_PROFILE_IMAGE_V1_VERSION"] = "other-profile"
    client = FakeClient(png_bytes())
    outcome = runner_for(client, env).run_once()

    assert outcome.status == "failed"
    assert client.failed == ("PROFILE_CONFIGURATION_ERROR", False)
    assert client.completed is None
