"""Offline deterministic benchmark artifact runner.

The runner creates transformations and reports raw image-comparison evidence. It
does not impersonate a watermark detector: attribution stays ``UNMEASURED`` for
controlled positives and ``INSUFFICIENT`` for every negative.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from collections import Counter
from pathlib import Path
from typing import Callable

from PIL import Image, ImageChops, ImageOps, ImageStat

from bench.attacks import ATTACKS, DOCUMENT_ATTACKS, PHYSICAL_ATTACKS, Attack, apply_attack, apply_document_attack, apply_physical_attack
from bench.fixtures import MANIFEST_NAME, generate_fixtures, load_manifest
from bench.worker_evidence import collect_worker_evidence


REPORT_SCHEMA_VERSION = "0.2"
MATRIX_FIELDS = [
    "fixture", "corpus", "channel", "matrix", "attack", "value", "width", "height",
    "artifact", "artifactSha256", "artifactSizeBytes", "sizeIncreaseBytes", "phashSimilarity",
    "psnrDb", "ssim", "attributionStatus", "candidate", "runtimeMs",
]


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _perceptual_hash(image: Image.Image) -> str:
    reduced = ImageOps.grayscale(image).resize((8, 8), Image.Resampling.LANCZOS)
    values = list(reduced.getdata())
    mean = sum(values) / len(values)
    return "".join("1" if value >= mean else "0" for value in values)


def _similarity(first: str, second: str) -> float:
    return round(sum(a == b for a, b in zip(first, second)) / len(first), 6)


def _comparison_metrics(source: Image.Image, artifact: Image.Image) -> dict[str, float | str]:
    source_rgb = source.convert("RGB")
    artifact_rgb = artifact.convert("RGB")
    fitted = ImageOps.fit(artifact_rgb, source_rgb.size, method=Image.Resampling.LANCZOS)
    # Measure a fixed-size raster so the evidence calculation is predictable and
    # remains inexpensive even when a real fixture corpus contains large pages.
    source_gray = ImageOps.grayscale(source_rgb).resize((64, 64), Image.Resampling.LANCZOS)
    artifact_gray = ImageOps.grayscale(fitted).resize((64, 64), Image.Resampling.LANCZOS)
    source_values = list(source_gray.getdata())
    artifact_values = list(artifact_gray.getdata())
    count = len(source_values)
    mean_source = sum(source_values) / count
    mean_artifact = sum(artifact_values) / count
    variance_source = sum((value - mean_source) ** 2 for value in source_values) / count
    variance_artifact = sum((value - mean_artifact) ** 2 for value in artifact_values) / count
    covariance = sum((left - mean_source) * (right - mean_artifact) for left, right in zip(source_values, artifact_values)) / count
    c1, c2 = 6.5025, 58.5225
    ssim = ((2 * mean_source * mean_artifact + c1) * (2 * covariance + c2)) / ((mean_source**2 + mean_artifact**2 + c1) * (variance_source + variance_artifact + c2))
    difference = ImageChops.difference(source_gray, artifact_gray)
    squared_error = sum(value * value for value in difference.getdata()) / count
    psnr = 99.0 if squared_error == 0 else 10 * math.log10((255**2) / squared_error)
    source_hash = _perceptual_hash(source_rgb)
    artifact_hash = _perceptual_hash(artifact_rgb)
    return {
        "sourcePerceptualHash": source_hash,
        "artifactPerceptualHash": artifact_hash,
        "phashSimilarity": _similarity(source_hash, artifact_hash),
        "psnrDb": round(psnr, 6),
        "ssim": round(ssim, 6),
        "meanAbsoluteError": round(ImageStat.Stat(difference).mean[0], 6),
        "comparisonRaster": "64x64 grayscale",
    }


def _attribution(fixture: dict[str, object]) -> dict[str, object]:
    if fixture["corpus"] == "negative":
        return {
            "status": "INSUFFICIENT", "candidate": None,
            "warnings": ["Negative corpus: never force attribution without detector evidence."],
            "rawDetectorEvidence": {"watermarkScore": None, "candidateMargin": None, "decision": "INSUFFICIENT"},
        }
    return {
        "status": "UNMEASURED", "candidate": None,
        "warnings": ["No detector is bundled with the artifact generator; attribution has not been evaluated."],
        "rawDetectorEvidence": {"watermarkScore": None, "candidateMargin": None, "decision": "UNMEASURED"},
    }


def _write_summary(output: Path, report: dict[str, object]) -> None:
    by_matrix = Counter(result["matrix"] for result in report["results"])
    negative = report["negativeCorpus"]
    lines = ["# Benchmark summary", "", f"Deterministic artifact run: {report['samples']} samples from {report['fixtures']} fixtures.", "", "| Matrix | Samples |", "| --- | ---: |"]
    lines.extend(f"| {name} | {by_matrix[name]} |" for name in sorted(by_matrix))
    worker_evidence = report["workerEvidence"]
    worker_counts = worker_evidence["decisionCounts"]
    lines.extend([
        "", "## Negative corpus", "", f"- Fixtures: {negative['fixtures']}", f"- Samples: {negative['samples']}", f"- Confirmed attributions: {negative['confirmedAttributions']}", f"- False-attribution count: {negative['falseAttributionCount']}",
        "", "## Local worker evidence", "", f"- Probes: {len(worker_evidence['results'])}", f"- Decision counts: {', '.join(f'{key}={worker_counts[key]}' for key in sorted(worker_counts))}", f"- Confirmed attributions: {worker_evidence['confirmedAttributions']}",
        "", "The raster matrix reports artifact transformations only. The local worker matrix preserves raw carrier evidence and package/detector versions, but intentionally returns `UNMEASURED` or `INSUFFICIENT`: benchmark data has no authorized server-side provenance binding.",
    ])
    (output / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def _load_fixtures(fixtures_root: Path, generate: bool) -> list[dict[str, object]]:
    if generate or not (fixtures_root / MANIFEST_NAME).exists():
        generate_fixtures(fixtures_root)
    manifest = load_manifest(fixtures_root)
    if manifest.get("schemaVersion") != "0.1":
        raise ValueError("Unsupported fixture manifest schema")
    return list(manifest["fixtures"])


def run(fixtures_root: Path, output: Path, *, generate: bool = False) -> dict[str, object]:
    """Generate all benchmark artifacts and return the machine-readable report."""
    fixtures = _load_fixtures(fixtures_root, generate)
    output.mkdir(parents=True, exist_ok=True)
    samples = output / "samples"
    samples.mkdir(exist_ok=True)
    plans: tuple[tuple[str, tuple[Attack, ...], Callable[[Image.Image, Attack], Image.Image]], ...] = (("image", ATTACKS, apply_attack), ("physical", PHYSICAL_ATTACKS, apply_physical_attack), ("document", DOCUMENT_ATTACKS, apply_document_attack))
    results: list[dict[str, object]] = []
    for fixture in sorted(fixtures, key=lambda item: str(item["fixture_id"])):
        source_path = fixtures_root / str(fixture["filename"])
        source = Image.open(source_path).convert("RGB")
        source_size, source_sha = source_path.stat().st_size, _sha256(source_path)
        for matrix, attacks, transform in plans:
            if matrix == "document" and fixture["channel"] != "document":
                continue
            if matrix != "document" and fixture["channel"] != "image":
                continue
            for attack in attacks:
                artifact = transform(source, attack)
                relative_artifact = Path("samples") / f"{fixture['fixture_id']}-{matrix}-{attack.name}-{attack.value:g}.png"
                artifact_path = output / relative_artifact
                artifact.save(artifact_path, format="PNG", optimize=False)
                artifact_sha, metrics, attribution = _sha256(artifact_path), _comparison_metrics(source, artifact), _attribution(fixture)
                results.append({
                    "fixture": fixture["filename"], "fixtureId": fixture["fixture_id"], "corpus": fixture["corpus"], "channel": fixture["channel"], "matrix": matrix, "attack": attack.name, "value": attack.value,
                    "artifact": relative_artifact.as_posix(), "artifactSha256": artifact_sha, "artifactSizeBytes": artifact_path.stat().st_size, "sizeIncreaseBytes": artifact_path.stat().st_size - source_size,
                    "geometry": {"source": {"width": source.width, "height": source.height}, "artifact": {"width": artifact.width, "height": artifact.height}},
                    "fingerprint": {"sourceSha256": source_sha, "artifactSha256": artifact_sha, **metrics}, "attribution": attribution,
                    # Runtime is deliberately absent in the deterministic default; live timing is not reproducible.
                    "runtimeMs": None,
                })
    results.sort(key=lambda item: (str(item["fixtureId"]), str(item["matrix"]), str(item["attack"]), float(item["value"])))
    negative_results = [item for item in results if item["corpus"] == "negative"]
    confirmed_negative = [item for item in negative_results if item["attribution"]["status"] == "CONFIRMED"]
    worker_evidence = collect_worker_evidence(fixtures_root)
    report = {"schemaVersion": REPORT_SCHEMA_VERSION, "deterministic": True, "fixtures": len(fixtures), "samples": len(results), "falseAttributions": len(confirmed_negative), "negativeCorpus": {"fixtures": sum(item["corpus"] == "negative" for item in fixtures), "samples": len(negative_results), "confirmedAttributions": len(confirmed_negative), "falseAttributionCount": len(confirmed_negative), "decisionCounts": dict(sorted(Counter(item["attribution"]["status"] for item in negative_results).items()))}, "workerEvidence": worker_evidence, "results": results}
    (output / "report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    with (output / "matrix.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=MATRIX_FIELDS)
        writer.writeheader()
        for result in results:
            fingerprint = result["fingerprint"]
            writer.writerow({"fixture": result["fixture"], "corpus": result["corpus"], "channel": result["channel"], "matrix": result["matrix"], "attack": result["attack"], "value": result["value"], "width": result["geometry"]["artifact"]["width"], "height": result["geometry"]["artifact"]["height"], "artifact": result["artifact"], "artifactSha256": result["artifactSha256"], "artifactSizeBytes": result["artifactSizeBytes"], "sizeIncreaseBytes": result["sizeIncreaseBytes"], "phashSimilarity": fingerprint["phashSimilarity"], "psnrDb": fingerprint["psnrDb"], "ssim": fingerprint["ssim"], "attributionStatus": result["attribution"]["status"], "candidate": result["attribution"]["candidate"] or "", "runtimeMs": ""})
    _write_summary(output, report)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate deterministic attack-matrix benchmark artifacts")
    parser.add_argument("--fixtures", type=Path, default=Path("bench/fixtures"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--generate-fixtures", action="store_true", help="Regenerate the deterministic fixture corpus before running")
    args = parser.parse_args()
    report = run(args.fixtures, args.output, generate=args.generate_fixtures)
    print(f"Generated {report['samples']} samples in {args.output}")


if __name__ == "__main__":
    main()
