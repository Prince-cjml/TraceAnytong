"""Deterministic content fingerprints with transparent component scores."""
from __future__ import annotations

import hashlib
import io
from typing import Sequence

import numpy as np
from PIL import Image

from ..models import Artifact, FingerprintEvidence


class PerceptualFingerprinter:
    version = "perceptual-v1"

    @staticmethod
    def _dhash(image: Image.Image) -> str:
        arr = np.asarray(image.convert("L").resize((9, 8), Image.Resampling.LANCZOS), dtype=np.int16)
        return f"{int(''.join('1' if v else '0' for v in (arr[:, 1:] >= arr[:, :-1]).ravel()), 2):016x}"

    def index(self, artifact: Artifact) -> dict:
        base = {"fingerprintVersion": self.version, "sha256": hashlib.sha256(artifact.data).hexdigest(), "mimeType": artifact.mime_type, "bytes": len(artifact.data)}
        if artifact.mime_type.startswith("image/"):
            try:
                image = Image.open(io.BytesIO(artifact.data))
                image.load()
                base.update({"dHash": self._dhash(image), "width": image.width, "height": image.height})
            except OSError:
                base["warnings"] = ["image decode failed; only byte fingerprint is available"]
        return base

    @staticmethod
    def _hamming(left: str, right: str) -> int:
        return (int(left, 16) ^ int(right, 16)).bit_count()

    def search(self, evidence: Artifact, candidates: Sequence[dict]) -> list[FingerprintEvidence]:
        observed = self.index(evidence)
        output: list[FingerprintEvidence] = []
        for candidate in candidates:
            raw = {"observed": observed, "candidate": candidate}
            if observed.get("sha256") == candidate.get("sha256"):
                score, method = 1.0, "sha256"
            elif observed.get("dHash") and candidate.get("dHash"):
                distance = self._hamming(observed["dHash"], candidate["dHash"])
                score, method = 1 - distance / 64, "dHash"
                raw["hammingDistance"] = distance
            else:
                score, method = 0.0, "no-comparable-fingerprint"
            raw["method"] = method
            output.append(FingerprintEvidence(self.version, float(score), raw))
        return output
