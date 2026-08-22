import json

from bench.fixtures import generate_fixtures
from bench.runners.run import run


def test_fixture_generator_is_repeatable(tmp_path) -> None:
    first = tmp_path / "first"
    second = tmp_path / "second"
    assert generate_fixtures(first) == generate_fixtures(second)
    assert (first / "manifest.json").read_text(encoding="utf-8") == (second / "manifest.json").read_text(encoding="utf-8")


def test_runner_emits_complete_deterministic_negative_safe_artifacts(tmp_path) -> None:
    fixtures = tmp_path / "fixtures"
    first_output = tmp_path / "first-report"
    second_output = tmp_path / "second-report"
    generate_fixtures(fixtures)

    first = run(fixtures, first_output)
    second = run(fixtures, second_output)

    assert first == second
    assert first["samples"] > 0
    assert {result["matrix"] for result in first["results"]} == {"image", "document", "physical"}
    assert first["negativeCorpus"]["falseAttributionCount"] == 0
    assert {result["attribution"]["status"] for result in first["results"] if result["corpus"] == "negative"} == {"INSUFFICIENT"}
    for filename in ("report.json", "summary.md", "matrix.csv"):
        assert (first_output / filename).is_file()
    report = json.loads((first_output / "report.json").read_text(encoding="utf-8"))
    assert report["deterministic"] is True
    assert report["results"][0]["fingerprint"]["sourceSha256"]
    assert (first_output / report["results"][0]["artifact"]).is_file()
