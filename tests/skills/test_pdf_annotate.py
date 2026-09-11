"""Contracts for pdf_annotate.py, the PDF comment round trip.

A reviewed PDF is only workable if the comments survive every edit: the
threading key must be an indirect reference or no viewer groups a reply,
the review state must be readable back off the parent, Arabic contents
must leave as UTF-16 rather than mojibake, and a form must still have its
fields after a comment is added or removed.

Every test drives the CLI in a child process, because the CLI contract
(JSON on stdout, non-zero exit on failure) is what the skill promises.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

pypdf = pytest.importorskip("pypdf")

REPO = Path(__file__).resolve().parents[2]
SCRIPTS = REPO / "skills" / "productivity" / "pdf" / "scripts"
ANNOTATE = SCRIPTS / "pdf_annotate.py"
CREATE = SCRIPTS / "pdf_create.py"
MAKE_FORM = SCRIPTS / "pdf_make_form.py"

ARABIC = "ملاحظة بالعربية: يرجى تأكيد العدد"


def run(*args: str, expect: int = 0) -> dict:
    """Run the CLI and return its parsed JSON, asserting the exit code."""
    proc = subprocess.run(
        [sys.executable, str(ANNOTATE), *[str(a) for a in args]],
        capture_output=True, text=True, encoding="utf-8",
    )
    assert proc.returncode == expect, (
        f"exit {proc.returncode} (wanted {expect})\n"
        f"stdout: {proc.stdout}\nstderr: {proc.stderr}"
    )
    payload = proc.stdout if expect == 0 else proc.stderr
    return json.loads(payload)


def _build(script: Path, spec: dict, out: Path) -> Path:
    spec_path = out.with_suffix(".json")
    spec_path.write_text(json.dumps(spec), encoding="utf-8")
    proc = subprocess.run(
        [sys.executable, str(script), str(spec_path), "-o", str(out)],
        capture_output=True, text=True, encoding="utf-8",
    )
    assert proc.returncode == 0, proc.stderr
    return out


@pytest.fixture(scope="module")
def plain_pdf(tmp_path_factory) -> Path:
    pytest.importorskip("reportlab")
    out = tmp_path_factory.mktemp("pdf_annotate") / "plain.pdf"
    return _build(CREATE, {
        "title": "Annotation Demo",
        "author": "hermes",
        "elements": [
            {"type": "heading", "text": "Quarterly Review", "level": 1},
            {"type": "paragraph",
             "text": "Revenue grew 34 percent against a target of 20 percent."},
            {"type": "paragraph",
             "text": "Headcount stayed flat at 41 people."},
        ],
    }, out)


@pytest.fixture(scope="module")
def form_pdf(tmp_path_factory) -> Path:
    pytest.importorskip("reportlab")
    out = tmp_path_factory.mktemp("pdf_annotate_form") / "form.pdf"
    return _build(MAKE_FORM, {
        "title": "Intake",
        "page_size": "A4",
        "page_count": 1,
        "fields": [
            {"name": "surname", "type": "text", "page": 1, "label": "Surname",
             "label_box": [72, 700, 150, 714],
             "entry_box": [160, 696, 400, 716], "value": ""},
            {"name": "agree", "type": "checkbox", "page": 1, "label": "I agree",
             "label_box": [72, 660, 150, 674],
             "entry_box": [160, 658, 176, 674], "checked": False},
        ],
    }, out)


def _annots(path: Path) -> list:
    reader = pypdf.PdfReader(str(path))
    found = []
    for page in reader.pages:
        array = page.get("/Annots")
        if array is None:
            continue
        found.extend(array.get_object())
    return found


def _by_id(listing: dict, ident: str) -> dict:
    for entry in listing["annotations"]:
        if entry["id"] == ident:
            return entry
    raise AssertionError(f"{ident} not in {[e['id'] for e in listing['annotations']]}")


# ---------------------------------------------------------------------------
# Reading and adding
# ---------------------------------------------------------------------------


def test_a_file_with_no_annotations_lists_empty(plain_pdf):
    """An unmarked file is an empty list, not an exception."""
    listing = run("list", plain_pdf)
    assert listing["annotation_count"] == 0
    assert listing["comment_count"] == 0
    assert listing["annotations"] == []
    assert listing["page_count"] == 1


def test_a_note_reads_back_with_its_author_dates_and_rect(plain_pdf, tmp_path):
    out = tmp_path / "noted.pdf"
    added = run("add", plain_pdf, "-o", out, "--page", "1",
                "--rect", "72", "600", "92", "620",
                "--contents", "Check this figure", "--author", "Reviewer")
    entry = _by_id(run("list", out), added["id"])
    assert entry["subtype"] == "/Text"
    assert entry["author"] == "Reviewer"
    assert entry["contents"] == "Check this figure"
    assert entry["page"] == 1
    assert entry["rect"] == pytest.approx([72.0, 600.0, 92.0, 620.0])
    # Both dates are written and both parse to ISO 8601.
    assert entry["created_iso"] and entry["modified_iso"]
    assert entry["created_iso"].startswith("20")
    assert entry["thread_state"] is None and entry["resolved"] is False


def test_a_rectangle_off_the_page_is_refused(plain_pdf, tmp_path):
    error = run("add", plain_pdf, "-o", tmp_path / "bad.pdf", "--page", "1",
                "--rect", "5000", "5000", "5020", "5020",
                "--contents", "nowhere", expect=4)
    assert "outside page" in error["error"]


def test_an_anchored_highlight_lands_on_the_matched_text(plain_pdf, tmp_path):
    """The rect comes from the text, and the quote comes back with it."""
    pytest.importorskip("pdfplumber")
    out = tmp_path / "highlit.pdf"
    added = run("add", plain_pdf, "-o", out, "--anchor-text", "34 percent",
                "--type", "highlight", "--contents", "Against which baseline?",
                "--author", "Reviewer")
    assert added["quoted_text"] == "34 percent"
    x0, y0, x1, y1 = added["rect"]
    assert x1 > x0 and y1 > y0
    assert 0 < x0 < 595 and 0 < y0 < 842, "the rect must sit on an A4 page"

    entry = _by_id(run("list", out), added["id"])
    assert entry["subtype"] == "/Highlight"
    assert entry["quoted_text"] == "34 percent"
    raw = next(a.get_object() for a in _annots(out)
               if str(a.get_object().get("/NM", "")) == added["id"])
    quads = [float(v) for v in raw["/QuadPoints"]]
    assert len(quads) == 8, "a highlight needs one quad of four corners"
    assert min(quads) > 0


def test_missing_anchor_text_fails_loudly(plain_pdf, tmp_path):
    pytest.importorskip("pdfplumber")
    error = run("add", plain_pdf, "-o", tmp_path / "none.pdf",
                "--anchor-text", "a phrase that is not there",
                "--contents", "x", expect=4)
    assert "not found" in error["error"]


# ---------------------------------------------------------------------------
# Threading
# ---------------------------------------------------------------------------


@pytest.fixture()
def thread(plain_pdf, tmp_path):
    """A comment with one reply, plus the ids of both."""
    first = tmp_path / "one.pdf"
    parent = run("add", plain_pdf, "-o", first, "--page", "1",
                 "--rect", "72", "600", "92", "620",
                 "--contents", "Which baseline?", "--author", "Reviewer")
    second = tmp_path / "two.pdf"
    reply = run("reply", first, "-o", second, "--id", parent["id"],
                "--contents", "Baseline is FY2025 Q3.", "--author", "Hermes")
    return {"path": second, "parent": parent["id"], "reply": reply["id"]}


def test_a_reply_carries_an_indirect_irt_and_rt_r(thread):
    """/IRT must reference the parent object, not hold a copy of it."""
    objects = {str(a.get_object().get("/NM", "")): a for a in _annots(thread["path"])}
    parent_ref = objects[thread["parent"]]
    reply = objects[thread["reply"]].get_object()

    raw_irt = reply.raw_get("/IRT")
    assert isinstance(raw_irt, pypdf.generic.IndirectObject), (
        "a direct /IRT copy does not thread in any viewer"
    )
    assert raw_irt.idnum == parent_ref.idnum
    assert str(reply["/RT"]) == "/R"

    entry = _by_id(run("list", thread["path"]), thread["reply"])
    assert entry["reply_to"] == thread["parent"]
    assert entry["reply_type"] == "/R"
    assert entry["is_reply"] is True


def test_resolve_sets_the_review_state_and_reports_it_on_the_parent(thread, tmp_path):
    out = tmp_path / "resolved.pdf"
    marked = run("resolve", thread["path"], "-o", out, "--id", thread["parent"],
                 "--state", "Accepted", "--author", "Hermes")
    assert marked["state"] == "Accepted"
    assert marked["resolved"] is True
    assert "Acrobat" in marked["viewer_support"]

    listing = run("list", out)
    parent = _by_id(listing, thread["parent"])
    assert parent["resolved"] is True
    assert parent["thread_state"]["state"] == "Accepted"
    assert parent["thread_state"]["state_model"] == "Review"
    assert parent["thread_state"]["by"] == "Hermes"

    state = _by_id(listing, marked["id"])
    assert state["is_state"] is True
    assert state["is_reply"] is False, (
        "a state marker is thread bookkeeping, not a phantom empty comment"
    )
    raw = next(a.get_object() for a in _annots(out)
               if str(a.get_object().get("/NM", "")) == marked["id"])
    assert str(raw["/StateModel"]) == "Review"
    assert str(raw["/State"]) == "Accepted"


def test_an_unknown_id_is_an_error_not_a_silent_no_op(thread, tmp_path):
    error = run("reply", thread["path"], "-o", tmp_path / "no.pdf",
                "--id", "nosuchid", "--contents", "hello", expect=4)
    assert "No annotation with id" in error["error"]


# ---------------------------------------------------------------------------
# Deleting
# ---------------------------------------------------------------------------


def test_delete_removes_the_comment_and_its_replies(thread, tmp_path):
    resolved = tmp_path / "resolved.pdf"
    run("resolve", thread["path"], "-o", resolved, "--id", thread["parent"],
        "--state", "Accepted")
    survivor = run("add", resolved, "-o", tmp_path / "plus.pdf", "--page", "1",
                   "--rect", "200", "400", "220", "420",
                   "--contents", "unrelated note")

    out = tmp_path / "deleted.pdf"
    removed = run("delete", tmp_path / "plus.pdf", "-o", out,
                  "--id", thread["parent"])
    gone = {entry["id"] for entry in removed["removed"]}
    assert thread["parent"] in gone
    assert thread["reply"] in gone, "a reply must not outlive its comment"

    listing = run("list", out)
    ids = {entry["id"] for entry in listing["annotations"]}
    assert thread["parent"] not in ids and thread["reply"] not in ids
    assert survivor["id"] in ids, "an unrelated comment must survive"
    # The state marker went with the thread it marked.
    assert all(not entry["is_state"] for entry in listing["annotations"])


def test_delete_refuses_a_form_field_widget(form_pdf, tmp_path):
    widgets = [entry for entry in
               run("list", form_pdf, "--include-widgets")["annotations"]
               if entry["subtype"] == "/Widget"]
    assert widgets, "the fixture form must have widgets"
    error = run("delete", form_pdf, "-o", tmp_path / "nope.pdf",
                "--id", widgets[0]["id"], expect=4)
    assert "form field widget" in error["error"]
    assert not (tmp_path / "nope.pdf").exists()


# ---------------------------------------------------------------------------
# What must survive an edit
# ---------------------------------------------------------------------------


def test_arabic_contents_round_trip_as_utf16(plain_pdf, tmp_path):
    """PDFDocEncoding cannot hold Arabic, so the string must go out UTF-16."""
    out = tmp_path / "arabic.pdf"
    added = run("add", plain_pdf, "-o", out, "--page", "1",
                "--rect", "72", "600", "92", "620",
                "--contents", ARABIC, "--author", "مراجع")
    entry = _by_id(run("list", out), added["id"])
    assert entry["contents"] == ARABIC
    assert entry["author"] == "مراجع"

    # A symmetric round trip passes even when both ends are wrong together,
    # so check the bytes: a UTF-16BE byte order mark, raw or octal escaped.
    blob = out.read_bytes()
    assert b"\xfe\xff" in blob or rb"\376\377" in blob


def test_a_form_keeps_its_fields_and_metadata_through_an_edit(form_pdf, tmp_path):
    before = pypdf.PdfReader(str(form_pdf))
    fields_before = sorted((before.get_fields() or {}).keys())
    meta_before = dict(before.metadata or {})
    assert fields_before == ["agree", "surname"]

    noted = tmp_path / "form_noted.pdf"
    added = run("add", form_pdf, "-o", noted, "--page", "1",
                "--rect", "72", "600", "300", "620",
                "--contents", "Confirm the spelling", "--author", "Reviewer")
    after_add = pypdf.PdfReader(str(noted))
    assert sorted((after_add.get_fields() or {}).keys()) == fields_before
    assert dict(after_add.metadata or {}) == meta_before
    assert len(after_add.pages) == len(before.pages)

    cleared = tmp_path / "form_cleared.pdf"
    run("delete", noted, "-o", cleared, "--id", added["id"])
    after_delete = pypdf.PdfReader(str(cleared))
    assert sorted((after_delete.get_fields() or {}).keys()) == fields_before, (
        "deleting a comment must not strip a form field from /Annots"
    )
    assert dict(after_delete.metadata or {}) == meta_before
    listing = run("list", cleared)
    assert listing["annotation_count"] == 0


def test_widgets_are_hidden_from_the_comment_list_by_default(form_pdf):
    listing = run("list", form_pdf)
    assert listing["annotation_count"] == 0, (
        "form fields live in /Annots but they are not comments"
    )
    with_widgets = run("list", form_pdf, "--include-widgets")
    assert any(entry["subtype"] == "/Widget"
               for entry in with_widgets["annotations"])
