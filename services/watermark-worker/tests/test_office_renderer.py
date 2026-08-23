import subprocess
from pathlib import Path

import fitz

from app.formats.office_renderer import OfficeRenderer
from app.models import Artifact


DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _pdf_bytes() -> bytes:
    document = fitz.open()
    document.new_page()
    data = document.tobytes()
    document.close()
    return data


def test_office_renderer_uses_fixed_arguments_and_cleans_private_files(monkeypatch) -> None:
    source = Artifact(b"native-office-copy", DOCX, "user-controlled-name.docx")
    calls: list[tuple[list[str], dict]] = []
    observed_paths: list[Path] = []

    monkeypatch.setattr("app.formats.office_renderer.shutil.which", lambda value: "C:/tools/soffice.exe" if value == "soffice" else None)

    def fake_run(args: list[str], **kwargs):
        calls.append((args, kwargs))
        assert kwargs["shell"] is False
        if args[1:] == ["--version"]:
            return subprocess.CompletedProcess(args, 0, "LibreOffice 24.2.5.2\n", "")
        assert args[1:6] == ["--headless", "--nologo", "--nodefault", "--nolockcheck", "--nofirststartwizard"]
        assert args[6:8] == ["--convert-to", "pdf:writer_pdf_Export"]
        output_directory = Path(args[args.index("--outdir") + 1])
        input_path = Path(args[-1])
        assert input_path.name == "evidence.docx"
        assert input_path.read_bytes() == source.data
        assert input_path.parent == output_directory.parent
        assert kwargs["cwd"] == str(input_path.parent)
        assert kwargs["env"]["HOME"] == str(input_path.parent)
        (output_directory / "evidence.pdf").write_bytes(_pdf_bytes())
        observed_paths.extend((input_path.parent, output_directory, input_path))
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr("app.formats.office_renderer.subprocess.run", fake_run)
    result = OfficeRenderer({}).render(source)

    assert result.pdf is not None
    assert result.pdf.mime_type == "application/pdf"
    assert source.data == b"native-office-copy"
    assert result.raw == {
        "rendererVersion": "libreoffice-pdf-bridge-v1",
        "available": True,
        "attempted": True,
        "status": "rendered",
        "selection": "detected",
        "externalVersion": "LibreOffice 24.2.5.2",
        "outputPages": None,
    }
    assert len(calls) == 2
    assert all(not path.exists() for path in observed_paths)


def test_office_renderer_fails_closed_when_conversion_fails(monkeypatch) -> None:
    calls: list[list[str]] = []
    monkeypatch.setattr("app.formats.office_renderer.shutil.which", lambda value: "C:/tools/soffice.exe")

    def fake_run(args: list[str], **kwargs):
        calls.append(args)
        if args[1:] == ["--version"]:
            return subprocess.CompletedProcess(args, 0, "LibreOffice 24.2\n", "")
        return subprocess.CompletedProcess(args, 7, "", "conversion failed")

    monkeypatch.setattr("app.formats.office_renderer.subprocess.run", fake_run)
    result = OfficeRenderer({"WORKER_OFFICE_RENDERER_PATH": "soffice"}).render(Artifact(b"office", DOCX))

    assert result.pdf is None
    assert result.raw["available"] is True
    assert result.raw["attempted"] is True
    assert result.raw["status"] == "conversion_failed"
    assert result.raw["externalVersion"] == "LibreOffice 24.2"
    assert result.warnings == ("Office conversion failed; native structure evidence remains insufficient.",)
    assert len(calls) == 2


def test_office_renderer_is_unavailable_without_a_configured_or_detected_binary(monkeypatch) -> None:
    monkeypatch.setattr("app.formats.office_renderer.shutil.which", lambda value: None)

    result = OfficeRenderer({}).render(Artifact(b"office", DOCX))

    assert result.pdf is None
    assert result.raw["available"] is False
    assert result.raw["attempted"] is False
    assert result.raw["status"] == "unavailable"
    assert result.raw["externalVersion"] is None
