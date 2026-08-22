"""Lease-safe HTTP bridge from external workers to the Convex control plane."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from .errors import ControlPlaneError


@dataclass(frozen=True)
class ClaimedJob:
    job_id: str
    job_key: str
    type: str
    input_storage_id: str
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
        self._client = client or httpx.Client(timeout=30.0)

    def close(self) -> None:
        self._client.close()

    def _mutation(self, path: str, args: dict[str, Any]) -> Any:
        response = self._client.post(
            f"{self._url}/api/mutation",
            json={"path": path, "args": {"workerToken": self._token, **args}, "format": "json"},
        )
        response.raise_for_status()
        body = response.json()
        if body.get("status") != "success":
            raise ControlPlaneError(body.get("errorMessage", "Convex mutation failed"), details=body)
        return body["value"]

    def claim(self, worker_id: str, capabilities: list[str]) -> ClaimedJob | None:
        value = self._mutation("jobs:claim", {"workerId": worker_id, "capabilities": capabilities})
        if value is None:
            return None
        return ClaimedJob(
            job_id=value["jobId"], job_key=value["jobKey"], type=value["type"],
            input_storage_id=value["inputStorageId"], profile_id=value["profileId"],
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

    def complete(self, worker_id: str, job_id: str, output_storage_id: str, output_sha256: str, result: dict[str, Any]) -> dict[str, Any]:
        return self._mutation("jobs:complete", {"workerId": worker_id, "jobId": job_id, "outputStorageId": output_storage_id, "outputSha256": output_sha256, "result": result})

    def fail(self, worker_id: str, job_id: str, error: str, retryable: bool) -> None:
        self._mutation("jobs:fail", {"workerId": worker_id, "jobId": job_id, "error": error, "retryable": retryable})
