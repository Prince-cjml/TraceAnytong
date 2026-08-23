"""Fail-closed, deterministic visual source-content indexing.

This module is intentionally worker-local.  It produces evidence for a later
control-plane source-content binding, but never chooses a trace identity or
turns a visual similarity into attribution.  Filename, document metadata, and
extracted text are deliberately excluded from the result so an index can be
stored without carrying source PII.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import io
from typing import Literal

import fitz
import numpy as np
from PIL import Image, __version__ as PILLOW_VERSION

from ..models import Artifact


SOURCE_CONTENT_INDEX_VERSION = "source-content-index-v1"
PAGE_FINGERPRINT_VERSION = "perceptual-page-v1"
IMAGE_DECODER_VERSION = f"Pillow-{PILLOW_VERSION}"
PDF_RENDER_SCALE = 2.0  # Fixed 144-DPI render scale; do not make this ambient.

IndexStatus = Literal["indexed", "unindexed"]


@dataclass(frozen=True)
class PageFingerprint:
    """A content-derived page record; all fields are deterministic and PII-free."""

    page_number: int
    sha256: str
    p_hash: str
    d_hash: str
    width: int
    height: int
    fingerprint_version: str = PAGE_FINGERPRINT_VERSION

    def to_dict(self) -> dict[str, object]:
        return {
            "pageNumber": self.page_number,
            "sha256": self.sha256,
            "pHash": self.p_hash,
            "dHash": self.d_hash,
            "width": self.width,
            "height": self.height,
            "fingerprintVersion": self.fingerprint_version,
        }


@dataclass(frozen=True)
class SourceContentIndex:
    """An immutable result suitable for an append-only source-version record."""

    status: IndexStatus
    artifact_sha256: str
    mime_type: str
    pages: tuple[PageFingerprint, ...]
    warnings: tuple[str, ...]
    raw_evidence: dict[str, object]
    index_version: str = SOURCE_CONTENT_INDEX_VERSION

    def to_dict(self) -> dict[str, object]:
        # Keep the public shape explicitly camelCase and never leak filename.
        return {
            "status": self.status,
            "artifactSha256": self.artifact_sha256,
            "mimeType": self.mime_type,
            "pages": [page.to_dict() for page in self.pages],
            "warnings": list(self.warnings),
            "rawEvidence": self.raw_evidence,
            "indexVersion": self.index_version,
        }


def _normalized_mime(mime_type: str) -> str:
    return mime_type.lower().split(";", 1)[0].strip()


def _hex_bits(bits: np.ndarray) -> str:
    return f"{int(''.join('1' if bool(bit) else '0' for bit in bits.ravel()), 2):016x}"


def _d_hash(image: Image.Image) -> str:
    pixels = np.asarray(image.convert("L").resize((9, 8), Image.Resampling.LANCZOS), dtype=np.int16)
    return _hex_bits(pixels[:, 1:] >= pixels[:, :-1])


def _dct_matrix(size: int) -> np.ndarray:
    """Return a fixed DCT-II basis without a scipy runtime dependency."""
    row = np.arange(size, dtype=np.float64)[:, None]
    col = np.arange(size, dtype=np.float64)[None, :]
    basis = np.cos((np.pi / size) * (col + 0.5) * row)
    basis[0] *= 1.0 / np.sqrt(size)
    basis[1:] *= np.sqrt(2.0 / size)
    return basis


_DCT_32 = _dct_matrix(32)


def _p_hash(image: Image.Image) -> str:
    pixels = np.asarray(image.convert("L").resize((32, 32), Image.Resampling.LANCZOS), dtype=np.float64)
    coefficients = _DCT_32 @ pixels @ _DCT_32.T
    low_frequency = coefficients[:8, :8].reshape(-1)
    # Excluding DC makes the bit decision stable under uniform brightness shifts.
    median = float(np.median(low_frequency[1:]))
    return _hex_bits(low_frequency > median)


def _page_fingerprint(page_number: int, image: Image.Image, encoded_bytes: bytes) -> PageFingerprint:
    return PageFingerprint(
        page_number=page_number,
        sha256=hashlib.sha256(encoded_bytes).hexdigest(),
        p_hash=_p_hash(image),
        d_hash=_d_hash(image),
        width=image.width,
        height=image.height,
    )


def _base_evidence(artifact: Artifact, mime_type: str) -> dict[str, object]:
    return {
        "indexVersion": SOURCE_CONTENT_INDEX_VERSION,
        "input": {
            "mimeType": mime_type,
            "sha256": hashlib.sha256(artifact.data).hexdigest(),
            "bytes": len(artifact.data),
        },
        "fingerprint": {
            "version": PAGE_FINGERPRINT_VERSION,
            "pHash": {"algorithm": "dct-32-low8-median-v1", "bits": 64},
            "dHash": {"algorithm": "luma-9x8-adjacent-v1", "bits": 64},
        },
    }


def _unindexed(artifact: Artifact, mime_type: str, *, reason: str, warning: str, evidence: dict[str, object]) -> SourceContentIndex:
    evidence["result"] = {"reason": reason, "pageCount": 0}
    return SourceContentIndex(
        status="unindexed",
        artifact_sha256=hashlib.sha256(artifact.data).hexdigest(),
        mime_type=mime_type,
        pages=(),
        warnings=(warning,),
        raw_evidence=evidence,
    )


def _index_image(artifact: Artifact, mime_type: str, evidence: dict[str, object]) -> SourceContentIndex:
    try:
        image = Image.open(io.BytesIO(artifact.data))
        image.load()
    except Exception:
        evidence["decoder"] = {"name": "Pillow", "version": IMAGE_DECODER_VERSION}
        return _unindexed(
            artifact,
            mime_type,
            reason="invalid-image",
            warning="Image decode failed; no pages were indexed.",
            evidence=evidence,
        )
    record = _page_fingerprint(1, image, artifact.data)
    evidence["decoder"] = {"name": "Pillow", "version": IMAGE_DECODER_VERSION}
    evidence["result"] = {"pageCount": 1, "pageNumbers": [1]}
    return SourceContentIndex("indexed", hashlib.sha256(artifact.data).hexdigest(), mime_type, (record,), (), evidence)


def _index_pdf(artifact: Artifact, mime_type: str, evidence: dict[str, object]) -> SourceContentIndex:
    evidence["renderer"] = {
        "name": "PyMuPDF",
        "version": str(fitz.VersionBind),
        "rasterScale": PDF_RENDER_SCALE,
        "alpha": False,
    }
    document: fitz.Document | None = None
    try:
        document = fitz.open(stream=artifact.data, filetype="pdf")
        if document.needs_pass:
            return _unindexed(
                artifact,
                mime_type,
                reason="encrypted-pdf",
                warning="Encrypted PDF was not indexed.",
                evidence=evidence,
            )
        records: list[PageFingerprint] = []
        for page_number, page in enumerate(document, start=1):
            pixmap = page.get_pixmap(matrix=fitz.Matrix(PDF_RENDER_SCALE, PDF_RENDER_SCALE), alpha=False)
            png = pixmap.tobytes("png")
            with Image.open(io.BytesIO(png)) as image:
                image.load()
                records.append(_page_fingerprint(page_number, image, png))
        if not records:
            return _unindexed(
                artifact,
                mime_type,
                reason="empty-pdf",
                warning="PDF has no renderable pages; no pages were indexed.",
                evidence=evidence,
            )
        evidence["result"] = {"pageCount": len(records), "pageNumbers": [record.page_number for record in records]}
        return SourceContentIndex("indexed", hashlib.sha256(artifact.data).hexdigest(), mime_type, tuple(records), (), evidence)
    except Exception:
        return _unindexed(
            artifact,
            mime_type,
            reason="invalid-pdf",
            warning="PDF render failed; no pages were indexed.",
            evidence=evidence,
        )
    finally:
        if document is not None:
            document.close()


def index_source_content(artifact: Artifact) -> SourceContentIndex:
    """Index an image or PDF into deterministic page fingerprints.

    DOCX/PPTX intentionally remain unindexed until a pinned office renderer is
    made part of this component's declared toolchain.  This is fail-closed: no
    source bytes, extracted text, guessed pages, or implicit conversion are used.
    """
    mime_type = _normalized_mime(artifact.mime_type)
    evidence = _base_evidence(artifact, mime_type)
    if mime_type in {"image/jpeg", "image/png", "image/webp"}:
        return _index_image(artifact, mime_type, evidence)
    if mime_type == "application/pdf":
        return _index_pdf(artifact, mime_type, evidence)
    if mime_type in {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }:
        return _unindexed(
            artifact,
            mime_type,
            reason="office-renderer-unconfigured",
            warning="Native office documents are unindexed until a pinned office renderer is configured.",
            evidence=evidence,
        )
    return _unindexed(
        artifact,
        mime_type,
        reason="unsupported-mime",
        warning="Unsupported artifact MIME type; no pages were indexed.",
        evidence=evidence,
    )
