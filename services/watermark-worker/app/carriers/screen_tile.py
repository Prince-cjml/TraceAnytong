"""Versioned deterministic screen tile and candidate-matched correlation."""
from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass

import numpy as np
from PIL import Image

from ..models import CarrierEvidence, CarrierProfile, TraceIdentity


@dataclass(frozen=True)
class TileCorrelation:
    score: float
    peak: tuple[int, int]
    raw_peak: float
    second_peak: float
    margin: float


class ScreenTileCarrier:
    """Candidate-matched watermark. It intentionally does not claim blind identity decoding."""

    detector_version = "screen-correlation-v1"

    @staticmethod
    def _seed(identity: TraceIdentity, profile: CarrierProfile) -> bytes:
        identity.validate()
        profile.validate()
        message = f"{identity.trace_handle}|{identity.profile_version}|{identity.scope}".encode("ascii")
        return hmac.new(profile.secret, message, hashlib.sha256).digest()

    def field(self, identity: TraceIdentity, profile: CarrierProfile) -> np.ndarray:
        """Generate a zero-mean band-limited identity field with four sync pilots."""
        n = profile.tile_size
        rng = np.random.default_rng(int.from_bytes(self._seed(identity, profile)[:16], "big"))
        spectrum = np.fft.fft2(rng.normal(size=(n, n)))
        fy, fx = np.fft.fftfreq(n)[:, None], np.fft.fftfreq(n)[None, :]
        radius = np.sqrt(fx * fx + fy * fy)
        band = (radius > 0.055) & (radius < 0.235)
        identity_field = np.fft.ifft2(spectrum * band).real
        y, x = np.mgrid[:n, :n]
        # Fixed low-energy pilots allow phase alignment without revealing identity.
        pilot = sum(np.cos(2 * np.pi * (a * x + b * y) / n) for a, b in ((5, 7), (11, 3), (3, 13), (17, 9))) / 4
        field = identity_field + 0.18 * pilot
        field -= field.mean()
        return (field / (np.sqrt(np.mean(field * field)) + 1e-12)).astype(np.float32)

    def tile_rgba(self, identity: TraceIdentity, profile: CarrierProfile) -> Image.Image:
        field = self.field(identity, profile)
        # Middle-gray alpha pattern: visual opacity is bounded by immutable profile strength.
        alpha = np.clip(128 + field * 128 * profile.strength, 0, 255).astype(np.uint8)
        rgba = np.empty((*field.shape, 4), dtype=np.uint8)
        rgba[..., :3] = 128
        rgba[..., 3] = alpha
        return Image.fromarray(rgba, "RGBA")

    @staticmethod
    def _gray(image: Image.Image, size: int) -> np.ndarray:
        gray = image.convert("L")
        arr = np.asarray(gray, dtype=np.float32)
        if min(arr.shape) < size:
            scale = size / min(arr.shape)
            gray = gray.resize((round(arr.shape[1] * scale), round(arr.shape[0] * scale)), Image.Resampling.BICUBIC)
            arr = np.asarray(gray, dtype=np.float32)
        return arr - arr.mean()

    def correlate(self, image: Image.Image, identity: TraceIdentity, profile: CarrierProfile) -> TileCorrelation:
        """Search translation phases and expose the complete peak evidence."""
        observed = self._gray(image, profile.tile_size)
        pattern = self.field(identity, profile)
        h, w = observed.shape
        # Fold every repeated tile coordinate into a phase image, then get every
        # translation correlation with a single FFT. It is deterministic and avoids
        # a detector-time dependency on a ML checkpoint.
        yy, xx = np.indices((h, w))
        bins = (yy % profile.tile_size * profile.tile_size + xx % profile.tile_size).ravel()
        totals = np.bincount(bins, weights=observed.ravel(), minlength=profile.tile_size**2)
        counts = np.bincount(bins, minlength=profile.tile_size**2)
        periodic = (totals / np.maximum(counts, 1)).reshape(profile.tile_size, profile.tile_size).astype(np.float32)
        periodic -= periodic.mean()
        scores = np.fft.ifft2(np.fft.fft2(periodic) * np.conj(np.fft.fft2(pattern))).real
        scores /= (np.linalg.norm(periodic) * np.linalg.norm(pattern) + 1e-12)
        flat = np.sort(scores.ravel())
        peak_index = np.unravel_index(int(np.argmax(scores)), scores.shape)
        peak = float(scores[peak_index])
        second = float(flat[-2]) if flat.size > 1 else 0.0
        return TileCorrelation(score=max(0.0, peak), peak=(int(peak_index[1]), int(peak_index[0])), raw_peak=peak, second_peak=second, margin=peak - second)

    def detect_candidate(self, image: Image.Image, identity: TraceIdentity, profile: CarrierProfile) -> CarrierEvidence:
        result = self.correlate(image, identity, profile)
        return CarrierEvidence(
            carrier="screen", detector_version=self.detector_version, score=result.score,
            raw={"phase": {"x": result.peak[0], "y": result.peak[1]}, "peak": result.raw_peak, "secondPeak": result.second_peak, "margin": result.margin, "tileSize": profile.tile_size, "carrierVersion": profile.carrier_version},
            warnings=() if result.margin >= 0.01 else ("correlation peak is ambiguous",),
        )
