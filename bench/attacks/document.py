"""Deterministic raster simulations of document export and capture transforms.

These transformations intentionally operate on rendered page fixtures.  They are
not substitutes for native Office/PDF conversion and are labeled as simulations
in benchmark output so an offline run cannot overstate coverage.
"""

from __future__ import annotations

from io import BytesIO

from PIL import Image, ImageFilter

from .image import Attack


DOCUMENT_ATTACKS = (
    Attack("docx_to_pdf", 1),
    Attack("pptx_to_pdf", 1),
    Attack("pdf_to_png", 1),
    Attack("pdf_screenshot", 0.8),
    Attack("rasterize_recompress", 60),
)


def apply_document_attack(image: Image.Image, attack: Attack) -> Image.Image:
    source = image.convert("RGB")
    if attack.name in {"docx_to_pdf", "pptx_to_pdf", "pdf_to_png"}:
        # A stable re-rasterization pass models export without requiring an office suite.
        return source.resize(source.size, Image.Resampling.BICUBIC)
    if attack.name == "pdf_screenshot":
        scaled = source.resize((max(1, round(source.width * attack.value)), max(1, round(source.height * attack.value))), Image.Resampling.LANCZOS)
        return scaled.resize(source.size, Image.Resampling.BILINEAR)
    if attack.name == "rasterize_recompress":
        raster = source.filter(ImageFilter.GaussianBlur(0.2))
        buffer = BytesIO()
        raster.save(buffer, format="JPEG", quality=int(attack.value), optimize=False)
        return Image.open(BytesIO(buffer.getvalue())).convert("RGB")
    raise ValueError(f"Unsupported document attack: {attack.name}")
