"""Portable deterministic wmCode fallback; production neural adapters can replace this class."""
from __future__ import annotations

import io
import zlib

import numpy as np
from PIL import Image, ImageOps, PngImagePlugin

from ..errors import InvalidArtifactError
from ..models import Artifact, CarrierEvidence, CarrierProfile, PersonalizationResult, TraceIdentity


class ImageCodeCarrier:
    """Embed an opaque server-mapped wmCode, never a TraceIdentity, in a repeated raster tag.

    The fallback combines an explicit native metadata recovery path with a low-amplitude
    visual raster tag. The raw result tells callers which path succeeded; it must not be
    confused with a robust neural model.
    """

    carrier_version = "image-code-fallback-v1"
    detector_version = "image-code-fallback-detector-v1"

    @staticmethod
    def _bits(wm_code: int) -> np.ndarray:
        if not 0 <= wm_code <= 0xFFFFFFFF:
            raise ValueError("wmCode must be an unsigned 32-bit integer")
        payload = wm_code.to_bytes(4, "big")
        crc = zlib.crc32(payload).to_bytes(4, "big")
        return np.unpackbits(np.frombuffer(payload + crc, dtype=np.uint8))

    @staticmethod
    def _raster_embed(image: Image.Image, wm_code: int) -> Image.Image:
        rgb = np.asarray(ImageOps.exif_transpose(image).convert("RGB"), dtype=np.int16).copy()
        h, w = rgb.shape[:2]
        bits = ImageCodeCarrier._bits(wm_code)
        # 64 repeated vertical bands remain measurable after modest re-encoding.
        band_w = max(2, w // len(bits))
        for index, bit in enumerate(bits):
            left, right = index * band_w, min(w, (index + 1) * band_w)
            if left >= w:
                break
            delta = 5 if bit else -5
            rgb[:, left:right, 2] = np.clip(rgb[:, left:right, 2] + delta, 0, 255)
        return Image.fromarray(rgb.astype(np.uint8), "RGB")

    def embed(self, artifact: Artifact, trace_identity: TraceIdentity, profile: CarrierProfile, *, wm_code: int) -> PersonalizationResult:
        trace_identity.validate()
        try:
            source = Image.open(io.BytesIO(artifact.data))
            source.load()
        except Exception as exc:
            raise InvalidArtifactError("image bytes cannot be decoded") from exc
        image = self._raster_embed(source, wm_code)
        out = io.BytesIO()
        format_name = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}.get(artifact.mime_type)
        if not format_name:
            raise InvalidArtifactError("unsupported image MIME for image carrier", details={"mime": artifact.mime_type})
        save_args: dict = {"format": format_name}
        if format_name == "JPEG":
            save_args.update(quality=95, optimize=True, comment=f"TraceAnytong-wmCode={wm_code}".encode())
        elif format_name == "PNG":
            info = PngImagePlugin.PngInfo()
            info.add_text("TraceAnytong-wmCode", str(wm_code))
            save_args["pnginfo"] = info
        else:
            save_args.update(quality=95, method=6)
        image.save(out, **save_args)
        from ..fingerprint.perceptual import PerceptualFingerprinter
        result = Artifact(out.getvalue(), artifact.mime_type, artifact.filename)
        return PersonalizationResult(result, CarrierEvidence("image", self.detector_version, 1.0, {"wmCode": wm_code, "recovery": "embedded"}), PerceptualFingerprinter().index(result), {"carrierVersion": self.carrier_version, "modelVersion": "deterministic-fallback-v1"})

    def detect(self, artifact: Artifact, profile: CarrierProfile, **_: object) -> CarrierEvidence:
        try:
            image = Image.open(io.BytesIO(artifact.data))
            info = image.info
            value = info.get("TraceAnytong-wmCode")
            if value is None and artifact.mime_type == "image/jpeg":
                comment = info.get("comment", b"")
                if isinstance(comment, bytes) and comment.startswith(b"TraceAnytong-wmCode="):
                    value = comment.split(b"=", 1)[1].decode("ascii")
            if value is None:
                return CarrierEvidence("image", self.detector_version, 0.0, {"recovery": "none", "wmCode": None}, ("fallback metadata is absent; neural decoder unavailable",))
            code = int(value)
            if not 0 <= code <= 0xFFFFFFFF:
                raise ValueError
            return CarrierEvidence("image", self.detector_version, 1.0, {"recovery": "native-metadata", "wmCode": code}, ("metadata recovery is not a robust watermark detection",))
        except (ValueError, OSError) as exc:
            raise InvalidArtifactError("image evidence cannot be decoded") from exc
