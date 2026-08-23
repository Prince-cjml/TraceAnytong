"""Local cross-runtime fixture bridge for image trace handler integration tests.

This is test support, not a control-plane substitute: it runs the real Python
``JobRunner`` against the exact frozen candidate projection produced by the
Convex test harness, then emits the candidate body the runner would submit.
No network connection, credential, or production storage URL is used.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Any

from PIL import Image

# The script is launched by Vitest from the repository root. Make the worker
# package importable without requiring an editable install or an environment
# mutation in the parent process.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.carriers.image_code import ImageCodeCarrier
from app.control_plane import ClaimedJob
from app.execution import JobRunner, WorkerSettings
from app.fingerprint.perceptual import PerceptualFingerprinter
from app.models import Artifact, CarrierProfile, TraceIdentity


PROFILE_ID = "image-contract-profile-v1"
PROFILE_VERSION = "contract-profile-2026-08"
KEY_VERSION = "contract-key-v1"
TRACE_HANDLE = "0123456789abcdef0123456789abcdef"
WM_CODE = 42


def _profile() -> CarrierProfile:
    return CarrierProfile(
        profile_id=PROFILE_ID,
        profile_version=PROFILE_VERSION,
        key_version=KEY_VERSION,
        secret=b"deterministic-local-contract-key",
        tile_size=64,
    )


def _source_png() -> bytes:
    """Produce the deterministic raster fixture used by the worker transform tests."""
    image = Image.new("RGB", (512, 512), (120, 150, 180))
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def _transformed_evidence(derived: bytes) -> bytes:
    """Strip metadata and apply the controlled JPEG/resize trace transform."""
    image = Image.open(io.BytesIO(derived)).convert("RGB")
    image = image.resize((384, 384), Image.Resampling.LANCZOS)
    out = io.BytesIO()
    image.save(out, format="JPEG", quality=60, optimize=False)
    return out.getvalue()


def build_fixture() -> dict[str, Any]:
    identity = TraceIdentity(
        trace_handle=TRACE_HANDLE,
        scope="issuance",
        profile_version=PROFILE_VERSION,
        created_at=1_725_000_000_000,
    )
    personalized = ImageCodeCarrier().embed(
        Artifact(_source_png(), "image/png", "contract-source.png"),
        identity,
        _profile(),
        wm_code=WM_CODE,
    )
    fingerprint = PerceptualFingerprinter().index(personalized.artifact)
    evidence = _transformed_evidence(personalized.artifact.data)
    return {
        "profile": {
            "profileId": PROFILE_ID,
            "profileVersion": PROFILE_VERSION,
            "keyVersion": KEY_VERSION,
            "carrierVersion": ImageCodeCarrier.carrier_version,
            "detectorVersion": ImageCodeCarrier.detector_version,
            "fingerprintVersion": PerceptualFingerprinter.version,
        },
        "candidate": {
            "traceHandle": TRACE_HANDLE,
            "scope": "issuance",
            "createdAt": identity.created_at,
            "wmCode": WM_CODE,
            "outputSha256": fingerprint["sha256"],
            "outputFingerprint": fingerprint,
        },
        "evidenceBase64": base64.b64encode(evidence).decode("ascii"),
        "evidenceSha256": hashlib.sha256(evidence).hexdigest(),
    }


class CaptureClient:
    """Minimal in-process worker port that only supplies test-owned bytes."""

    def __init__(self, worker_input: dict[str, Any], evidence: bytes) -> None:
        self.worker_input = worker_input
        self.evidence = evidence
        self.candidates: list[dict[str, Any]] = []
        self.job = ClaimedJob(
            job_id=worker_input["jobId"],
            job_key="local-contract-trace",
            type="trace",
            input_storage_id=None,
            profile_id=worker_input["profileId"],
            lease_expires_at=9_999_999_999_999,
            case_id=worker_input["caseId"],
        )

    def claim(self, _worker_id: str, _capabilities: list[str]) -> ClaimedJob:
        return self.job

    def recover_expired_leases(self) -> int:
        return 0

    def requeue_retries(self) -> int:
        return 0

    def start(self, _worker_id: str, _job_id: str) -> None:
        return None

    def heartbeat(self, _worker_id: str, _job_id: str) -> None:
        return None

    def input(self, _worker_id: str, _job_id: str) -> dict[str, Any]:
        return self.worker_input

    def download_input(self, _input_url: str) -> bytes:
        return self.evidence

    def create_upload_url(self) -> str:
        raise AssertionError("trace jobs never upload a personalized artifact")

    def upload_output(self, _upload_url: str, _data: bytes, _mime_type: str) -> str:
        raise AssertionError("trace jobs never upload a personalized artifact")

    def complete(self, _worker_id: str, _job_id: str, _storage_id: str | None, _sha256: str | None, _result: dict[str, Any]) -> dict[str, Any]:
        return {"status": "succeeded"}

    def record_trace_candidate(self, _worker_id: str, _job_id: str, args: dict[str, Any]) -> dict[str, Any]:
        self.candidates.append(args)
        return {"candidateId": "local-contract-candidate", "decision": args["requestedDecision"]}

    def complete_trace_case(self, _worker_id: str, _job_id: str, _case_id: str, failed: bool = False) -> None:
        if failed:
            raise AssertionError("controlled trace fixture must complete successfully")

    def fail(self, _worker_id: str, _job_id: str, error: str, _retryable: bool) -> None:
        raise AssertionError(f"controlled trace fixture unexpectedly failed: {error}")


def run_trace(payload: dict[str, Any]) -> dict[str, Any]:
    worker_input = payload["workerInput"]
    evidence = base64.b64decode(payload["evidenceBase64"], validate=True)
    profile = payload["profile"]
    environment = {
        "WORKER_CONVEX_URL": "https://local-contract.invalid",
        "WORKER_CONVEX_TOKEN": "local-contract-token",
        "WORKER_ID": "local-contract-worker",
        "WORKER_VERSION": "local-contract-worker-v1",
        "WORKER_PROFILE_IMAGE_CONTRACT_PROFILE_V1_SECRET_BASE64": base64.b64encode(_profile().secret).decode("ascii"),
        "WORKER_PROFILE_IMAGE_CONTRACT_PROFILE_V1_VERSION": profile["profileVersion"],
        "WORKER_PROFILE_IMAGE_CONTRACT_PROFILE_V1_KEY_VERSION": profile["keyVersion"],
        "WORKER_PROFILE_IMAGE_CONTRACT_PROFILE_V1_TILE_SIZE": "64",
    }
    client = CaptureClient(worker_input, evidence)
    outcome = JobRunner(WorkerSettings.from_env(environment), client, env=environment).run_once()
    if outcome.status != "succeeded" or len(client.candidates) != 1:
        raise RuntimeError(f"trace bridge did not emit exactly one candidate: {asdict(outcome)}")
    return {"outcome": asdict(outcome), "candidate": client.candidates[0]}


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in {"build", "run"}:
        raise SystemExit("usage: trace_contract_bridge.py build|run")
    payload = build_fixture() if sys.argv[1] == "build" else run_trace(json.load(sys.stdin))
    print(json.dumps(payload, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
