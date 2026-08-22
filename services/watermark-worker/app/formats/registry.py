from __future__ import annotations

from ..errors import UnsupportedFormatError
from .docx import DocxFormatAdapter
from .images import ImageFormatAdapter
from .pdf import PdfFormatAdapter
from .pptx import PptxFormatAdapter


class AdapterRegistry:
    def __init__(self) -> None:
        self.adapters = (ImageFormatAdapter(), PdfFormatAdapter(), DocxFormatAdapter(), PptxFormatAdapter())

    def for_mime(self, mime_type: str):
        normalized = mime_type.lower().split(";", 1)[0].strip()
        for adapter in self.adapters:
            if adapter.supports(normalized):
                return adapter
        raise UnsupportedFormatError("unsupported input MIME type", details={"mime": mime_type, "supported": sorted({mime for adapter in self.adapters for mime in adapter.mime_types})})
