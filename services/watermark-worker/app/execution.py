"""Lease-safe external execution of one Convex watermark job at a time.

All credentials and carrier secrets are read from the worker process environment.
This module intentionally has no browser-facing configuration surface.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import io
import os
import re
from dataclasses import asdict, dataclass
from typing import Literal, Mapping, Protocol

from PIL import Image

from .control_plane import ClaimedJob, ConvexWorkerClient
from .carriers.screen_tile import ScreenTileCarrier
from .carriers.image_code import ImageCodeCarrier
from .carriers.structure import NativeStructureCarrier
from .errors import (
    ControlPlaneError,
    InputIntegrityError,
    LeaseLostError,
    ProcessingError,
    ProfileConfigurationError,
    WorkerError,
)
from .formats.registry import AdapterRegistry
from .models import Artifact, CarrierEvidence, CarrierProfile, PersonalizationResult, TraceIdentity


class WorkerClient(Protocol):
    def claim(self, worker_id: str, capabilities: list[str]) -> ClaimedJob | None: ...
    def recover_expired_leases(self) -> int: ...
    def requeue_retries(self) -> int: ...
    def start(self, worker_id: str, job_id: str) -> None: ...
    def heartbeat(self, worker_id: str, job_id: str) -> None: ...
    def input(self, worker_id: str, job_id: str) -> dict: ...
    def download_input(self, input_url: str) -> bytes: ...
    def create_upload_url(self) -> str: ...
    def upload_output(self, upload_url: str, data: bytes, mime_type: str) -> str: ...
    def complete(self, worker_id: str, job_id: str, output_storage_id: str | None, output_sha256: str | None, result: dict) -> dict: ...
    def record_trace_candidate(self, worker_id: str, job_id: str, args: dict) -> dict: ...
    def complete_trace_case(self, worker_id: str, job_id: str, case_id: str, failed: bool = False) -> None: ...
    def fail(self, worker_id: str, job_id: str, error: str, retryable: bool) -> None: ...


def _profile_env_prefix(profile_id: str) -> str:
    return "WORKER_PROFILE_" + re.sub(r"[^A-Za-z0-9]", "_", profile_id).upper()


@dataclass(frozen=True)
class WorkerSettings:
    convex_url: str
    worker_token: str
    worker_id: str
    capabilities: tuple[str, ...] = ("cpu",)
    worker_version: str = "watermark-worker-v0.1"
    http_trigger_token: str | None = None

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "WorkerSettings":
        values = os.environ if env is None else env
        missing = [name for name in ("WORKER_CONVEX_URL", "WORKER_CONVEX_TOKEN", "WORKER_ID") if not values.get(name)]
        if missing:
            raise ProfileConfigurationError("worker environment is missing required configuration", details={"missing": missing})
        capabilities = tuple(item.strip() for item in values.get("WORKER_CAPABILITIES", "cpu").split(",") if item.strip())
        if not capabilities or any(item not in {"cpu", "gpu", "hybrid"} for item in capabilities):
            raise ProfileConfigurationError("WORKER_CAPABILITIES must contain cpu, gpu, or hybrid")
        return cls(
            convex_url=values["WORKER_CONVEX_URL"],
            worker_token=values["WORKER_CONVEX_TOKEN"],
            worker_id=values["WORKER_ID"],
            capabilities=capabilities,
            worker_version=values.get("WORKER_VERSION", "watermark-worker-v0.1"),
            http_trigger_token=values.get("WORKER_HTTP_TRIGGER_TOKEN") or None,
        )

    def profile_for(self, profile_id: str, identity_profile_version: str, env: Mapping[str, str] | None = None) -> CarrierProfile:
        """Resolve an immutable profile only from worker-only environment variables.

        Required: ``WORKER_PROFILE_<ID>_SECRET_BASE64``. Optional configuration
        defaults keep deployments compact while the profile version is always
        checked against the identity supplied by the control plane.
        """
        values = os.environ if env is None else env
        prefix = _profile_env_prefix(profile_id)
        encoded_secret = values.get(f"{prefix}_SECRET_BASE64")
        if not encoded_secret:
            raise ProfileConfigurationError("profile is not configured on this worker", details={"profileId": profile_id})
        try:
            secret = base64.b64decode(encoded_secret, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ProfileConfigurationError("profile secret is not valid base64", details={"profileId": profile_id}) from exc
        profile_version = values.get(f"{prefix}_VERSION", identity_profile_version)
        if profile_version != identity_profile_version:
            raise ProfileConfigurationError(
                "profile version does not match the trace identity",
                details={"profileId": profile_id, "expectedVersion": identity_profile_version, "configuredVersion": profile_version},
            )
        try:
            profile = CarrierProfile(
                profile_id=profile_id,
                profile_version=profile_version,
                key_version=values.get(f"{prefix}_KEY_VERSION", "v1"),
                secret=secret,
                strength=float(values.get(f"{prefix}_STRENGTH", "0.12")),
                tile_size=int(values.get(f"{prefix}_TILE_SIZE", "256")),
            )
            profile.validate()
        except ValueError as exc:
            raise ProfileConfigurationError("profile configuration is invalid", details={"profileId": profile_id}) from exc
        return profile


@dataclass(frozen=True)
class RunOutcome:
    status: Literal["idle", "succeeded", "failed", "lease_lost"]
    job_id: str | None = None
    error_code: str | None = None

    def to_dict(self) -> dict[str, str | None]:
        return {"status": self.status, "jobId": self.job_id, "errorCode": self.error_code}


class JobRunner:
    """Processes one claimed job, with lease checks before every remote boundary."""

    def __init__(self, settings: WorkerSettings, client: WorkerClient, registry: AdapterRegistry | None = None, env: Mapping[str, str] | None = None) -> None:
        self.settings = settings
        self.client = client
        self.registry = registry or AdapterRegistry()
        self._env = env

    @staticmethod
    def _identity(payload: dict) -> TraceIdentity:
        try:
            identity = TraceIdentity(
                trace_handle=payload["traceHandle"],
                scope=payload.get("scope", "issuance"),
                profile_version=payload["profileVersion"],
                created_at=int(payload.get("createdAt", 0)),
            )
            identity.validate()
            return identity
        except (KeyError, TypeError, ValueError) as exc:
            raise InputIntegrityError("leased job has an invalid trace identity") from exc

    @staticmethod
    def _filename(mime: str, job: ClaimedJob) -> str:
        extensions = {
            "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
            "application/pdf": ".pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
        }
        return f"{job.job_id}{extensions.get(mime, '')}"

    @staticmethod
    def _wm_code(payload: dict, mime: str) -> int | None:
        """Normalize Convex JSON numbers without weakening issuance validation.

        Convex's HTTP JSON endpoint represents numbers as Python ``float`` on
        the worker side.  Image codes are allocated server-side as unsigned
        32-bit integers, so an integral float is safe to recover here; a
        fractional value, boolean, or absent code remains invalid.
        """
        value = payload.get("wmCode")
        if value is None and not mime.startswith("image/"):
            return None
        if isinstance(value, bool):
            raise InputIntegrityError("image issuance has an invalid wmCode")
        if isinstance(value, int):
            return value
        if isinstance(value, float) and value.is_integer():
            return int(value)
        raise InputIntegrityError("image issuance is missing its server-mapped wmCode")

    def _result(self, personalized: PersonalizationResult, profile: CarrierProfile, artifact: Artifact) -> dict:
        # Deliberately select safe, explainable fields. CarrierProfile.secret is never serialized.
        return {
            "workerVersion": self.settings.worker_version,
            "profileId": profile.profile_id,
            "profileVersion": profile.profile_version,
            "keyVersion": profile.key_version,
            "outputMime": artifact.mime_type,
            "outputFilename": artifact.filename,
            "carrierEvidence": asdict(personalized.carrier_evidence),
            "fingerprint": personalized.fingerprint,
            "metadata": personalized.metadata,
        }

    def _web_tile_result(self, data: bytes, profile: CarrierProfile) -> dict:
        return {
            "workerVersion": self.settings.worker_version,
            "profileId": profile.profile_id,
            "profileVersion": profile.profile_version,
            "keyVersion": profile.key_version,
            "outputMime": "image/png",
            "outputFilename": "web-watermark-tile.png",
            "carrierEvidence": {
                "carrier": "screen",
                "detector_version": ScreenTileCarrier.detector_version,
                "score": 1.0,
                "raw": {"tileSize": profile.tile_size, "recovery": "issued"},
                "warnings": [],
            },
            "fingerprint": {"fingerprintVersion": "sha256-v1", "sha256": hashlib.sha256(data).hexdigest(), "mimeType": "image/png", "bytes": len(data)},
            "metadata": {"carrierVersion": ScreenTileCarrier.detector_version},
        }

    def _complete_web_tile(self, job: ClaimedJob, payload: dict, profile: CarrierProfile) -> RunOutcome:
        identity = self._identity(payload)
        if identity.scope != "web_session":
            raise InputIntegrityError("web tile job must carry a web-session trace identity")
        tile = ScreenTileCarrier().tile_rgba(identity, profile)
        output = io.BytesIO()
        tile.save(output, format="PNG")
        data = output.getvalue()
        output_sha = hashlib.sha256(data).hexdigest()
        self.client.heartbeat(self.settings.worker_id, job.job_id)
        upload_url = self.client.create_upload_url()
        output_storage_id = self.client.upload_output(upload_url, data, "image/png")
        self.client.heartbeat(self.settings.worker_id, job.job_id)
        self.client.complete(self.settings.worker_id, job.job_id, output_storage_id, output_sha, self._web_tile_result(data, profile))
        return RunOutcome("succeeded", job.job_id)

    def _complete_trace(self, job: ClaimedJob, payload: dict, profile: CarrierProfile) -> RunOutcome:
        input_url, mime, case_id = payload.get("inputUrl"), payload.get("mime"), payload.get("caseId")
        if not isinstance(input_url, str) or not isinstance(mime, str) or not isinstance(case_id, str):
            raise InputIntegrityError("trace job input is incomplete")
        self.client.heartbeat(self.settings.worker_id, job.job_id)
        evidence_bytes = self.client.download_input(input_url)
        expected_sha = payload.get("inputSha256")
        actual_sha = hashlib.sha256(evidence_bytes).hexdigest()
        if expected_sha is not None and expected_sha != actual_sha:
            raise InputIntegrityError("trace evidence SHA-256 does not match the stored case")
        candidates = payload.get("candidates", [])
        if not isinstance(candidates, list):
            raise InputIntegrityError("trace job candidates are invalid")
        carrier_kind = payload.get("profileCarrier")
        if carrier_kind == "screen":
            try:
                screenshot = Image.open(io.BytesIO(evidence_bytes)).convert("RGB")
            except OSError as exc:
                raise InputIntegrityError("screen trace evidence cannot be decoded as an image") from exc
            scored: list[tuple[dict, CarrierEvidence]] = []
            for candidate in candidates:
                try:
                    identity = TraceIdentity(
                        trace_handle=candidate["traceHandle"], scope=candidate["scope"],
                        profile_version=profile.profile_version, created_at=int(candidate["createdAt"]),
                    )
                    identity.validate()
                except (KeyError, TypeError, ValueError) as exc:
                    raise InputIntegrityError("screen trace candidate identity is invalid") from exc
                if identity.scope != "web_session" or not isinstance(candidate.get("webSessionId"), str):
                    raise InputIntegrityError("screen trace candidate is missing web-session provenance")
                scored.append((candidate, ScreenTileCarrier().detect_candidate(screenshot, identity, profile)))
            scored.sort(key=lambda item: item[1].score, reverse=True)
            matches = [candidate for candidate, _ in scored[:1]]
            if scored:
                candidate, evidence = scored[0]
                runner_up_score = scored[1][1].score if len(scored) > 1 else 0.0
                candidate_margin = max(0.0, evidence.score - runner_up_score)
                phase_margin = float(evidence.raw["margin"])
                is_clear = evidence.score >= 0.9 and candidate_margin >= 0.05 and phase_margin >= 0.01
                self.client.record_trace_candidate(self.settings.worker_id, job.job_id, {
                    "caseId": case_id, "traceHandle": candidate["traceHandle"], "webSessionId": candidate["webSessionId"],
                    "watermarkScore": evidence.score, "watermarkMargin": candidate_margin, "fingerprintScore": 0.0,
                    "geometricScore": 0.0, "structureScore": 0.0, "timelineScore": 1.0,
                    "finalConfidence": evidence.score if is_clear else 0.0,
                    "requestedDecision": "attributed" if is_clear else "insufficient",
                    "explanation": "Candidate-matched screen pattern has a clear correlation peak and separation." if is_clear else "Screen pattern correlation is ambiguous or insufficiently separated from other session candidates.",
                    "rawEvidence": {"topScreenCorrelation": asdict(evidence), "candidateScores": [{"traceHandle": entry[0]["traceHandle"], "score": entry[1].score, "raw": entry[1].raw} for entry in scored], "evidenceSha256": actual_sha},
                    "rank": 1, "protocolVersion": "0.1", "profileVersion": profile.profile_version,
                    "carrierVersion": profile.carrier_version, "detectorVersion": evidence.detector_version,
                    "fingerprintVersion": "sha256-v1", "keyVersion": profile.key_version,
                    "workerVersion": self.settings.worker_version,
                })
        elif mime.startswith("image/"):
            evidence = ImageCodeCarrier().detect(Artifact(evidence_bytes, mime), profile)
            observed_code = evidence.raw.get("wmCode")
            matches = [candidate for candidate in candidates if candidate.get("wmCode") == observed_code]
            if isinstance(observed_code, int) and len(matches) == 1:
                candidate = matches[0]
                if not isinstance(candidate.get("issuanceId"), str):
                    raise InputIntegrityError("image trace candidate is missing issuance provenance")
                fingerprint_score = 1.0 if candidate.get("outputSha256") == actual_sha else 0.0
                exact_output = fingerprint_score == 1.0
                self.client.record_trace_candidate(self.settings.worker_id, job.job_id, {
                    "caseId": case_id, "traceHandle": candidate["traceHandle"], "issuanceId": candidate["issuanceId"],
                    "watermarkScore": evidence.score, "watermarkMargin": 1.0, "fingerprintScore": fingerprint_score,
                    "geometricScore": 0.0, "structureScore": 0.0, "timelineScore": 1.0,
                    "finalConfidence": 1.0 if exact_output else 0.0,
                    "requestedDecision": "attributed" if exact_output else "insufficient",
                    "explanation": "Unique server-mapped image code and exact derived fingerprint recovered from supplied evidence." if exact_output else "Image code recovered, but the deterministic fallback requires an exact derived fingerprint before attribution.",
                    "rawEvidence": {"imageCarrier": asdict(evidence), "candidateCount": len(candidates), "evidenceSha256": actual_sha},
                    "rank": 1, "protocolVersion": "0.1", "profileVersion": profile.profile_version,
                    "carrierVersion": ImageCodeCarrier.carrier_version, "detectorVersion": evidence.detector_version,
                    "fingerprintVersion": "sha256-v1", "keyVersion": profile.key_version,
                    "modelVersion": "deterministic-fallback-v1", "workerVersion": self.settings.worker_version,
                })
        else:
            identities: list[TraceIdentity] = []
            candidate_by_identity: dict[tuple[str, str], dict] = {}
            for candidate in candidates:
                try:
                    identity = TraceIdentity(
                        trace_handle=candidate["traceHandle"], scope=candidate["scope"],
                        profile_version=profile.profile_version, created_at=int(candidate["createdAt"]),
                    )
                    identity.validate()
                except (KeyError, TypeError, ValueError) as exc:
                    raise InputIntegrityError("trace job candidate identity is invalid") from exc
                identities.append(identity)
                candidate_by_identity[(identity.trace_handle, identity.scope)] = candidate
            evidence = NativeStructureCarrier().detect(Artifact(evidence_bytes, mime), profile, candidates=identities)
            structure_matches = [match for match in evidence.raw["candidateMatches"] if match["profileVersionMatches"]]
            for rank, match in enumerate(structure_matches, start=1):
                candidate = candidate_by_identity[(match["traceHandle"], match["scope"])]
                provenance = {"issuanceId": candidate["issuanceId"]} if isinstance(candidate.get("issuanceId"), str) else {"webSessionId": candidate["webSessionId"]}
                self.client.record_trace_candidate(self.settings.worker_id, job.job_id, {
                    "caseId": case_id, "traceHandle": match["traceHandle"], **provenance,
                    "watermarkScore": 0.0, "watermarkMargin": 0.0,
                    "fingerprintScore": 1.0 if candidate.get("outputSha256") == actual_sha else 0.0,
                    "geometricScore": 0.0, "structureScore": evidence.score, "timelineScore": 1.0,
                    "finalConfidence": 0.0, "requestedDecision": "insufficient",
                    "explanation": "Native structure provenance matched an anonymous candidate, but structure evidence is never sufficient for attribution.",
                    "rawEvidence": {"nativeStructure": asdict(evidence), "evidenceSha256": actual_sha},
                    "rank": rank, "protocolVersion": "0.1", "profileVersion": profile.profile_version,
                    "carrierVersion": NativeStructureCarrier.carrier_version, "detectorVersion": evidence.detector_version,
                    "fingerprintVersion": "sha256-v1", "keyVersion": profile.key_version,
                    "workerVersion": self.settings.worker_version,
                })
            matches = structure_matches
        self.client.complete_trace_case(self.settings.worker_id, job.job_id, case_id)
        self.client.complete(self.settings.worker_id, job.job_id, None, None, {
            "workerVersion": self.settings.worker_version, "candidateCount": len(matches), "evidenceSha256": actual_sha,
            "detectorVersion": evidence.detector_version,
        })
        return RunOutcome("succeeded", job.job_id)

    def _fail(self, job: ClaimedJob, error: WorkerError) -> RunOutcome:
        try:
            self.client.fail(self.settings.worker_id, job.job_id, error.code, error.retryable)
        except LeaseLostError:
            return RunOutcome("lease_lost", job.job_id, LeaseLostError.code)
        except ControlPlaneError:
            # The job remains recoverable through the control plane's expired lease handling.
            return RunOutcome("failed", job.job_id, error.code)
        return RunOutcome("failed", job.job_id, error.code)

    def maintain(self) -> dict[str, int]:
        """Advance only server-authorized recovery states before claiming work.

        The control plane decides which leases have expired and which retries
        are due.  Running recovery before requeueing lets an expired lease
        become claimable in the same maintenance pass without a local clock or
        a browser-visible scheduler.
        """
        recovered = self.client.recover_expired_leases()
        requeued = self.client.requeue_retries()
        return {"recovered": recovered, "requeued": requeued}

    def run_once(self) -> RunOutcome:
        job = self.client.claim(self.settings.worker_id, list(self.settings.capabilities))
        if job is None:
            return RunOutcome("idle")
        try:
            if job.type not in {"personalize", "web_tile", "trace"}:
                raise InputIntegrityError("worker does not support this job type", details={"type": job.type})
            self.client.start(self.settings.worker_id, job.job_id)
            payload = self.client.input(self.settings.worker_id, job.job_id)
            if payload.get("profileId") != job.profile_id:
                raise InputIntegrityError("leased job profile does not match claimed profile")
            profile_version = payload.get("profileVersion")
            if not isinstance(profile_version, str):
                raise InputIntegrityError("leased job is missing immutable profile version")
            profile = self.settings.profile_for(job.profile_id, profile_version, self._env)
            if job.type == "web_tile":
                return self._complete_web_tile(job, payload, profile)
            if job.type == "trace":
                return self._complete_trace(job, payload, profile)
            identity = self._identity(payload)
            input_url = payload.get("inputUrl")
            mime = payload.get("mime")
            if not isinstance(input_url, str) or not isinstance(mime, str):
                raise InputIntegrityError("leased job input is incomplete")
            self.client.heartbeat(self.settings.worker_id, job.job_id)
            source_bytes = self.client.download_input(input_url)
            expected_sha = payload.get("inputSha256")
            actual_sha = hashlib.sha256(source_bytes).hexdigest()
            if expected_sha is not None and expected_sha != actual_sha:
                raise InputIntegrityError("leased input SHA-256 does not match source version")
            wm_code = self._wm_code(payload, mime)
            source = Artifact(source_bytes, mime, self._filename(mime, job))
            personalized = self.registry.for_mime(mime).personalize(source, identity, profile, wm_code=wm_code)
            output_sha = hashlib.sha256(personalized.artifact.data).hexdigest()
            self.client.heartbeat(self.settings.worker_id, job.job_id)
            upload_url = self.client.create_upload_url()
            output_storage_id = self.client.upload_output(upload_url, personalized.artifact.data, personalized.artifact.mime_type)
            self.client.heartbeat(self.settings.worker_id, job.job_id)
            self.client.complete(
                self.settings.worker_id,
                job.job_id,
                output_storage_id,
                output_sha,
                self._result(personalized, profile, personalized.artifact),
            )
            return RunOutcome("succeeded", job.job_id)
        except LeaseLostError:
            # A stale worker must never complete or fail a job now owned elsewhere.
            return RunOutcome("lease_lost", job.job_id, LeaseLostError.code)
        except WorkerError as exc:
            return self._fail(job, exc)
        except Exception:
            return self._fail(job, ProcessingError("unexpected worker processing failure"))


def create_runner_from_env(env: Mapping[str, str] | None = None) -> tuple[JobRunner, ConvexWorkerClient]:
    settings = WorkerSettings.from_env(env)
    client = ConvexWorkerClient(settings.convex_url, settings.worker_token)
    return JobRunner(settings, client, env=env), client
