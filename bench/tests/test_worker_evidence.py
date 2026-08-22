from bench.fixtures import generate_fixtures
from bench.worker_evidence import collect_worker_evidence


def _by_scenario(report: dict) -> dict[str, dict]:
    return {item["scenario"]: item for item in report["results"]}


def test_worker_evidence_keeps_metadata_loss_and_ambiguous_screen_unattributed(tmp_path) -> None:
    fixtures = tmp_path / "fixtures"
    generate_fixtures(fixtures)

    results = _by_scenario(collect_worker_evidence(fixtures))

    image = results["image-native-metadata-recovery"]
    assert image["rawDetectorEvidence"]["carrierEvidence"]["raw"]["wmCode"] == 0xAABBCCDD
    assert image["attribution"]["status"] == "UNMEASURED"

    stripped = results["image-metadata-stripped-negative"]
    assert stripped["rawDetectorEvidence"]["carrierEvidence"]["raw"]["recovery"] == "none"
    assert stripped["attribution"]["status"] == "INSUFFICIENT"

    matched = results["screen-candidate-matched"]["rawDetectorEvidence"]
    assert matched["crossCandidateMargin"] > 0.3
    assert results["screen-candidate-matched"]["attribution"]["status"] == "UNMEASURED"

    ambiguous = results["screen-two-candidate-ambiguous"]["rawDetectorEvidence"]
    assert ambiguous["crossCandidateMargin"] < 0.08
    assert results["screen-two-candidate-ambiguous"]["attribution"]["status"] == "INSUFFICIENT"
    assert results["screen-blank-negative"]["attribution"]["status"] == "INSUFFICIENT"


def test_native_structure_probes_never_promote_provenance_to_attribution(tmp_path) -> None:
    fixtures = tmp_path / "fixtures"
    generate_fixtures(fixtures)

    results = _by_scenario(collect_worker_evidence(fixtures))

    for name in ("native-docx-structure-support", "native-pptx-structure-support", "native-pdf-marker-only"):
        result = results[name]
        carrier = result["rawDetectorEvidence"]["carrierEvidence"]
        assert carrier["raw"]["scoreMeaning"].endswith("not attribution")
        assert result["attribution"]["status"] == "INSUFFICIENT"

    for name in ("native-docx-unmarked-negative", "native-pptx-unmarked-negative"):
        carrier = results[name]["rawDetectorEvidence"]["carrierEvidence"]
        assert carrier["raw"]["provenance"]["markers"] == []
        assert carrier["raw"]["candidateMatches"] == []
        assert results[name]["attribution"]["status"] == "INSUFFICIENT"
