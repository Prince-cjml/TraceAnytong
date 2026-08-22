"""Create the small, deterministic corpus used by the offline benchmark harness."""

from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path

from PIL import Image, ImageDraw


MANIFEST_NAME = "manifest.json"
FIXTURE_SCHEMA_VERSION = "0.1"


@dataclass(frozen=True)
class Fixture:
    fixture_id: str
    filename: str
    channel: str
    corpus: str
    trace_handle: str | None
    description: str


FIXTURES = (
    Fixture("image-positive-01", "image-positive-01.png", "image", "acceptance", "3c2d8b2c7fca4d489e9d9b9f63c0a101", "Synthetic protected image; opaque fixture trace handle."),
    Fixture("document-positive-01", "document-positive-01.png", "document", "acceptance", "ccf492d5ce9f4a9a8d6b7e2a31f40b91", "Synthetic rendered document page; opaque fixture trace handle."),
    Fixture("negative-image-01", "negative-image-01.png", "image", "negative", None, "Unwatermarked synthetic image negative."),
    Fixture("negative-document-01", "negative-document-01.png", "document", "negative", None, "Unwatermarked synthetic document-page negative."),
)


def _base_canvas(seed: int, *, document: bool, marked: bool) -> Image.Image:
    width, height = (480, 640) if document else (640, 400)
    image = Image.new("RGB", (width, height), (245, 247, 250))
    pixels = image.load()
    for y in range(height):
        for x in range(width):
            wave = (x * 11 + y * 7 + seed * 29) % 64
            pixels[x, y] = (180 + wave, 190 + (wave * 3) % 55, 205 + (wave * 5) % 45)
    draw = ImageDraw.Draw(image)
    margin = 42 if document else 28
    if document:
        draw.rectangle((margin, margin, width - margin, height - margin), fill=(255, 255, 252), outline=(44, 60, 82), width=3)
        for line in range(12):
            top = 90 + line * 34
            line_width = width - 130 - (line % 3) * 55
            draw.rectangle((70, top, line_width, top + 9), fill=(60 + line * 4, 75 + line * 3, 98 + line * 2))
        draw.rectangle((70, 62, width - 100, 76), fill=(28, 46, 70))
    else:
        draw.rectangle((margin, margin, width - margin, height - margin), outline=(20, 40, 70), width=5)
        draw.ellipse((100, 90, 300, 290), fill=(40, 100, 160), outline=(10, 35, 75), width=4)
        draw.polygon(((340, 300), (470, 80), (580, 300)), fill=(190, 95, 65), outline=(90, 40, 35))
    if marked:
        # This is visual fixture content only. The opaque handle remains metadata,
        # not embedded PII or a reversible identity claim.
        for x in range(18, width, 37):
            for y in range(14, height, 41):
                shade = 120 + ((x + y + seed) % 50)
                draw.rectangle((x, y, x + 3, y + 3), fill=(shade, shade, shade))
    return image


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def generate_fixtures(output: Path) -> dict[str, object]:
    """Write a repeatable corpus and manifest; return the manifest object."""
    output.mkdir(parents=True, exist_ok=True)
    manifest_entries: list[dict[str, object]] = []
    for index, fixture in enumerate(FIXTURES):
        path = output / fixture.filename
        image = _base_canvas(index + 1, document=fixture.channel == "document", marked=fixture.corpus == "acceptance")
        image.save(path, format="PNG", optimize=False)
        entry = asdict(fixture)
        entry["sha256"] = _sha256(path)
        manifest_entries.append(entry)
    manifest = {"schemaVersion": FIXTURE_SCHEMA_VERSION, "fixtures": manifest_entries}
    (output / MANIFEST_NAME).write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return manifest


def load_manifest(fixtures_root: Path) -> dict[str, object]:
    path = fixtures_root / MANIFEST_NAME
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate deterministic TraceAnytong benchmark fixtures")
    parser.add_argument("--output", type=Path, default=Path("bench/fixtures"))
    args = parser.parse_args()
    manifest = generate_fixtures(args.output)
    print(f"Generated {len(manifest['fixtures'])} deterministic fixtures in {args.output}")


if __name__ == "__main__":
    main()
