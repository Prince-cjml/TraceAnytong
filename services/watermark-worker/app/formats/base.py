from __future__ import annotations

from ..errors import UnsupportedFormatError


class BaseAdapter:
    mime_types: frozenset[str] = frozenset()

    def supports(self, mime: str) -> bool:
        return mime.lower().split(";", 1)[0].strip() in self.mime_types

    def require_support(self, mime: str) -> None:
        if not self.supports(mime):
            raise UnsupportedFormatError("format is not supported by this adapter", details={"mime": mime, "supported": sorted(self.mime_types)})
