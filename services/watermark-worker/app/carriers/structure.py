"""Deterministic native-provenance and structure evidence for office artifacts.

This carrier does not decode a visual watermark and does not attribute a document.
It records the native markers and carrier-shaped structures that survive in a PDF or
Open XML package.  A caller may compare the opaque markers with server-resolved
anonymous candidates, but must use the raw evidence together with independent
watermark and fingerprint evidence before making a decision.
"""
from __future__ import annotations

import hashlib
import io
import re
import sys
import zipfile
from collections.abc import Sequence
from typing import Any
from xml.etree import ElementTree

import fitz

from ..errors import InvalidArtifactError, UnsupportedFormatError
from ..models import Artifact, CarrierEvidence, CarrierProfile, TraceIdentity


_PDF_MIME = "application/pdf"
_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
_SUPPORTED_MIME_TYPES = frozenset({_PDF_MIME, _DOCX_MIME, _PPTX_MIME})
_OPAQUE_HANDLE = r"([0-9a-f]{32})"
_TRACE_MARKER = re.compile(
    rf"TraceAnytong(?:\s+opaque\s+trace\s+|:){_OPAQUE_HANDLE}"
    r"(?:\s*;\s*profile\s*:?[ \t]*([A-Za-z0-9._-]+))?",
    re.IGNORECASE,
)


def _artifact_sha256(artifact: Artifact) -> str:
    return hashlib.sha256(artifact.data).hexdigest()


def _trace_markers(text: str) -> list[dict[str, str | None]]:
    """Parse only protocol-shaped, opaque native markers; discard all other text."""
    seen: set[tuple[str, str | None]] = set()
    markers: list[dict[str, str | None]] = []
    for match in _TRACE_MARKER.finditer(text):
        marker = (match.group(1).lower(), match.group(2))
        if marker not in seen:
            seen.add(marker)
            markers.append({"traceHandle": marker[0], "profileVersion": marker[1]})
    return markers


def _xml_text(data: bytes) -> str:
    try:
        root = ElementTree.fromstring(data)
    except ElementTree.ParseError:
        return ""
    return " ".join(part.strip() for part in root.itertext() if part and part.strip())


def _zip_entries(artifact: Artifact, required_entry: str) -> tuple[zipfile.ZipFile, list[str]]:
    try:
        package = zipfile.ZipFile(io.BytesIO(artifact.data))
        entries = sorted(package.namelist())
    except (OSError, zipfile.BadZipFile) as exc:
        raise InvalidArtifactError("Open XML evidence is not a valid ZIP package") from exc
    if required_entry not in entries:
        package.close()
        raise InvalidArtifactError("Open XML package is missing its required content part", details={"requiredEntry": required_entry})
    return package, entries


def _score_components(*, marker_count: int, carrier_placements: int, candidate_match_count: int) -> tuple[float, dict[str, float]]:
    """Explain the detector score explicitly; it is support, never attribution."""
    marker = 0.45 if marker_count else 0.0
    placement = 0.35 if carrier_placements else 0.0
    candidate = 0.20 if candidate_match_count else 0.0
    return marker + placement + candidate, {
        "nativeMarker": marker,
        "carrierShapedPlacement": placement,
        "candidateMarkerMatch": candidate,
    }


class NativeStructureCarrier:
    """Extract raw PDF/DOCX/PPTX provenance and structure evidence.

    ``candidates`` contains only protocol ``TraceIdentity`` objects.  It is optional
    because the extractor remains useful for evidence preservation before a case has
    resolved candidate bindings.  Marker equality is recorded, never promoted to a
    decision in this module.
    """

    carrier_version = "native-structure-v1"
    detector_version = "native-structure-detector-v1"

    def detect(
        self,
        artifact: Artifact,
        profile: CarrierProfile,
        *,
        candidates: Sequence[TraceIdentity] = (),
    ) -> CarrierEvidence:
        profile.validate()
        mime_type = artifact.mime_type.lower().split(";", 1)[0].strip()
        if mime_type not in _SUPPORTED_MIME_TYPES:
            raise UnsupportedFormatError(
                "native structure detection supports PDF, DOCX, and PPTX evidence only",
                details={"mime": artifact.mime_type, "supported": sorted(_SUPPORTED_MIME_TYPES)},
            )
        if mime_type == _PDF_MIME:
            raw, warnings, placements = self._pdf_raw(artifact)
        elif mime_type == _DOCX_MIME:
            raw, warnings, placements = self._docx_raw(artifact)
        else:
            raw, warnings, placements = self._pptx_raw(artifact)

        markers = raw["provenance"]["markers"]
        candidate_matches = self._candidate_matches(markers, candidates, profile.profile_version)
        exact_candidate_match_count = sum(bool(match["profileVersionMatches"]) for match in candidate_matches)
        score, components = _score_components(
            marker_count=len(markers),
            carrier_placements=placements,
            candidate_match_count=exact_candidate_match_count,
        )
        raw.update(
            {
                "carrierVersion": self.carrier_version,
                "detectorVersion": self.detector_version,
                "profileVersion": profile.profile_version,
                "candidateMatches": candidate_matches,
                "scoreComponents": components,
                "scoreMeaning": "native provenance/structure support only; not attribution",
            }
        )
        warning_list = list(warnings)
        if not markers:
            warning_list.append("no protocol-shaped native TraceAnytong provenance marker was found")
        if markers and not placements:
            warning_list.append("native marker exists without a measured carrier-shaped placement")
        if placements:
            warning_list.append("carrier-shaped native placement is non-identifying without candidate-matched visual evidence")
        return CarrierEvidence("structure", self.detector_version, score, raw, tuple(warning_list))

    def detect_candidate(self, artifact: Artifact, identity: TraceIdentity, profile: CarrierProfile) -> CarrierEvidence:
        """Convenience candidate comparison with the same raw extraction payload."""
        identity.validate()
        return self.detect(artifact, profile, candidates=(identity,))

    @staticmethod
    def _candidate_matches(
        markers: Sequence[dict[str, str | None]], candidates: Sequence[TraceIdentity], expected_profile_version: str
    ) -> list[dict[str, Any]]:
        expected = {candidate.trace_handle.lower(): candidate for candidate in candidates}
        matches: list[dict[str, Any]] = []
        for marker in markers:
            candidate = expected.get(str(marker["traceHandle"]).lower())
            if candidate is None:
                continue
            marker_profile = marker["profileVersion"]
            profile_matches = marker_profile in (None, expected_profile_version) and candidate.profile_version == expected_profile_version
            matches.append(
                {
                    "traceHandle": candidate.trace_handle.lower(),
                    "scope": candidate.scope,
                    "createdAt": candidate.created_at,
                    "markerProfileVersion": marker_profile,
                    "profileVersionMatches": profile_matches,
                }
            )
        return matches

    @staticmethod
    def _base_raw(artifact: Artifact, format_name: str, tools: dict[str, str]) -> dict[str, Any]:
        return {
            "format": format_name,
            "sourceSha256": _artifact_sha256(artifact),
            "sourceBytes": len(artifact.data),
            "tools": {"python": ".".join(map(str, sys.version_info[:3])), **tools},
            "provenance": {"markers": []},
        }

    def _pdf_raw(self, artifact: Artifact) -> tuple[dict[str, Any], list[str], int]:
        try:
            document = fitz.open(stream=artifact.data, filetype="pdf")
        except Exception as exc:
            raise InvalidArtifactError("PDF evidence cannot be opened") from exc
        try:
            raw = self._base_raw(artifact, "pdf", {"pymupdf": fitz.VersionBind})
            warnings: list[str] = []
            if document.needs_pass:
                warnings.append("PDF is encrypted; protected content was not inspected")
                raw["pdf"] = {"encrypted": True, "pageCount": document.page_count}
                return raw, warnings, 0
            # Metadata often contains authoring PII.  Inspect it only to extract a
            # protocol-shaped opaque marker, never return arbitrary metadata values.
            metadata = {key: value for key, value in document.metadata.items() if value}
            metadata_text = " ".join(str(value) for value in metadata.values())
            raw["provenance"]["markers"] = _trace_markers(metadata_text)
            image_xrefs: set[int] = set()
            image_placements = 0
            text_characters: list[int] = []
            page_rects: list[dict[str, float]] = []
            for page in document:
                page_images = page.get_images(full=True)
                image_xrefs.update(image[0] for image in page_images)
                image_placements += len(page.get_image_info(xrefs=True))
                text_characters.append(len(page.get_text("text")))
                page_rects.append({"width": round(float(page.rect.width), 3), "height": round(float(page.rect.height), 3)})
            raw["pdf"] = {
                "encrypted": False,
                "pageCount": document.page_count,
                "xrefCount": document.xref_length(),
                "metadataFieldsPresent": sorted(metadata),
                "uniqueImageXrefCount": len(image_xrefs),
                "visibleImagePlacementCount": image_placements,
                "textCharactersByPage": text_characters,
                "pageGeometryPoints": page_rects,
            }
            return raw, warnings, image_placements
        finally:
            document.close()

    def _docx_raw(self, artifact: Artifact) -> tuple[dict[str, Any], list[str], int]:
        package, entries = _zip_entries(artifact, "word/document.xml")
        try:
            raw = self._base_raw(artifact, "docx", {"zipfile": "stdlib", "xml": "xml.etree.ElementTree"})
            headers = [entry for entry in entries if re.fullmatch(r"word/header\d+\.xml", entry)]
            media = [entry for entry in entries if entry.startswith("word/media/") and not entry.endswith("/")]
            marker_parts = ["docProps/core.xml"] if "docProps/core.xml" in entries else []
            raw["provenance"]["markers"] = _trace_markers(" ".join(_xml_text(package.read(part)) for part in marker_parts))
            header_blips = sum(package.read(header).count(b"<a:blip") for header in headers)
            raw["docx"] = {
                "entryCount": len(entries),
                "headerPartCount": len(headers),
                "headerImageReferenceCount": header_blips,
                "mediaPartCount": len(media),
                # Part names in a hostile package are untrusted user-controlled text;
                # preserve content measurements without returning those strings.
                "media": [{"ordinal": index, "sha256": hashlib.sha256(package.read(entry)).hexdigest(), "bytes": package.getinfo(entry).file_size} for index, entry in enumerate(media)],
                "hasCoreProperties": "docProps/core.xml" in entries,
            }
            return raw, [], header_blips
        finally:
            package.close()

    def _pptx_raw(self, artifact: Artifact) -> tuple[dict[str, Any], list[str], int]:
        package, entries = _zip_entries(artifact, "ppt/presentation.xml")
        try:
            raw = self._base_raw(artifact, "pptx", {"zipfile": "stdlib", "xml": "xml.etree.ElementTree"})
            slides = [entry for entry in entries if re.fullmatch(r"ppt/slides/slide\d+\.xml", entry)]
            media = [entry for entry in entries if entry.startswith("ppt/media/") and not entry.endswith("/")]
            marker_parts = ["docProps/core.xml"] if "docProps/core.xml" in entries else []
            raw["provenance"]["markers"] = _trace_markers(" ".join(_xml_text(package.read(part)) for part in marker_parts))
            picture_counts = [package.read(slide).count(b"<p:pic") for slide in slides]
            raw["pptx"] = {
                "entryCount": len(entries),
                "slideCount": len(slides),
                "pictureCountBySlide": picture_counts,
                "mediaPartCount": len(media),
                "media": [{"ordinal": index, "sha256": hashlib.sha256(package.read(entry)).hexdigest(), "bytes": package.getinfo(entry).file_size} for index, entry in enumerate(media)],
                "hasCoreProperties": "docProps/core.xml" in entries,
            }
            return raw, [], sum(picture_counts)
        finally:
            package.close()
