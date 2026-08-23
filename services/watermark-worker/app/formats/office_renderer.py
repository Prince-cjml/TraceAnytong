"""Optional, fail-closed LibreOffice rendering for native Office evidence.

The worker does not require LibreOffice.  This adapter is deliberately only a
bridge from a leased DOCX/PPTX evidence copy to the existing PDF renderer; it
never edits the source artifact or invents visual evidence when conversion is
not available.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

from ..models import Artifact


_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
_OFFICE_MIME_TYPES = frozenset({_DOCX_MIME, _PPTX_MIME})
_EXTENSIONS = {_DOCX_MIME: ".docx", _PPTX_MIME: ".pptx"}
_VERSION_TIMEOUT_SECONDS = 5
_DEFAULT_CONVERT_TIMEOUT_SECONDS = 60


@dataclass(frozen=True)
class OfficeRenderResult:
    """A conversion outcome suitable for audit evidence, never an exception path."""

    pdf: Artifact | None
    raw: dict[str, object]
    warnings: tuple[str, ...] = ()


class OfficeRenderer:
    """Convert a DOCX/PPTX copy to PDF with a configured or discovered soffice.

    ``WORKER_OFFICE_RENDERER_PATH`` is an operator-controlled executable path
    (or command discoverable on PATH).  With no explicit configuration, only
    ``soffice`` and ``libreoffice`` are probed.  Every invocation uses a fixed
    argument vector, a private temporary home, and a per-call output directory.
    """

    renderer_version = "libreoffice-pdf-bridge-v1"

    def __init__(self, env: Mapping[str, str] | None = None) -> None:
        self._env = env

    @property
    def _values(self) -> Mapping[str, str]:
        return os.environ if self._env is None else self._env

    @staticmethod
    def _safe_version(value: str) -> str:
        return " ".join(value.split())[:200]

    def _timeout_seconds(self) -> int:
        raw = self._values.get("WORKER_OFFICE_RENDER_TIMEOUT_SECONDS")
        if raw is None:
            return _DEFAULT_CONVERT_TIMEOUT_SECONDS
        try:
            value = int(raw)
        except ValueError:
            return _DEFAULT_CONVERT_TIMEOUT_SECONDS
        return min(max(value, 1), 300)

    def _resolve_executable(self) -> tuple[str | None, str]:
        configured = self._values.get("WORKER_OFFICE_RENDERER_PATH", "").strip()
        if configured:
            resolved = shutil.which(configured)
            if resolved is None:
                candidate = Path(configured)
                if candidate.is_file():
                    resolved = str(candidate)
            return resolved, "configured"
        for executable in ("soffice", "libreoffice"):
            resolved = shutil.which(executable)
            if resolved:
                return resolved, "detected"
        return None, "not_found"

    @staticmethod
    def _subprocess_env(directory: Path) -> dict[str, str]:
        # Keep LibreOffice profiles, caches, and temporary files isolated from
        # the process/user profile.  Preserve the normal environment so an
        # absolute, already-resolved executable retains platform dependencies.
        env = dict(os.environ)
        location = str(directory)
        env.update({"HOME": location, "USERPROFILE": location, "TMP": location, "TEMP": location, "TMPDIR": location})
        return env

    def _version(self, executable: str) -> tuple[str | None, str | None]:
        try:
            completed = subprocess.run(
                [executable, "--version"],
                check=False,
                capture_output=True,
                text=True,
                timeout=_VERSION_TIMEOUT_SECONDS,
                shell=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            return None, "version_unavailable"
        if completed.returncode != 0:
            return None, "version_unavailable"
        version = self._safe_version(completed.stdout or completed.stderr)
        return (version or None), None

    def render(self, artifact: Artifact) -> OfficeRenderResult:
        if artifact.mime_type not in _OFFICE_MIME_TYPES:
            return OfficeRenderResult(None, {"rendererVersion": self.renderer_version, "available": False, "attempted": False, "status": "unsupported_mime"}, ("Office visual rendering supports DOCX and PPTX evidence only.",))
        executable, selection = self._resolve_executable()
        if executable is None:
            return OfficeRenderResult(
                None,
                {"rendererVersion": self.renderer_version, "available": False, "attempted": False, "status": "unavailable", "selection": selection, "externalVersion": None},
                ("Office visual rendering is unavailable; native structure evidence remains insufficient.",),
            )
        version, version_error = self._version(executable)
        if version_error:
            return OfficeRenderResult(
                None,
                {"rendererVersion": self.renderer_version, "available": False, "attempted": False, "status": version_error, "selection": selection, "externalVersion": None},
                ("Office renderer version could not be verified; native structure evidence remains insufficient.",),
            )
        try:
            with tempfile.TemporaryDirectory(prefix="traceanytong-office-") as temporary:
                root = Path(temporary)
                input_path = root / f"evidence{_EXTENSIONS[artifact.mime_type]}"
                output_directory = root / "output"
                output_directory.mkdir()
                # Input is a new private copy with a controlled filename.  The
                # downloaded evidence object is never opened for writing.
                input_path.write_bytes(artifact.data)
                try:
                    completed = subprocess.run(
                        [
                            executable,
                            "--headless",
                            "--nologo",
                            "--nodefault",
                            "--nolockcheck",
                            "--nofirststartwizard",
                            "--convert-to",
                            "pdf:writer_pdf_Export",
                            "--outdir",
                            str(output_directory),
                            str(input_path),
                        ],
                        check=False,
                        capture_output=True,
                        text=True,
                        timeout=self._timeout_seconds(),
                        cwd=str(root),
                        env=self._subprocess_env(root),
                        shell=False,
                    )
                except subprocess.TimeoutExpired:
                    return OfficeRenderResult(None, {"rendererVersion": self.renderer_version, "available": True, "attempted": True, "status": "conversion_timed_out", "selection": selection, "externalVersion": version}, ("Office conversion timed out; native structure evidence remains insufficient.",))
                except OSError:
                    return OfficeRenderResult(None, {"rendererVersion": self.renderer_version, "available": True, "attempted": True, "status": "conversion_failed", "selection": selection, "externalVersion": version}, ("Office conversion failed; native structure evidence remains insufficient.",))
                if completed.returncode != 0:
                    return OfficeRenderResult(None, {"rendererVersion": self.renderer_version, "available": True, "attempted": True, "status": "conversion_failed", "selection": selection, "externalVersion": version, "exitCode": completed.returncode}, ("Office conversion failed; native structure evidence remains insufficient.",))
                pdfs = [path for path in output_directory.glob("*.pdf") if path.is_file() and path.parent == output_directory]
                if len(pdfs) != 1:
                    return OfficeRenderResult(None, {"rendererVersion": self.renderer_version, "available": True, "attempted": True, "status": "invalid_output", "selection": selection, "externalVersion": version, "outputCount": len(pdfs)}, ("Office conversion did not produce exactly one PDF; native structure evidence remains insufficient.",))
                data = pdfs[0].read_bytes()
                if not data:
                    return OfficeRenderResult(None, {"rendererVersion": self.renderer_version, "available": True, "attempted": True, "status": "invalid_output", "selection": selection, "externalVersion": version, "outputCount": 1}, ("Office conversion produced an empty PDF; native structure evidence remains insufficient.",))
                return OfficeRenderResult(
                    Artifact(data, "application/pdf", "office-rendered-evidence.pdf"),
                    {"rendererVersion": self.renderer_version, "available": True, "attempted": True, "status": "rendered", "selection": selection, "externalVersion": version, "outputPages": None},
                )
        except OSError:
            return OfficeRenderResult(None, {"rendererVersion": self.renderer_version, "available": True, "attempted": True, "status": "temporary_storage_failed", "selection": selection, "externalVersion": version}, ("Office rendering workspace could not be created; native structure evidence remains insufficient.",))
