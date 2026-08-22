from __future__ import annotations

from ..carriers.image_code import ImageCodeCarrier
from ..errors import UnsupportedFormatError
from ..models import Artifact, CarrierProfile, PersonalizationResult, TraceIdentity
from .base import BaseAdapter


class ImageFormatAdapter(BaseAdapter):
    mime_types = frozenset({"image/jpeg", "image/png", "image/webp"})

    def __init__(self, carrier: ImageCodeCarrier | None = None) -> None:
        self.carrier = carrier or ImageCodeCarrier()

    def personalize(self, artifact: Artifact, trace_identity: TraceIdentity, profile: CarrierProfile, **kwargs: object) -> PersonalizationResult:
        self.require_support(artifact.mime_type)
        wm_code = kwargs.get("wm_code")
        if not isinstance(wm_code, int):
            raise UnsupportedFormatError("image personalization requires a server-mapped integer wmCode")
        return self.carrier.embed(artifact, trace_identity, profile, wm_code=wm_code)

    def render_reference(self, artifact: Artifact) -> list[Artifact]:
        self.require_support(artifact.mime_type)
        return [artifact]
