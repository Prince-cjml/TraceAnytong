from __future__ import annotations

import io

import fitz
from PIL import Image

from ..carriers.screen_tile import ScreenTileCarrier
from ..errors import InvalidArtifactError
from ..fingerprint.perceptual import PerceptualFingerprinter
from ..models import Artifact, CarrierEvidence, CarrierProfile, PersonalizationResult, TraceIdentity
from .base import BaseAdapter


class PdfFormatAdapter(BaseAdapter):
    mime_types = frozenset({"application/pdf"})

    def __init__(self, carrier: ScreenTileCarrier | None = None) -> None:
        self.carrier = carrier or ScreenTileCarrier()

    def _tile_bytes(self, identity: TraceIdentity, profile: CarrierProfile) -> bytes:
        tile = self.carrier.tile_rgba(identity, profile)
        out = io.BytesIO()
        tile.save(out, "PNG")
        return out.getvalue()

    def personalize(self, artifact: Artifact, trace_identity: TraceIdentity, profile: CarrierProfile, **_: object) -> PersonalizationResult:
        self.require_support(artifact.mime_type)
        try:
            document = fitz.open(stream=artifact.data, filetype="pdf")
        except Exception as exc:
            raise InvalidArtifactError("PDF bytes cannot be opened") from exc
        if document.needs_pass:
            raise InvalidArtifactError("encrypted PDFs are not supported")
        tile = self._tile_bytes(trace_identity, profile)
        try:
            for page in document:
                rect = page.rect
                side = max(rect.width, rect.height) / 3
                y = rect.y0
                while y < rect.y1:
                    x = rect.x0
                    while x < rect.x1:
                        page.insert_image(fitz.Rect(x, y, min(x + side, rect.x1), min(y + side, rect.y1)), stream=tile, overlay=True, keep_proportion=False)
                        x += side
                    y += side
            metadata = document.metadata
            metadata["keywords"] = f"TraceAnytong:{trace_identity.trace_handle};profile:{profile.profile_version}"
            document.set_metadata(metadata)
            out = document.tobytes(garbage=4, deflate=True)
        finally:
            document.close()
        result = Artifact(out, "application/pdf", artifact.filename)
        rendered = self.render_reference(result)
        raw = {"pages": len(rendered), "tileSize": profile.tile_size, "carrierVersion": profile.carrier_version, "provenance": "pdf-info-keywords"}
        return PersonalizationResult(result, CarrierEvidence("screen", self.carrier.detector_version, 1.0, raw), PerceptualFingerprinter().index(result), {"renderedPageFingerprints": [PerceptualFingerprinter().index(page) for page in rendered]})

    def render_reference(self, artifact: Artifact) -> list[Artifact]:
        self.require_support(artifact.mime_type)
        try:
            document = fitz.open(stream=artifact.data, filetype="pdf")
            output: list[Artifact] = []
            for page_number, page in enumerate(document):
                pixmap = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
                output.append(Artifact(pixmap.tobytes("png"), "image/png", f"{artifact.filename}-page-{page_number + 1}.png"))
            return output
        except Exception as exc:
            raise InvalidArtifactError("PDF could not be rendered") from exc
        finally:
            if 'document' in locals():
                document.close()
