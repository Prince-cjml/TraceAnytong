from __future__ import annotations

import argparse
import base64
import io
import os
import signal
import time
from dataclasses import asdict, dataclass
from threading import Event
from typing import Callable, Protocol

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from PIL import Image

from .carriers.image_code import ImageCodeCarrier
from .carriers.screen_tile import ScreenTileCarrier
from .errors import WorkerError
from .execution import RunOutcome, WorkerSettings, create_runner_from_env
from .formats.registry import AdapterRegistry
from .models import Artifact, CarrierProfile, TraceIdentity

app = FastAPI(title="TraceAnytong Watermark Worker", version="0.1.0")
registry = AdapterRegistry()


class RunsOneJob(Protocol):
    """The narrow runner surface used by the long-running CLI."""

    def run_once(self) -> RunOutcome: ...


@dataclass(frozen=True)
class WorkerLoopConfig:
    """Bounded polling and recovery settings for the background worker."""

    idle_poll_seconds: float = 5.0
    failure_backoff_seconds: float = 5.0
    max_failure_backoff_seconds: float = 60.0
    max_consecutive_failures: int = 5

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "WorkerLoopConfig":
        values = os.environ if env is None else env

        def bounded_float(name: str, default: float, maximum: float) -> float:
            raw = values.get(name, str(default))
            try:
                value = float(raw)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"{name} must be a number") from exc
            if not 0.1 <= value <= maximum:
                raise ValueError(f"{name} must be between 0.1 and {maximum:g} seconds")
            return value

        idle = bounded_float("WORKER_IDLE_POLL_SECONDS", 5.0, 300.0)
        failure = bounded_float("WORKER_FAILURE_BACKOFF_SECONDS", 5.0, 300.0)
        maximum = bounded_float("WORKER_MAX_FAILURE_BACKOFF_SECONDS", 60.0, 3600.0)
        if maximum < failure:
            raise ValueError("WORKER_MAX_FAILURE_BACKOFF_SECONDS must be at least WORKER_FAILURE_BACKOFF_SECONDS")
        raw_limit = values.get("WORKER_MAX_CONSECUTIVE_FAILURES", "5")
        try:
            limit = int(raw_limit)
        except (TypeError, ValueError) as exc:
            raise ValueError("WORKER_MAX_CONSECUTIVE_FAILURES must be an integer") from exc
        if not 1 <= limit <= 100:
            raise ValueError("WORKER_MAX_CONSECUTIVE_FAILURES must be between 1 and 100")
        return cls(idle, failure, maximum, limit)

    def with_overrides(
        self,
        *,
        idle_poll_seconds: float | None = None,
        failure_backoff_seconds: float | None = None,
        max_failure_backoff_seconds: float | None = None,
        max_consecutive_failures: int | None = None,
    ) -> "WorkerLoopConfig":
        values = {
            "WORKER_IDLE_POLL_SECONDS": str(idle_poll_seconds if idle_poll_seconds is not None else self.idle_poll_seconds),
            "WORKER_FAILURE_BACKOFF_SECONDS": str(failure_backoff_seconds if failure_backoff_seconds is not None else self.failure_backoff_seconds),
            "WORKER_MAX_FAILURE_BACKOFF_SECONDS": str(max_failure_backoff_seconds if max_failure_backoff_seconds is not None else self.max_failure_backoff_seconds),
            "WORKER_MAX_CONSECUTIVE_FAILURES": str(max_consecutive_failures if max_consecutive_failures is not None else self.max_consecutive_failures),
        }
        return self.from_env(values)


def _maintenance_step(runner: RunsOneJob) -> None:
    """Run optional lease maintenance without coupling the CLI to its implementation."""
    maintain = getattr(runner, "maintain", None)
    if callable(maintain):
        maintain()


def run_worker_loop(
    runner: RunsOneJob,
    config: WorkerLoopConfig,
    *,
    sleep: Callable[[float], None] = time.sleep,
    should_stop: Callable[[], bool] = lambda: False,
) -> int:
    """Process jobs until interrupted, bounded failures force a nonzero exit.

    ``run_once`` remains responsible for all job state transitions. In
    particular, a ``lease_lost`` outcome is neither retried as a failed job nor
    reported to the control plane again; the next claim is simply delayed.
    """
    consecutive_failures = 0
    while not should_stop():
        try:
            _maintenance_step(runner)
            outcome = runner.run_once()
        except KeyboardInterrupt:
            return 0
        except Exception as exc:  # boundary failure before run_once can return an outcome
            outcome = RunOutcome("failed", error_code="WORKER_LOOP_EXCEPTION")
            print({"status": outcome.status, "errorCode": outcome.error_code, "exception": type(exc).__name__})
        else:
            print(outcome.to_dict())

        if outcome.status == "succeeded":
            consecutive_failures = 0
            continue
        if outcome.status == "failed":
            consecutive_failures += 1
            if consecutive_failures >= config.max_consecutive_failures:
                return 1
            delay = min(
                config.failure_backoff_seconds * (2 ** (consecutive_failures - 1)),
                config.max_failure_backoff_seconds,
            )
        else:
            # Idle and lease-loss outcomes are recoverable, but both must yield
            # before the next claim so a disconnected/control-plane worker never spins.
            consecutive_failures = 0
            delay = config.idle_poll_seconds
        try:
            sleep(delay)
        except KeyboardInterrupt:
            return 0
    return 0


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
    return {"status": "ok", "workerVersion": app.version, "imageModelVersion": "deterministic-fallback-v2", "screenDetectorVersion": ScreenTileCarrier.detector_version}


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


@app.post("/v1/worker/run-once", response_model=None)
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


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="traceanytong-worker")
    parser.set_defaults(
        idle_poll_seconds=None,
        failure_backoff_seconds=None,
        max_failure_backoff_seconds=None,
        max_consecutive_failures=None,
    )
    commands = parser.add_subparsers(dest="command")
    commands.add_parser("run-once", help="claim and process at most one job")
    commands.add_parser("serve", help="serve health and explicitly triggered single-job HTTP endpoints")
    run = commands.add_parser("run", help="continuously claim and process jobs (the default)")
    run.add_argument("--idle-poll-seconds", type=float)
    run.add_argument("--failure-backoff-seconds", type=float)
    run.add_argument("--max-failure-backoff-seconds", type=float)
    run.add_argument("--max-consecutive-failures", type=int)
    return parser


def _run_continuously(args: argparse.Namespace) -> int:
    config = WorkerLoopConfig.from_env().with_overrides(
        idle_poll_seconds=args.idle_poll_seconds,
        failure_backoff_seconds=args.failure_backoff_seconds,
        max_failure_backoff_seconds=args.max_failure_backoff_seconds,
        max_consecutive_failures=args.max_consecutive_failures,
    )
    stop = Event()

    def stop_on_signal(_: int, __: object) -> None:
        stop.set()
        raise KeyboardInterrupt

    previous_handlers: dict[int, object] = {}
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            previous_handlers[sig] = signal.signal(sig, stop_on_signal)
        except ValueError:
            # Signal registration is unavailable off the main interpreter thread.
            pass

    runner, client = create_runner_from_env()
    try:
        return run_worker_loop(runner, config, should_stop=stop.is_set)
    finally:
        client.close()
        for sig, handler in previous_handlers.items():
            signal.signal(sig, handler)


def main() -> None:
    """CLI entrypoint: continuous ``run`` is the safe default."""
    parser = _parser()
    args = parser.parse_args()
    command = args.command or "run"
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
    if command == "run":
        exit_code = _run_continuously(args)
        if exit_code:
            raise SystemExit(exit_code)
        return
    raise SystemExit("usage: traceanytong-worker [run|run-once|serve]")


if __name__ == "__main__":
    main()
