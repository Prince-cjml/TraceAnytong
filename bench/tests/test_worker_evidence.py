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

    for name in ("screen-candidate-jpeg-60", "screen-candidate-crop-0.5"):
        transformed = results[name]
        raw = transformed["rawDetectorEvidence"]
        assert raw["transform"]["name"] in {"jpeg", "crop"}
        assert raw["candidateScores"][0]["score"] > raw["candidateScores"][1]["score"]
        assert transformed["attribution"]["status"] == "UNMEASURED"

    resized = results["screen-candidate-resize-0.75"]
    resized_scores = resized["rawDetectorEvidence"]["candidateScores"]
    assert resized["rawDetectorEvidence"]["transform"]["artifactGeometry"] == {"width": 240, "height": 192}
    assert resized_scores[0]["score"] < resized_scores[1]["score"]
    assert resized["attribution"]["status"] == "INSUFFICIENT"

    ambiguous = results["screen-two-candidate-ambiguous"]["rawDetectorEvidence"]
    assert ambiguous["crossCandidateMargin"] < 0.08
    assert results["screen-two-candidate-ambiguous"]["attribution"]["status"] == "INSUFFICIENT"
    assert results["screen-blank-negative"]["attribution"]["status"] == "INSUFFICIENT"


def test_native_structure_probes_never_promote_provenance_to_attribution(tmp_path) -> None:
    fixtures = tmp_path / "fixtures"
    generate_fixtures(fixtures)

    results = _by_scenario(collect_worker_evidence(fixtures))

    for name in ("native-docx-structure-support", "native-pptx-structure-support", "native-pdf-structure-support", "native-pdf-marker-only"):
        result = results[name]
        carrier = result["rawDetectorEvidence"]["carrierEvidence"]
        assert carrier["raw"]["scoreMeaning"].endswith("not attribution")
        assert result["attribution"]["status"] == "INSUFFICIENT"

    pdf = results["native-pdf-structure-support"]["rawDetectorEvidence"]["carrierEvidence"]
    assert pdf["raw"]["format"] == "pdf"
    assert pdf["raw"]["pdf"]["visibleImagePlacementCount"] > 0
    assert pdf["raw"]["candidateMatches"]
    assert results["native-pdf-structure-support"]["rawDetectorEvidence"]["benchmarkNormalization"]["removedPdfTrailerId"] is True

    for name in ("native-docx-unmarked-negative", "native-pptx-unmarked-negative"):
        carrier = results[name]["rawDetectorEvidence"]["carrierEvidence"]
        assert carrier["raw"]["provenance"]["markers"] == []
        assert carrier["raw"]["candidateMatches"] == []
        assert results[name]["attribution"]["status"] == "INSUFFICIENT"
