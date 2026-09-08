"""Citations must name the actual source version and original location."""
import json
import shutil
import zipfile

import pytest

from hermes_cli import projects_db
from hermes_cli.project_references import scan_references, index_references, search_references, reference_citation
from tui_gateway import server


def setup_project(tmp_path):
    folder = tmp_path / "Client"
    folder.mkdir()
    with projects_db.connect_closing() as conn:
        pid = projects_db.create_project(conn, name="Client", folders=[str(folder)])
    return folder, pid


def docx(path, paragraphs):
    from xml.sax.saxutils import escape
    xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    xml += ''.join('<w:p><w:r><w:t>' + escape(text) + '</w:t></w:r></w:p>' for text in paragraphs)
    xml += '</w:body></w:document>'
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("word/document.xml", xml)


def test_arabic_word_citation_and_previous_versions_survive_reopen(tmp_path):
    folder, pid = setup_project(tmp_path)
    source = folder / "Client feedback.docx"
    docx(source, ["Project feedback", "", "طلب أحمد تعديل وصف شركة إسكان قبل التسليم."])
    with projects_db.connect_closing() as conn:
        assert scan_references(conn, pid)["pending"] == 1
        assert index_references(conn, pid)["indexed"] == 1
        first = search_references(conn, pid, "احمد اسكان")["matches"][0]
        assert (first["locator"], first["start"]) == ("paragraph", 3)
        assert first["path"] == str(source)
        assert "أحمد" in first["text"]
        old_hash = first["sha256"]
        docx(source, ["Approved feedback", "تم اعتماد وصف إسكان دون تغيير."])
        scan_references(conn, pid)
        index_references(conn, pid)
    with projects_db.connect_closing() as conn:
        current = search_references(conn, pid, "اسكان")["matches"]
        assert len(current) == 1 and current[0]["sha256"] != old_hash
        historical = search_references(conn, pid, "اسكان", include_history=True)["matches"]
        assert len(historical) == 2
        assert next(hit for hit in historical if hit["sha256"] == old_hash)["is_current"] == 0
        assert reference_citation(conn, pid, first["citation_id"])["text"] == first["text"]
        assert scan_references(conn, pid)["pending"] == 0


def test_sources_are_scoped_and_secret_or_external_symlinks_are_not_indexed(tmp_path):
    folder, pid = setup_project(tmp_path)
    (folder / "brief.md").write_text("Approved delivery scope and project timeline")
    hidden = folder / ".secrets"
    hidden.mkdir()
    (hidden / "secret.md").write_text("Confidential credential")
    outside = tmp_path / "outside.md"
    outside.write_text("Not a registered source")
    (folder / "alias.md").symlink_to(outside)
    with projects_db.connect_closing() as conn:
        scan = scan_references(conn, pid)
        assert scan["discovered"] == 1
        index_references(conn, pid)
        hit = search_references(conn, pid, "delivery")["matches"][0]
        other = projects_db.create_project(conn, name="Other")
        assert search_references(conn, other, "delivery")["matches"] == []
    assert "error" in server._methods["projects.references.citation"](1, {"id": other, "citation_id": hit["citation_id"]})
    assert server._methods["projects.references.search"](2, {"id": pid, "query": "delivery"})["result"]["matches"][0]["citation_id"] == hit["citation_id"]


def test_deleted_and_malformed_files_do_not_claim_current_evidence(tmp_path):
    folder, pid = setup_project(tmp_path)
    source = folder / "meeting.txt"
    source.write_text("Client requested horizontal project tabs.")
    (folder / "broken.docx").write_bytes(b"not a zip")
    with projects_db.connect_closing() as conn:
        scan_references(conn, pid)
        outcome = index_references(conn, pid)
        assert outcome["indexed"] == 1 and len(outcome["failures"]) == 1
        source.unlink()
        scan_references(conn, pid)
        assert search_references(conn, pid, "horizontal")["matches"] == []
        assert search_references(conn, pid, "horizontal", include_history=True)["matches"][0]["status"] == "missing"


def test_line_locators_and_literal_query_punctuation(tmp_path):
    folder, pid = setup_project(tmp_path)
    (folder / "notes.md").write_text("\n".join(["Intro"] * 30 + ["Client approval requires mobile testing."]))
    with projects_db.connect_closing() as conn:
        scan_references(conn, pid)
        index_references(conn, pid)
        hit = search_references(conn, pid, 'mobile " OR * (')["matches"][0]
        assert hit["locator"] == "line" and hit["start"] == 31 and hit["end"] == 31


def test_word_comments_preserve_only_explicit_attribution(tmp_path):
    folder, pid = setup_project(tmp_path)
    source = folder / "Review.docx"
    docx(source, ["Delivery"])
    with zipfile.ZipFile(source, "a") as archive:
        archive.writestr("word/comments.xml", '''<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:comment w:id="8" w:author="Amina" w:date="2026-09-08T10:00:00Z"><w:p><w:r><w:t>Update the portfolio tabs.</w:t></w:r></w:p></w:comment>
          <w:comment w:id="9"><w:p><w:r><w:t>Check the mobile spacing.</w:t></w:r></w:p></w:comment>
        </w:comments>''')
    with projects_db.connect_closing() as conn:
        scan_references(conn, pid)
        index_references(conn, pid)
        attributed = search_references(conn, pid, "portfolio")["matches"][0]
        assert attributed["locator"] == "comment" and attributed["start"] == 1
        assert "Amina; 2026-09-08T10:00:00Z" in attributed["text"]
        anonymous = search_references(conn, pid, "spacing")["matches"][0]
        assert anonymous["text"] == "Check the mobile spacing."


def test_missing_root_retires_current_citations_but_preserves_history(tmp_path):
    folder, pid = setup_project(tmp_path)
    (folder / "brief.txt").write_text("Verified portfolio requirements")
    with projects_db.connect_closing() as conn:
        scan_references(conn, pid)
        index_references(conn, pid)
        folder.rename(tmp_path / "Renamed")
        assert scan_references(conn, pid)["failures"]
        assert search_references(conn, pid, "portfolio")["matches"] == []
        old = search_references(conn, pid, "portfolio", include_history=True)["matches"][0]
        assert old["is_current"] == 0 and old["status"] == "unavailable"


@pytest.mark.skipif(shutil.which("pdftotext") is None, reason="Local PDF extractor unavailable")
def test_real_pdf_page_citation_and_blank_page_coverage(tmp_path):
    folder, pid = setup_project(tmp_path)
    # Minimal real PDF, including an intentionally blank second page.
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>",
               b"<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
               b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
               b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] >>",
               b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    stream = b"BT /F1 12 Tf 20 200 Td (Portfolio delivery approved) Tj ET"
    objects.append(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream")
    data = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for number, body in enumerate(objects, 1):
        offsets.append(len(data))
        data.extend(f"{number} 0 obj\n".encode() + body + b"\nendobj\n")
    xref = len(data)
    data.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        data.extend(f"{offset:010} 00000 n \n".encode())
    data.extend(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode())
    (folder / "Delivery.pdf").write_bytes(data)
    with projects_db.connect_closing() as conn:
        scan_references(conn, pid)
        assert index_references(conn, pid)["indexed"] == 1
        hit = search_references(conn, pid, "portfolio")["matches"][0]
        assert hit["locator"] == "page" and hit["start"] == 1
        assert hit["status"] == "partial" and json.loads(hit["missing_pages"]) == [2]
