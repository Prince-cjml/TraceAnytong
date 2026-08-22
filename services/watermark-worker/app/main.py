from __future__ import annotations

import base64
import io
import sys
from dataclasses import asdict

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from PIL import Image

from .carriers.image_code import ImageCodeCarrier
from .carriers.screen_tile import ScreenTileCarrier
from .errors import WorkerError
from .execution import WorkerSettings, create_runner_from_env
from .formats.registry import AdapterRegistry
from .models import Artifact, CarrierProfile, TraceIdentity

app = FastAPI(title="TraceAnytong Watermark Worker", version="0.1.0")
registry = AdapterRegistry()


class IdentityPayload(BaseModel):
    traceHandle: str
    scope: str = Field(pattern="^(issuance|web_session)$")
    profileVersion: str
    createdAt: int

    def model_value(self) -> TraceIdentity:
        return TraceIdentity(self.traceHandle, self.scope, self.profileVersion, self.createdAt)  # type: ignore[arg-type]


class ProfilePayload(BaseModel):
    profileId: str = "document-screen"
    profileVersion: str
    keyVersion: str = "v1"
    secretBase64: str
    strength: float = 0.12
    tileSize: int = 256

    def model_value(self) -> CarrierProfile:
        return CarrierProfile(self.profileId, self.profileVersion, self.keyVersion, base64.b64decode(self.secretBase64, validate=True), self.strength, self.tileSize)


class PersonalizePayload(BaseModel):
    mimeType: str
    filename: str = "artifact"
    dataBase64: str
    identity: IdentityPayload
    profile: ProfilePayload
    wmCode: int | None = None


class CandidatePayload(BaseModel):
    evidenceBase64: str
    identity: IdentityPayload
    profile: ProfilePayload


@app.exception_handler(WorkerError)
async def worker_error(_: Request, exc: WorkerError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"error": {"code": exc.code, "message": str(exc), "details": exc.details}})


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok", "workerVersion": app.version, "imageModelVersion": "deterministic-fallback-v1", "screenDetectorVersion": ScreenTileCarrier.detector_version}


@app.post("/v1/personalize")
def personalize(payload: PersonalizePayload) -> dict:
    data = base64.b64decode(payload.dataBase64, validate=True)
    artifact = Artifact(data, payload.mimeType, payload.filename)
    result = registry.for_mime(artifact.mime_type).personalize(artifact, payload.identity.model_value(), payload.profile.model_value(), wm_code=payload.wmCode)
    return {"artifact": {"mimeType": result.artifact.mime_type, "filename": result.artifact.filename, "dataBase64": base64.b64encode(result.artifact.data).decode("ascii")}, "carrierEvidence": asdict(result.carrier_evidence), "fingerprint": result.fingerprint, "metadata": result.metadata}


@app.post("/v1/detect/image")
def detect_image(payload: PersonalizePayload) -> dict:
    artifact = Artifact(base64.b64decode(payload.dataBase64, validate=True), payload.mimeType, payload.filename)
    evidence = ImageCodeCarrier().detect(artifact, payload.profile.model_value())
    return {"carrierEvidence": asdict(evidence)}


@app.post("/v1/detect/screen-candidate")
def detect_screen_candidate(payload: CandidatePayload) -> dict:
    image = Image.open(io.BytesIO(base64.b64decode(payload.evidenceBase64, validate=True)))
    evidence = ScreenTileCarrier().detect_candidate(image, payload.identity.model_value(), payload.profile.model_value())
    return {"carrierEvidence": asdict(evidence)}


@app.post("/v1/worker/run-once")
def run_worker_once(request: Request) -> dict | JSONResponse:
    """Run one lease-safe job when the service-local trigger token is configured."""
    settings = WorkerSettings.from_env()
    configured_token = settings.http_trigger_token
    if not configured_token or request.headers.get("X-Worker-Trigger-Token") != configured_token:
        return JSONResponse(status_code=403, content={"error": {"code": "FORBIDDEN", "message": "worker trigger is not authorized"}})
    runner, client = create_runner_from_env()
    try:
        return runner.run_once().to_dict()
    finally:
        client.close()


def main() -> None:
    """CLI entrypoint: ``traceanytong-worker run-once`` or ``serve``."""
    command = sys.argv[1] if len(sys.argv) > 1 else "run-once"
    if command == "run-once":
        runner, client = create_runner_from_env()
        try:
            outcome = runner.run_once()
            print(outcome.to_dict())
            if outcome.status == "failed":
                raise SystemExit(1)
        finally:
            client.close()
        return
    if command == "serve":
        import uvicorn
        uvicorn.run("app.main:app", host="0.0.0.0", port=8000)
        return
    raise SystemExit("usage: traceanytong-worker [run-once|serve]")


if __name__ == "__main__":
    main()
