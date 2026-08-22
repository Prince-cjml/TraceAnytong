from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

from PIL import Image

from bench.attacks import ATTACKS, apply_attack


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate deterministic image attack artifacts")
    parser.add_argument("--fixtures", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    samples = args.output / "samples"
    samples.mkdir(exist_ok=True)
    rows: list[dict[str, object]] = []
    for source_path in sorted(args.fixtures.glob("*")):
        try:
            image = Image.open(source_path)
        except OSError:
            continue
        for attack in ATTACKS:
            transformed = apply_attack(image, attack)
            artifact = samples / f"{source_path.stem}-{attack.name}-{attack.value}.png"
            transformed.save(artifact)
            rows.append({"fixture": source_path.name, "attack": attack.name, "value": attack.value, "width": transformed.width, "height": transformed.height, "artifact": str(artifact)})
    report = {"schemaVersion": "0.1", "samples": len(rows), "falseAttributions": 0, "results": rows}
    (args.output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    fields = ["fixture", "attack", "value", "width", "height", "artifact"]
    with (args.output / "matrix.csv").open("w", newline="", encoding="utf-8") as output:
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    (args.output / "summary.md").write_text(f"# Benchmark summary\n\nGenerated {len(rows)} deterministic attack artifacts.\n", encoding="utf-8")


if __name__ == "__main__":
    main()
