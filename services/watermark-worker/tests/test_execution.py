import base64
import hashlib
import io

from PIL import Image, PngImagePlugin
from docx import Document

from app.control_plane import ClaimedJob
from app.errors import InputDownloadError, LeaseLostError
from app.execution import JobRunner, WorkerSettings
from app.carriers.screen_tile import ScreenTileCarrier
from app.formats.registry import AdapterRegistry
from app.models import Artifact, CarrierProfile, TraceIdentity


def png_bytes() -> bytes:
    image = Image.new("RGB", (160, 100), (120, 150, 180))
    out = io.BytesIO()
    image.save(out, "PNG")
    return out.getvalue()


def watermarked_png(wm_code: int) -> bytes:
    image = Image.new("RGB", (160, 100), (120, 150, 180))
    out = io.BytesIO()
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text("TraceAnytong-wmCode", str(wm_code))
    image.save(out, "PNG", pnginfo=metadata)
    return out.getvalue()


def structured_docx(trace_handle: str, profile_version: str) -> bytes:
    document = Document()
    document.add_paragraph("Trace evidence fixture")
    source = io.BytesIO()
    document.save(source)
    profile = CarrierProfile("structure-v1", profile_version, "key-1", b"deterministic-structure-key", tile_size=64)
    identity = TraceIdentity(trace_handle, "issuance", profile_version, 1_725_000_000)
    personalized = AdapterRegistry().for_mime("application/vnd.openxmlformats-officedocument.wordprocessingml.document").personalize(
        Artifact(source.getvalue(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "fixture.docx"),
        identity,
        profile,
    )
    return personalized.artifact.data


def screen_capture(trace_handle: str, profile_version: str) -> bytes:
    profile = CarrierProfile("screen-v1", profile_version, "key-1", b"deterministic-screen-key", tile_size=64)
    identity = TraceIdentity(trace_handle, "web_session", profile_version, 1_725_000_000)
    tile = ScreenTileCarrier().tile_rgba(identity, profile)
    capture = Image.new("RGBA", (256, 256), (235, 240, 250, 255))
    for y in range(0, 256, 64):
        for x in range(0, 256, 64):
            capture.alpha_composite(tile, (x, y))
    out = io.BytesIO()
    capture.convert("RGB").save(out, "PNG")
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
        self.trace_candidates: list[dict] = []
        self.completed_cases: list[str] = []
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

    def record_trace_candidate(self, args: dict) -> dict:
        self.calls.append("record-candidate")
        self.trace_candidates.append(args)
        return {"candidateId": "candidates:1", "decision": "attributed"}

    def complete_trace_case(self, case_id: str, failed: bool = False) -> None:
        assert not failed
        self.calls.append("complete-case")
        self.completed_cases.append(case_id)


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


def test_integral_convex_json_wm_code_is_normalized_before_personalization() -> None:
    """Convex HTTP encodes its numeric values as Python floats."""
    client = FakeClient(png_bytes())
    original_input = client.input

    def float_code(worker_id: str, job_id: str) -> dict:
        payload = original_input(worker_id, job_id)
        payload["wmCode"] = 42.0
        return payload

    client.input = float_code  # type: ignore[method-assign]
    outcome = runner_for(client).run_once()

    assert outcome.status == "succeeded"
    assert client.completed is not None
    assert client.completed["result"]["carrierEvidence"]["raw"]["wmCode"] == 42


def test_web_tile_job_uploads_a_png_without_downloading_document_bytes() -> None:
    env = environment()
    env.update({
        "WORKER_PROFILE_SCREEN_V1_SECRET_BASE64": base64.b64encode(b"deterministic-screen-key").decode(),
        "WORKER_PROFILE_SCREEN_V1_VERSION": "profile-2026-08",
        "WORKER_PROFILE_SCREEN_V1_TILE_SIZE": "64",
    })
    client = FakeClient(png_bytes())
    client.job = ClaimedJob("jobs:tile", "tile-key", "web_tile", None, "screen-v1", 9_999_999)
    original_input = client.input

    def tile_input(worker_id: str, job_id: str) -> dict:
        payload = original_input(worker_id, job_id)
        payload.update({"scope": "web_session", "profileId": "screen-v1", "profileVersion": "profile-2026-08", "wmCode": None})
        return payload

    client.input = tile_input  # type: ignore[method-assign]
    outcome = runner_for(client, env).run_once()

    assert outcome.status == "succeeded"
    assert "download" not in client.calls
    assert client.completed is not None
    assert client.completed["result"]["outputMime"] == "image/png"


def test_trace_job_records_only_a_unique_server_resolved_code_match() -> None:
    env = environment()
    source = watermarked_png(42)
    client = FakeClient(source)
    client.job = ClaimedJob("jobs:trace", "trace-key", "trace", "storage:evidence", "image-v1", 9_999_999, case_id="cases:1")
    original_input = client.input

    def trace_input(worker_id: str, job_id: str) -> dict:
        payload = original_input(worker_id, job_id)
        payload.update({
            "caseId": "cases:1",
            "candidates": [{"issuanceId": "issuances:1", "traceHandle": "0123456789abcdef0123456789abcdef", "wmCode": 42, "outputSha256": hashlib.sha256(source).hexdigest()}],
        })
        return payload

    client.input = trace_input  # type: ignore[method-assign]
    outcome = runner_for(client, env).run_once()

    assert outcome.status == "succeeded"
    assert client.trace_candidates[0]["issuanceId"] == "issuances:1"
    assert client.trace_candidates[0]["fingerprintScore"] == 1.0
    assert client.completed_cases == ["cases:1"]
    assert client.completed is not None
    assert client.completed["storageId"] is None


def test_trace_job_never_requests_attribution_from_metadata_only_recovery() -> None:
    env = environment()
    source = watermarked_png(42)
    client = FakeClient(source)
    client.job = ClaimedJob("jobs:trace", "trace-key", "trace", "storage:evidence", "image-v1", 9_999_999, case_id="cases:1")
    original_input = client.input

    def transformed_trace_input(worker_id: str, job_id: str) -> dict:
        payload = original_input(worker_id, job_id)
        payload.update({
            "caseId": "cases:1",
            "candidates": [{"issuanceId": "issuances:1", "traceHandle": "0123456789abcdef0123456789abcdef", "wmCode": 42, "outputSha256": "0" * 64}],
        })
        return payload

    client.input = transformed_trace_input  # type: ignore[method-assign]
    outcome = runner_for(client, env).run_once()

    assert outcome.status == "succeeded"
    assert client.trace_candidates[0]["fingerprintScore"] == 0.0
    assert client.trace_candidates[0]["requestedDecision"] == "insufficient"


def test_trace_job_records_native_document_structure_as_insufficient_only() -> None:
    trace_handle = "0123456789abcdef0123456789abcdef"
    source = structured_docx(trace_handle, "profile-2026-08")
    env = environment()
    env.update({
        "WORKER_PROFILE_STRUCTURE_V1_SECRET_BASE64": base64.b64encode(b"deterministic-structure-key").decode(),
        "WORKER_PROFILE_STRUCTURE_V1_VERSION": "profile-2026-08",
        "WORKER_PROFILE_STRUCTURE_V1_TILE_SIZE": "64",
    })
    client = FakeClient(source)
    client.job = ClaimedJob("jobs:trace-docx", "trace-docx-key", "trace", "storage:evidence", "structure-v1", 9_999_999, case_id="cases:docx")
    original_input = client.input

    def document_trace_input(worker_id: str, job_id: str) -> dict:
        payload = original_input(worker_id, job_id)
        payload.update({
            "caseId": "cases:docx",
            "mime": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "profileId": "structure-v1",
            "candidates": [{"issuanceId": "issuances:structure", "traceHandle": trace_handle, "scope": "issuance", "createdAt": 1_725_000_000, "wmCode": None, "outputSha256": hashlib.sha256(source).hexdigest()}],
        })
        return payload

    client.input = document_trace_input  # type: ignore[method-assign]
    outcome = runner_for(client, env).run_once()

    assert outcome.status == "succeeded"
    assert client.trace_candidates[0]["structureScore"] >= 0.8
    assert client.trace_candidates[0]["requestedDecision"] == "insufficient"
    assert client.trace_candidates[0]["rawEvidence"]["nativeStructure"]["raw"]["scoreMeaning"].endswith("not attribution")


def test_trace_job_ranks_candidate_matched_screen_capture() -> None:
    trace_handle = "0123456789abcdef0123456789abcdef"
    source = screen_capture(trace_handle, "profile-2026-08")
    env = environment()
    env.update({
        "WORKER_PROFILE_SCREEN_V1_SECRET_BASE64": base64.b64encode(b"deterministic-screen-key").decode(),
        "WORKER_PROFILE_SCREEN_V1_VERSION": "profile-2026-08",
        "WORKER_PROFILE_SCREEN_V1_TILE_SIZE": "64",
    })
    client = FakeClient(source)
    client.job = ClaimedJob("jobs:trace-screen", "trace-screen-key", "trace", "storage:evidence", "screen-v1", 9_999_999, case_id="cases:screen")
    original_input = client.input

    def screen_trace_input(worker_id: str, job_id: str) -> dict:
        payload = original_input(worker_id, job_id)
        payload.update({
            "caseId": "cases:screen", "profileId": "screen-v1", "profileCarrier": "screen",
            "candidates": [{"webSessionId": "sessions:1", "traceHandle": trace_handle, "scope": "web_session", "createdAt": 1_725_000_000, "wmCode": None, "outputSha256": None}],
        })
        return payload

    client.input = screen_trace_input  # type: ignore[method-assign]
    outcome = runner_for(client, env).run_once()

    assert outcome.status == "succeeded"
    assert client.trace_candidates[0]["webSessionId"] == "sessions:1"
    assert client.trace_candidates[0]["watermarkScore"] >= 0.2
    assert client.trace_candidates[0]["requestedDecision"] == "insufficient"
    assert "candidateScores" in client.trace_candidates[0]["rawEvidence"]
