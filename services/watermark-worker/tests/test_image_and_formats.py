import io

import fitz
import pytest
from PIL import Image
from docx import Document
from pptx import Presentation

from app.errors import UnsupportedFormatError
from app.formats.registry import AdapterRegistry
from app.models import Artifact


def image_artifact(mime="image/png"):
    image = Image.new("RGB", (160, 100), (120, 150, 180))
    out = io.BytesIO()
    image.save(out, {"image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WEBP"}[mime])
    return Artifact(out.getvalue(), mime, f"sample.{mime.rsplit('/', 1)[1]}")


@pytest.mark.parametrize("mime", ["image/png", "image/jpeg", "image/webp"])
def test_image_formats_round_trip_and_recover_wm_code(identity, profile, mime):
    registry = AdapterRegistry()
    result = registry.for_mime(mime).personalize(image_artifact(mime), identity, profile, wm_code=123456)
    assert result.artifact.data != image_artifact(mime).data
    recovered = registry.for_mime(mime).carrier.detect(result.artifact, profile)
    assert recovered.raw["wmCode"] == 123456


def test_pdf_personalization_is_valid_and_text_remains(identity, profile):
    source = fitz.open()
    page = source.new_page()
    page.insert_text((72, 72), "A selectable document")
    original = Artifact(source.tobytes(), "application/pdf", "sample.pdf")
    result = AdapterRegistry().for_mime(original.mime_type).personalize(original, identity, profile)
    checked = fitz.open(stream=result.artifact.data, filetype="pdf")
    assert "selectable document" in checked[0].get_text()
    assert result.artifact.data != original.data


def test_docx_and_pptx_remain_openable(identity, profile):
    doc = Document()
    doc.add_paragraph("Native document")
    stream = io.BytesIO(); doc.save(stream)
    doc_artifact = Artifact(stream.getvalue(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "sample.docx")
    doc_result = AdapterRegistry().for_mime(doc_artifact.mime_type).personalize(doc_artifact, identity, profile)
    assert Document(io.BytesIO(doc_result.artifact.data)).paragraphs[0].text == "Native document"

    deck = Presentation()
    deck.slides.add_slide(deck.slide_layouts[6])
    stream = io.BytesIO(); deck.save(stream)
    ppt_artifact = Artifact(stream.getvalue(), "application/vnd.openxmlformats-officedocument.presentationml.presentation", "sample.pptx")
    ppt_result = AdapterRegistry().for_mime(ppt_artifact.mime_type).personalize(ppt_artifact, identity, profile)
    assert len(Presentation(io.BytesIO(ppt_result.artifact.data)).slides) == 1


def test_unsupported_input_has_typed_error():
    with pytest.raises(UnsupportedFormatError) as raised:
        AdapterRegistry().for_mime("text/plain")
    assert raised.value.code == "UNSUPPORTED_FORMAT"
