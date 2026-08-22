from app.evidence.fusion import TransparentEvidenceFusion
from app.models import CarrierEvidence, FingerprintEvidence


def test_ambiguous_evidence_is_never_attributed():
    result = TransparentEvidenceFusion().rank(
        {"candidates": [{"id": "candidate-a"}]},
        [CarrierEvidence("screen", "test", 0.9, {"margin": 0.001})],
        [FingerprintEvidence("test", 0.99, {"method": "sha256"})],
        {"consistent": True},
    )
    assert result[0].decision == "INSUFFICIENT"
    assert result[0].raw_evidence["carrier"]["margin"] == 0.001


def test_insufficient_when_fingerprint_does_not_support_carrier():
    result = TransparentEvidenceFusion().rank({"candidates": [{"id": "candidate-a"}]}, [CarrierEvidence("screen", "test", 0.9, {"margin": 0.3})], [FingerprintEvidence("test", 0.2, {})], {"consistent": True})
    assert result[0].decision == "INSUFFICIENT"
