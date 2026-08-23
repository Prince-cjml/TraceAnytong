"""Deterministic image wmCode carrier with legacy metadata and visual recovery.

The 32-bit ``wmCode`` is anonymous: resolving it to a trace identity remains a
control-plane responsibility. This fallback is deliberately modest rather
than cryptographic. It gives the worker a reproducible raster signal after
normal image metadata has been stripped, while raw detector evidence makes its
limits visible to the policy layer.
"""
from __future__ import annotations

import io
import zlib

import numpy as np
from PIL import Image, ImageOps, PngImagePlugin

from ..errors import InvalidArtifactError
from ..models import Artifact, CarrierEvidence, CarrierProfile, PersonalizationResult, TraceIdentity


class ImageCodeCarrier:
    """Embed an opaque server-mapped wmCode, never a TraceIdentity.

    Version two retains the former native metadata marker for lossless and
    legacy recovery. It additionally writes a zero-mean, repeated 16x16
    raster grid. The grid has two fixed synchronization regions and three
    copies of ``wmCode || CRC32(wmCode)``. Three-way majority voting is a
    simple explicit error-correction scheme; CRC validation prevents an
    arbitrary raster from being presented as a recovered code.
    """

    carrier_version = "image-code-fallback-v2"
    detector_version = "image-code-fallback-detector-v2"
    _GRID = 16
    _SYNC_BITS = np.unpackbits(np.frombuffer(b"\xd3\x6a\xc5\x9e", dtype=np.uint8)).astype(np.int8)
    _DELTA = 7
    _MIN_CELL = 4
    _MAX_CELL = 16
    _MIN_SYNC_SCORE = 1.5
    _MIN_BIT_CORRELATION = 1.5

    @staticmethod
    def _bits(wm_code: int) -> np.ndarray:
        if not 0 <= wm_code <= 0xFFFFFFFF:
            raise ValueError("wmCode must be an unsigned 32-bit integer")
        payload = wm_code.to_bytes(4, "big")
        crc = zlib.crc32(payload).to_bytes(4, "big")
        return np.unpackbits(np.frombuffer(payload + crc, dtype=np.uint8)).astype(np.int8)

    @classmethod
    def _symbol_bits(cls, wm_code: int) -> np.ndarray:
        """Return 256 signed symbols: 64 sync and 3x 64 protected payload."""
        payload = cls._bits(wm_code)
        symbols = np.empty(cls._GRID * cls._GRID, dtype=np.int8)
        symbols[:32] = cls._SYNC_BITS
        symbols[32:224] = np.tile(payload, 3)
        symbols[224:] = cls._SYNC_BITS
        return symbols * 2 - 1

    @classmethod
    def _cell_size(cls, width: int, height: int) -> int:
        return max(cls._MIN_CELL, min(cls._MAX_CELL, min(width, height) // cls._GRID))

    @staticmethod
    def _pattern(height: int, width: int) -> np.ndarray:
        """A low-frequency, zero-mean micro-pattern robust to JPEG blocks."""
        rows = (np.arange(height) * 4 // max(1, height))[:, None]
        cols = (np.arange(width) * 4 // max(1, width))[None, :]
        pattern = np.where((rows + cols) % 2 == 0, 1.0, -1.0)
        return pattern - pattern.mean()

    @classmethod
    def _raster_embed(cls, image: Image.Image, wm_code: int) -> Image.Image:
        rgb = np.asarray(ImageOps.exif_transpose(image).convert("RGB"), dtype=np.int16).copy()
        height, width = rgb.shape[:2]
        cell = cls._cell_size(width, height)
        symbols = cls._symbol_bits(wm_code)
        # Luminance survives ordinary chroma subsampling. A micro-pattern is
        # used rather than a visible band or textual identifier.
        for top in range(0, height - cell + 1, cell):
            row = (top // cell) % cls._GRID
            for left in range(0, width - cell + 1, cell):
                col = (left // cell) % cls._GRID
                patch = cls._pattern(cell, cell) * cls._DELTA * symbols[row * cls._GRID + col]
                rgb[top:top + cell, left:left + cell, :] = np.clip(
                    rgb[top:top + cell, left:left + cell, :] + patch[:, :, None], 0, 255
                )
        return Image.fromarray(rgb.astype(np.uint8))

    @staticmethod
    def _metadata_code(image: Image.Image, mime_type: str) -> int | None:
        info = image.info
        value = info.get("TraceAnytong-wmCode")
        if value is None and mime_type == "image/jpeg":
            comment = info.get("comment", b"")
            if isinstance(comment, bytes) and comment.startswith(b"TraceAnytong-wmCode="):
                value = comment.split(b"=", 1)[1].decode("ascii")
        if value is None and mime_type == "image/webp":
            xmp = info.get("xmp", b"")
            if isinstance(xmp, bytes):
                marker = b"wmCode='"
                start = xmp.find(marker)
                if start >= 0:
                    end = xmp.find(b"'", start + len(marker))
                    value = xmp[start + len(marker):end].decode("ascii")
        if value is None:
            return None
        code = int(value)
        if not 0 <= code <= 0xFFFFFFFF:
            raise ValueError
        return code

    @classmethod
    def _visual_candidates(cls, rgb: np.ndarray) -> list[dict[str, object]]:
        """Search bounded cell geometry/phase hypotheses for CRC-valid grids.

        The phase search begins at the deterministic image grid origin. It is
        sufficient for the centered crop/resize probe and does not claim
        arbitrary geometric-invariant recovery. CRC alone is deliberately not
        sufficient: a candidate must also have conservative carrier support.
        """
        height, width = rgb.shape[:2]
        luminance = rgb.astype(np.float32).mean(axis=2)
        candidates: list[dict[str, object]] = []
        expected_sync = np.concatenate((cls._SYNC_BITS * 2 - 1, cls._SYNC_BITS * 2 - 1)).astype(np.float32)
        sync_indexes = np.concatenate((np.arange(32), np.arange(224, 256)))
        for cell in range(cls._MIN_CELL, cls._MAX_CELL + 1):
            if width < cls._GRID * cell or height < cls._GRID * cell:
                continue
            phase_values = (0,)
            pattern = cls._pattern(cell, cell)
            pattern_energy = float(np.square(pattern).sum())
            for phase_y in phase_values:
                for phase_x in phase_values:
                    sums = np.zeros(256, dtype=np.float64)
                    counts = np.zeros(256, dtype=np.int32)
                    for top in range(phase_y, height - cell + 1, cell):
                        row = ((top - phase_y) // cell) % cls._GRID
                        for left in range(phase_x, width - cell + 1, cell):
                            col = ((left - phase_x) // cell) % cls._GRID
                            patch = luminance[top:top + cell, left:left + cell]
                            correlation = float(np.multiply(patch - patch.mean(), pattern).sum() / pattern_energy)
                            index = row * cls._GRID + col
                            sums[index] += correlation
                            counts[index] += 1
                    # A partial code must be insufficient, not a guessed code.
                    if np.any(counts == 0):
                        continue
                    # A crop may begin at any repeated-grid row/column. Search
                    # those 16x16 logical offsets after (not during) pixel
                    # correlation, so crop recovery does not multiply decoder
                    # cost by another full raster scan.
                    physical = (sums / counts).reshape(cls._GRID, cls._GRID)
                    for grid_y in range(cls._GRID):
                        for grid_x in range(cls._GRID):
                            averages = np.roll(physical, (grid_y, grid_x), axis=(0, 1)).reshape(-1)
                            sync_score = float(np.mean(averages[sync_indexes] * expected_sync))
                            repetitions = averages[32:224].reshape(3, 64)
                            bit_sums = repetitions.sum(axis=0)
                            bits = (bit_sums >= 0).astype(np.uint8)
                            raw_bytes = np.packbits(bits).tobytes()
                            code = int.from_bytes(raw_bytes[:4], "big")
                            crc_valid = raw_bytes[4:] == zlib.crc32(raw_bytes[:4]).to_bytes(4, "big")
                            corrected_groups = int(np.count_nonzero(np.any((repetitions >= 0) != (bit_sums >= 0), axis=0)))
                            mean_bit_correlation = float(np.mean(np.abs(bit_sums / 3)))
                            candidate = {
                                "wmCode": code,
                                "crcValid": crc_valid,
                                "cellSize": cell,
                                "phase": {"x": phase_x, "y": phase_y},
                                "gridOffset": {"x": grid_x, "y": grid_y},
                                "syncScore": round(sync_score, 6),
                                "meanBitCorrelation": round(mean_bit_correlation, 6),
                                "correctedBitGroups": corrected_groups,
                                "symbolSamples": int(counts.min()),
                            }
                            if (
                                crc_valid
                                and sync_score >= cls._MIN_SYNC_SCORE
                                and mean_bit_correlation >= cls._MIN_BIT_CORRELATION
                            ):
                                candidates.append(candidate)
        return candidates

    @classmethod
    def _visual_recovery(cls, image: Image.Image) -> CarrierEvidence:
        rgb = np.asarray(ImageOps.exif_transpose(image).convert("RGB"))
        candidates = cls._visual_candidates(rgb)
        if not candidates:
            return CarrierEvidence(
                "image", cls.detector_version, 0.0,
                {
                    "recovery": "none",
                    "wmCode": None,
                    "visualCarrier": "repeated-raster-v2",
                    "acceptanceThresholds": {
                        "minSyncScore": cls._MIN_SYNC_SCORE,
                        "minMeanBitCorrelation": cls._MIN_BIT_CORRELATION,
                    },
                },
                (
                    "native metadata is absent",
                    "no CRC-valid visual raster code was recovered",
                    "visual recovery supports bounded centered crop and resize hypotheses only",
                ),
            )
        best = max(candidates, key=lambda item: (float(item["syncScore"]), float(item["meanBitCorrelation"])))
        confidence = min(1.0, max(0.0, float(best["syncScore"]) / cls._DELTA))
        return CarrierEvidence(
            "image", cls.detector_version, confidence,
            {
                "recovery": "visual-raster",
                "visualCarrier": "repeated-raster-v2",
                "acceptanceThresholds": {
                    "minSyncScore": cls._MIN_SYNC_SCORE,
                    "minMeanBitCorrelation": cls._MIN_BIT_CORRELATION,
                },
                **best,
            },
            (
                "visual raster recovery is candidate code evidence; server-side wmCode and fingerprint checks still decide attribution",
                "visual recovery supports bounded centered crop and resize hypotheses only",
            ),
        )

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
            save_args.update(quality=95, method=6, xmp=f"<x:xmpmeta xmlns:x='adobe:ns:meta/'><TraceAnytong wmCode='{wm_code}'/></x:xmpmeta>".encode("utf-8"))
        image.save(out, **save_args)
        from ..fingerprint.perceptual import PerceptualFingerprinter
        result = Artifact(out.getvalue(), artifact.mime_type, artifact.filename)
        return PersonalizationResult(result, CarrierEvidence("image", self.detector_version, 1.0, {"wmCode": wm_code, "recovery": "embedded", "visualCarrier": "repeated-raster-v2"}), PerceptualFingerprinter().index(result), {"carrierVersion": self.carrier_version, "modelVersion": "deterministic-fallback-v2"})

    def detect(self, artifact: Artifact, profile: CarrierProfile, **_: object) -> CarrierEvidence:
        try:
            image = Image.open(io.BytesIO(artifact.data))
            code = self._metadata_code(image, artifact.mime_type)
            if code is not None:
                return CarrierEvidence("image", self.detector_version, 1.0, {"recovery": "native-metadata", "wmCode": code, "visualCarrier": "repeated-raster-v2"}, ("metadata recovery is not a robust watermark detection",))
            return self._visual_recovery(image)
        except (ValueError, OSError) as exc:
            raise InvalidArtifactError("image evidence cannot be decoded") from exc
