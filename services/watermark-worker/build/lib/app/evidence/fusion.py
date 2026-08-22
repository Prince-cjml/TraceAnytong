"""Conservative, explainable fusion. No score alone creates attribution."""
from __future__ import annotations

from typing import Sequence

from ..models import CandidateRank, CarrierEvidence, FingerprintEvidence


class TransparentEvidenceFusion:
    version = "evidence-fusion-v1"

    def rank(self, case: dict, carrier_evidence: Sequence[CarrierEvidence], fingerprint_evidence: Sequence[FingerprintEvidence], timeline_evidence: dict) -> list[CandidateRank]:
        candidates = case.get("candidates", [])
        ranks: list[CandidateRank] = []
        for index, candidate in enumerate(candidates):
            carrier = carrier_evidence[index] if index < len(carrier_evidence) else CarrierEvidence("screen", "missing", 0.0, {"missing": True})
            fingerprint = fingerprint_evidence[index] if index < len(fingerprint_evidence) else FingerprintEvidence("missing", 0.0, {"missing": True})
            margin = float(carrier.raw.get("margin", 0.0))
            timeline_consistent = bool(timeline_evidence.get(candidate.get("id"), timeline_evidence.get("consistent", False)))
            if carrier.score >= 0.45 and fingerprint.score >= 0.70 and margin >= 0.08:
                decision = "HIGH"
            elif carrier.score >= 0.25 and fingerprint.score >= 0.70 and margin >= 0.02 and timeline_consistent:
                decision = "MEDIUM"
            else:
                decision = "INSUFFICIENT"
            ranks.append(CandidateRank(str(candidate.get("id", index)), decision, carrier.score, fingerprint.score, margin, {"carrier": carrier.raw, "carrierWarnings": list(carrier.warnings), "fingerprint": fingerprint.raw, "timeline": {"consistent": timeline_consistent}, "fusionVersion": self.version}))
        return sorted(ranks, key=lambda rank: (rank.decision == "HIGH", rank.watermark_score, rank.fingerprint_score, rank.margin), reverse=True)
