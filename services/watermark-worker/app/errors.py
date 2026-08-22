from __future__ import annotations


class WorkerError(Exception):
    """Base error that may safely cross the worker boundary."""

    code = "WORKER_ERROR"
    status_code = 400
    retryable = False

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
    retryable = True


class ControlPlaneError(WorkerError):
    code = "CONVEX_MUTATION_FAILED"
    status_code = 502
    retryable = True


class LeaseLostError(ControlPlaneError):
    """The job is no longer owned by this worker and must not be mutated."""

    code = "LEASE_NOT_ACTIVE"
    retryable = False


class ProfileConfigurationError(WorkerError):
    """A profile required by a job is not configured in worker-only settings."""

    code = "PROFILE_CONFIGURATION_ERROR"
    status_code = 500


class InputIntegrityError(InvalidArtifactError):
    code = "INPUT_INTEGRITY_ERROR"


class InputDownloadError(WorkerError):
    code = "INPUT_DOWNLOAD_ERROR"
    status_code = 502
    retryable = True


class OutputUploadError(WorkerError):
    code = "OUTPUT_UPLOAD_ERROR"
    status_code = 502
    retryable = True
