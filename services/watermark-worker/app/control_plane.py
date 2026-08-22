"""Lease-safe HTTP bridge from external workers to the Convex control plane."""
from __future__ import annotations

from dataclasses import dataclass
import os
from typing import Any

import httpx

from .errors import ControlPlaneError, InputDownloadError, LeaseLostError, OutputUploadError


@dataclass(frozen=True)
class ClaimedJob:
    job_id: str
    job_key: str
    type: str
    input_storage_id: str | None
    profile_id: str
    lease_expires_at: int
    issuance_id: str | None = None
    case_id: str | None = None


class ConvexWorkerClient:
    """Calls public Convex worker functions over HTTPS with a server token.

    The worker token is an application-level credential checked by every worker
    function. It is never sent to browsers or encoded in derived artifacts.
    """

    def __init__(self, deployment_url: str, worker_token: str, client: httpx.Client | None = None) -> None:
        if not deployment_url.startswith("https://"):
            raise ValueError("deployment_url must be an https Convex URL")
        if not worker_token:
            raise ValueError("worker_token is required")
        self._url = deployment_url.rstrip("/")
        self._token = worker_token
        # Worker connectivity must not silently inherit a developer-machine SOCKS
        # proxy. Deployments that require one can opt in explicitly.
        trust_env = os.getenv("WORKER_HTTP_TRUST_ENV", "").lower() in {"1", "true", "yes"}
        self._client = client or httpx.Client(timeout=30.0, trust_env=trust_env)

    def close(self) -> None:
        self._client.close()

    def _mutation(self, path: str, args: dict[str, Any]) -> Any:
        try:
            response = self._client.post(
                f"{self._url}/api/mutation",
                json={"path": path, "args": {"workerToken": self._token, **args}, "format": "json"},
            )
            response.raise_for_status()
            body = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise ControlPlaneError("Convex worker request failed", details={"reason": type(exc).__name__}) from exc
        if body.get("status") != "success":
            message = body.get("errorMessage", "Convex mutation failed")
            if "LEASE_NOT_ACTIVE" in message:
                raise LeaseLostError("job lease is no longer active")
            raise ControlPlaneError(message, details={"path": path})
        return body["value"]

    def claim(self, worker_id: str, capabilities: list[str]) -> ClaimedJob | None:
        value = self._mutation("jobs:claim", {"workerId": worker_id, "capabilities": capabilities})
        if value is None:
            return None
        return ClaimedJob(
            job_id=value["jobId"], job_key=value["jobKey"], type=value["type"],
            input_storage_id=value.get("inputStorageId"), profile_id=value["profileId"],
            lease_expires_at=value["leaseExpiresAt"], issuance_id=value.get("issuanceId"), case_id=value.get("caseId"),
        )

    def start(self, worker_id: str, job_id: str) -> None:
        self._mutation("jobs:start", {"workerId": worker_id, "jobId": job_id})

    def heartbeat(self, worker_id: str, job_id: str) -> None:
        self._mutation("jobs:heartbeat", {"workerId": worker_id, "jobId": job_id})

    def input(self, worker_id: str, job_id: str) -> dict[str, Any]:
        return self._mutation("jobs:getWorkerInput", {"workerId": worker_id, "jobId": job_id})

    def create_upload_url(self) -> str:
        return self._mutation("storage:createWorkerUploadUrl", {})

    def download_input(self, input_url: str) -> bytes:
        """Download a lease-authorized source object without exposing it to a browser."""
        try:
            response = self._client.get(input_url)
            response.raise_for_status()
            return response.content
        except httpx.HTTPError as exc:
            raise InputDownloadError("could not download leased job input", details={"reason": type(exc).__name__}) from exc

    def upload_output(self, upload_url: str, data: bytes, mime_type: str) -> str:
        """Upload directly to Convex storage and return the immutable storage ID."""
        try:
            response = self._client.post(upload_url, content=data, headers={"Content-Type": mime_type})
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise OutputUploadError("could not upload personalized output", details={"reason": type(exc).__name__}) from exc
        storage_id = payload.get("storageId")
        if not isinstance(storage_id, str) or not storage_id:
            raise OutputUploadError("upload response did not contain a storage ID")
        return storage_id

    def complete(self, worker_id: str, job_id: str, output_storage_id: str, output_sha256: str, result: dict[str, Any]) -> dict[str, Any]:
        return self._mutation("jobs:complete", {"workerId": worker_id, "jobId": job_id, "outputStorageId": output_storage_id, "outputSha256": output_sha256, "result": result})

    def fail(self, worker_id: str, job_id: str, error: str, retryable: bool) -> None:
        self._mutation("jobs:fail", {"workerId": worker_id, "jobId": job_id, "error": error, "retryable": retryable})
