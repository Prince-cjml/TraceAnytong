import io

import fitz
import pytest
from PIL import Image

from app.fingerprint.content_index import (
    PAGE_FINGERPRINT_VERSION,
    SOURCE_CONTENT_INDEX_VERSION,
    canonical_page_previews,
    index_source_content,
)
from app.models import Artifact


def _image_artifact(*, mime_type: str = "image/png") -> Artifact:
    image = Image.new("RGB", (160, 96), (230, 235, 240))
    for x in range(20, 140):
        for y in range(18, 78):
            image.putpixel((x, y), ((x * 7) % 255, (y * 11) % 255, ((x + y) * 5) % 255))
    stream = io.BytesIO()
    image.save(stream, {"image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WEBP"}[mime_type])
    return Artifact(stream.getvalue(), mime_type, "alice@example.invalid-source.png")


@pytest.mark.parametrize("mime_type", ["image/png", "image/jpeg", "image/webp"])
def test_image_index_is_deterministic_and_pii_free(mime_type: str) -> None:
    artifact = _image_artifact(mime_type=mime_type)
    first = index_source_content(artifact)
    second = index_source_content(artifact)

    assert first == second
    assert first.status == "indexed"
    assert len(first.pages) == 1
    page = first.pages[0]
    assert page.page_number == 1
    assert page.width == 160 and page.height == 96
    assert len(page.p_hash) == len(page.d_hash) == 16
    assert page.fingerprint_version == PAGE_FINGERPRINT_VERSION
    payload = first.to_dict()
    assert payload["indexVersion"] == SOURCE_CONTENT_INDEX_VERSION
    assert payload["rawEvidence"]["decoder"]["name"] == "Pillow"
    assert payload["rawEvidence"]["decoder"]["version"].startswith("Pillow-")
    assert "alice@example.invalid" not in str(payload)
    assert "filename" not in str(payload).lower()


def _pdf_artifact() -> Artifact:
    document = fitz.open()
    first = document.new_page(width=144, height=144)
    first.draw_rect(fitz.Rect(20, 20, 100, 100), color=(0.2, 0.4, 0.8), fill=(0.8, 0.9, 1.0))
    second = document.new_page(width=144, height=144)
    second.draw_circle(fitz.Point(72, 72), 40, color=(0.8, 0.2, 0.1), fill=(1.0, 0.9, 0.8))
    data = document.tobytes(garbage=4, deflate=True)
    document.close()
    return Artifact(data, "application/pdf", "private-person.pdf")


def test_pdf_index_renders_ordered_page_records_with_declared_tool_version() -> None:
    result = index_source_content(_pdf_artifact())

    assert result.status == "indexed"
    assert [page.page_number for page in result.pages] == [1, 2]
    assert all(page.width == page.height == 288 for page in result.pages)
    assert result.pages[0].p_hash != result.pages[1].p_hash
    assert result.raw_evidence["renderer"]["name"] == "PyMuPDF"
    assert result.raw_evidence["renderer"]["rasterScale"] == 2.0
    assert result.raw_evidence["result"] == {"pageCount": 2, "pageNumbers": [1, 2]}
    assert "private-person.pdf" not in str(result.to_dict())


def test_canonical_page_previews_follow_indexed_page_order_without_filename_metadata() -> None:
    artifact = _pdf_artifact()
    index = index_source_content(artifact)
    previews = canonical_page_previews(artifact)

    assert len(previews) == len(index.pages) == 2
    assert all(preview.startswith(b"\x89PNG\r\n\x1a\n") for preview in previews)
    assert b"private-person.pdf" not in b"".join(previews)


def test_pdf_over_the_declared_page_limit_is_unindexed_without_partial_previews() -> None:
    document = fitz.open()
    for _ in range(2):
        document.new_page(width=72, height=72)
    artifact = Artifact(document.tobytes(), "application/pdf", "too-many-pages.pdf")
    document.close()

    result = index_source_content(artifact, max_pages=1)

    assert result.status == "unindexed"
    assert result.pages == ()
    assert result.raw_evidence["result"] == {"reason": "page-limit-exceeded", "pageCount": 0}
    assert canonical_page_previews(artifact, max_pages=1) == ()


@pytest.mark.parametrize(
    ("artifact", "reason"),
    [
        (Artifact(b"not-an-image", "image/png", "corrupt.png"), "invalid-image"),
        (Artifact(b"not-a-pdf", "application/pdf", "corrupt.pdf"), "invalid-pdf"),
        (Artifact(b"zip-like-bytes", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "source.docx"), "office-renderer-unconfigured"),
        (Artifact(b"plain", "text/plain", "notes.txt"), "unsupported-mime"),
    ],
)
def test_corrupt_and_unsupported_inputs_fail_closed_without_synthetic_pages(artifact: Artifact, reason: str) -> None:
    result = index_source_content(artifact)

    assert result.status == "unindexed"
    assert result.pages == ()
    assert result.raw_evidence["result"] == {"reason": reason, "pageCount": 0}
    assert len(result.warnings) == 1
