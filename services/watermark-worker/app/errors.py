from __future__ import annotations


class WorkerError(Exception):
    """Base error that may safely cross the worker boundary."""

    code = "WORKER_ERROR"
    status_code = 400

    def __init__(self, message: str, *, details: dict | None = None) -> None:
        super().__init__(message)
        self.details = details or {}


class UnsupportedFormatError(WorkerError):
    code = "UNSUPPORTED_FORMAT"
    status_code = 415


class InvalidArtifactError(WorkerError):
    code = "INVALID_ARTIFACT"
    status_code = 422


class InvalidTraceIdentityError(WorkerError):
    code = "INVALID_TRACE_IDENTITY"
    status_code = 422


class ProcessingError(WorkerError):
    code = "PROCESSING_ERROR"
    status_code = 500


class ControlPlaneError(WorkerError):
    code = "CONVEX_MUTATION_FAILED"
    status_code = 502
