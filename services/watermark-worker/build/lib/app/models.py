"""Worker-local typed models. TraceIdentity deliberately mirrors, not extends, protocol."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

from .errors import InvalidTraceIdentityError

TraceScope = Literal["issuance", "web_session"]
CarrierKind = Literal["image", "screen", "structure"]


@dataclass(frozen=True)
class TraceIdentity:
    """Opaque identity from packages/protocol; it must never contain PII."""
    trace_handle: str
    scope: TraceScope
    profile_version: str
    created_at: int

    def validate(self) -> None:
        # UUID hex is accepted, as are 128-bit opaque base64url identifiers.
        compact = self.trace_handle.replace("-", "")
        if len(compact) != 32 or any(ch not in "0123456789abcdefABCDEF" for ch in compact):
            raise InvalidTraceIdentityError("traceHandle must be an opaque 128-bit hexadecimal identifier")


@dataclass(frozen=True)
class CarrierProfile:
    profile_id: str
    profile_version: str
    key_version: str
    secret: bytes
    strength: float = 0.12
    tile_size: int = 256
    carrier_version: str = "screen-tile-v1"

    def validate(self) -> None:
        if not self.secret:
            raise ValueError("profile secret is required")
        if self.tile_size < 64 or self.tile_size > 1024:
            raise ValueError("tile_size must be between 64 and 1024")
        if not 0.01 <= self.strength <= 1.0:
            raise ValueError("strength must be in [0.01, 1]")


@dataclass(frozen=True)
class Artifact:
    data: bytes
    mime_type: str
    filename: str = "artifact"


@dataclass(frozen=True)
class CarrierEvidence:
    carrier: CarrierKind
    detector_version: str
    score: float
    raw: dict[str, Any]
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class FingerprintEvidence:
    fingerprint_version: str
    score: float
    raw: dict[str, Any]


@dataclass(frozen=True)
class CandidateRank:
    candidate_id: str
    decision: Literal["HIGH", "MEDIUM", "INSUFFICIENT"]
    watermark_score: float
    fingerprint_score: float
    margin: float
    raw_evidence: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class PersonalizationResult:
    artifact: Artifact
    carrier_evidence: CarrierEvidence
    fingerprint: dict[str, Any]
    metadata: dict[str, Any] = field(default_factory=dict)
