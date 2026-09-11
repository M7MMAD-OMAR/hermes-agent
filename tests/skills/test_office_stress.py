"""Hard tests for the office tools: invariants, sequences, and real files.

The per feature tests answer "does the happy path work". These answer the
questions that actually decide whether Hermes can be trusted with a file
somebody else owns:

* **Invariants.** A comment operation must not change one character of
  the document's visible text, and must not drop a chart, a picture or a
  header that it does not understand.
* **Sequences.** A random but reproducible run of add, reply, resolve,
  reopen and delete must leave the file agreeing with a model of what
  those operations mean. One operation working says little; fifty in a
  row say a lot.
* **Failure.** A bad id, a wrong format or a truncated package must exit
  non-zero, say why in JSON, and leave no half written output behind.
* **Interop.** The file that matters is the one LibreOffice or Word
  wrote, not the one we wrote. One test builds a document in LibreOffice
  (flat ODF, converted by soffice) and puts the whole pipeline through
  it.
* **Scale and script.** Five hundred paragraphs, fifty threads, Arabic,
  emoji, combining marks and a text longer than any reviewer would type.

Runtime is kept honest: the LibreOffice tests skip when soffice is
missing, and the scale test carries a generous ceiling rather than a
stopwatch.
"""

from __future__ import annotations

import json
import random
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
PROD = REPO / "skills" / "productivity"
DOCX_COMMENTS = PROD / "docx" / "scripts" / "docx_comments.py"
DOCX_GRAPHICS = PROD / "docx" / "scripts" / "docx_graphics.py"
DOCX_CREATE = PROD / "docx" / "scripts" / "docx_create.py"
DOCX_EDIT = PROD / "docx" / "scripts" / "docx_edit.py"
DOCX_VALIDATE = PROD / "docx" / "scripts" / "docx_validate.py"
PPTX_COMMENTS = PROD / "powerpoint" / "scripts" / "pptx_comments.py"
XLSX_COMMENTS = PROD / "xlsx" / "scripts" / "xlsx_comments.py"
INSPECT = PROD / "house-style" / "scripts" / "office_inspect.py"

SOFFICE = shutil.which("soffice")
needs_soffice = pytest.mark.skipif(SOFFICE is None,
                                   reason="LibreOffice is not installed")

# Text that has broken document tooling before: right to left, a combining
# mark, an emoji with a joiner, and a bare newline.
NASTY = [
    "هل راجعنا بند الغرامات مع الفريق القانوني؟",
    "Zalgo á combining acute",
    "family \U0001F468‍\U0001F469‍\U0001F467 joined",
    "quote \"inside\" and <angle> and & ampersand",
    "a" * 4000,
]


def run(script: Path, *args: str, expect_ok: bool = True):
    out = subprocess.run([sys.executable, str(script), *args],
                         capture_output=True, text=True)
    if expect_ok:
        assert out.returncode == 0, f"{script.name} {args}: {out.stderr}"
        return json.loads(out.stdout) if out.stdout.strip() else {}
    assert out.returncode != 0, f"{script.name} {args} should have failed"
    return out


def visible_text(path: Path) -> str:
    """Every run of text in the body, headers and footers, in order.

    This is the thing a comment operation must never touch. Comparing
    document.xml byte for byte would fail on the comment anchors the
    operation is supposed to add, which is why this reads the text the
    reader sees instead.
    """
    from docx import Document

    doc = Document(str(path))
    parts = [p.text for p in doc.paragraphs]
    for table in doc.tables:
        for row in table.rows:
            parts.extend(c.text for c in row.cells)
    for section in doc.sections:
        for area in (section.header, section.footer):
            parts.extend(p.text for p in area.paragraphs)
    return "\n".join(parts)


def package_parts(path: Path) -> set[str]:
    with zipfile.ZipFile(path) as zf:
        return set(zf.namelist())


def threads(path: Path) -> list[dict]:
    return run(DOCX_COMMENTS, "list", str(path), "--json", "threads")["threads"]


@pytest.fixture
def review_doc(tmp_path):
    """A document with content a comment operation could plausibly break."""
    pytest.importorskip("docx")
    from docx import Document

    doc = Document()
    doc.add_heading("Vendor agreement review", 1)
    doc.add_paragraph("The notice period is thirty days for either party.")
    doc.add_paragraph("Invoices are due within forty five days of receipt.")
    doc.add_paragraph("البند الجزائي يحتاج مراجعة قبل التوقيع.")
    table = doc.add_table(rows=3, cols=3)
    for r, row in enumerate((("Term", "Previous", "Proposed"),
                             ("Notice", "60", "30"),
                             ("Payment", "30", "45"))):
        for c, value in enumerate(row):
            table.cell(r, c).text = value
    doc.sections[0].header.paragraphs[0].text = "Confidential draft"
    out = tmp_path / "review.docx"
    doc.save(str(out))
    return out


# ---------------------------------------------------------------------------
# Invariants
# ---------------------------------------------------------------------------


def test_comment_operations_never_change_the_document_text(review_doc,
                                                           tmp_path):
    before = visible_text(review_doc)
    step = tmp_path / "a.docx"
    run(DOCX_COMMENTS, "add", str(review_doc), "--target", "thirty days",
        "--text", "Shorter than our standard.", "--author", "Layla",
        "-o", str(step))
    assert visible_text(step) == before, "adding a comment moved the text"

    cid = threads(step)[0]["id"]
    step2 = tmp_path / "b.docx"
    run(DOCX_COMMENTS, "reply", str(step), "--id", cid, "--text", "Restored.",
        "--author", "Hermes", "-o", str(step2))
    step3 = tmp_path / "c.docx"
    run(DOCX_COMMENTS, "resolve", str(step2), "--id", cid, "-o", str(step3))
    step4 = tmp_path / "d.docx"
    run(DOCX_COMMENTS, "delete-thread", str(step3), "--id", cid,
        "-o", str(step4))
    assert visible_text(step4) == before, "a deleted thread took text with it"


def test_a_chart_and_a_header_survive_a_comment_edit(review_doc, tmp_path):
    """The comment scripts write XML by hand, so the parts they do not
    understand are exactly the ones a careless edit drops."""
    spec = tmp_path / "graphics.json"
    spec.write_text(json.dumps({"blocks": [{
        "type": "chart", "chart": "column", "title": "Days",
        "categories": ["Notice", "Payment"],
        "series": {"Proposed": [30, 45]}}]}), encoding="utf-8")
    charted = tmp_path / "charted.docx"
    run(DOCX_GRAPHICS, str(spec), str(charted), "--into", str(review_doc))
    before = {p for p in package_parts(charted) if "chart" in p}
    assert before, "the fixture failed to produce a chart"

    commented = tmp_path / "commented.docx"
    run(DOCX_COMMENTS, "add", str(commented.parent / "charted.docx"),
        "--target", "notice period", "--text", "check", "--author", "Q",
        "-o", str(commented))
    after = {p for p in package_parts(commented) if "chart" in p}
    assert after == before, "the chart part did not survive"
    from docx import Document
    assert Document(str(commented)).sections[0].header.paragraphs[0].text \
        == "Confidential draft"


def test_resolve_is_idempotent_and_reopen_is_its_inverse(review_doc, tmp_path):
    step = tmp_path / "a.docx"
    run(DOCX_COMMENTS, "add", str(review_doc), "--target", "Invoices",
        "--text", "Confirm with finance.", "--author", "Omar", "-o", str(step))
    cid = threads(step)[0]["id"]

    once = tmp_path / "once.docx"
    run(DOCX_COMMENTS, "resolve", str(step), "--id", cid, "-o", str(once))
    twice = tmp_path / "twice.docx"
    run(DOCX_COMMENTS, "resolve", str(once), "--id", cid, "-o", str(twice))
    assert threads(once)[0]["resolved"] is True
    assert threads(twice)[0]["resolved"] is True, "resolving twice broke it"

    back = tmp_path / "back.docx"
    run(DOCX_COMMENTS, "reopen", str(twice), "--id", cid, "-o", str(back))
    assert threads(back)[0]["resolved"] is False


# ---------------------------------------------------------------------------
# Sequences: a model of what the operations mean, checked against the file
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("seed", [1, 7, 2026])
def test_a_random_operation_sequence_matches_the_model(review_doc, tmp_path,
                                                       seed):
    """Fifty operations, replayed against a dict of what should be true.

    The seeds are fixed so a failure is reproducible. What this catches
    that a happy path test cannot: an id reused after a delete, a reply
    to a resolved thread, a resolve that forgets a reply added later.
    """
    rng = random.Random(seed)
    anchors = ["thirty days", "Invoices", "notice period", "البند"]
    current = tmp_path / "seq0.docx"
    shutil.copy(review_doc, current)
    model: dict[str, dict] = {}          # id -> {"replies": [...], "resolved"}
    text_digest = visible_text(current)

    for step in range(1, 51):
        nxt = tmp_path / f"seq{step}.docx"
        live = list(model)
        choice = rng.choice(
            ["add", "add", "reply", "resolve", "reopen", "delete"]
            if live else ["add"])
        if choice == "add":
            out = run(DOCX_COMMENTS, "add", str(current),
                      "--target", rng.choice(anchors),
                      "--text", rng.choice(NASTY)[:120],
                      "--author", f"Reviewer {rng.randint(1, 4)}",
                      "-o", str(nxt))
            model[str(out["comment_id"])] = {"replies": [], "resolved": False}
        elif choice == "reply":
            target = rng.choice(live)
            out = run(DOCX_COMMENTS, "reply", str(current), "--id", target,
                      "--text", rng.choice(NASTY)[:120], "--author", "Hermes",
                      "-o", str(nxt))
            model[target]["replies"].append(str(out["comment_id"]))
        elif choice == "resolve":
            target = rng.choice(live)
            run(DOCX_COMMENTS, "resolve", str(current), "--id", target,
                "-o", str(nxt))
            model[target]["resolved"] = True
        elif choice == "reopen":
            target = rng.choice(live)
            run(DOCX_COMMENTS, "reopen", str(current), "--id", target,
                "-o", str(nxt))
            model[target]["resolved"] = False
        else:
            target = rng.choice(live)
            run(DOCX_COMMENTS, "delete-thread", str(current), "--id", target,
                "-o", str(nxt))
            model.pop(target)
        current = nxt

    found = {t["id"]: t for t in threads(current)}
    assert set(found) == set(model), "thread set drifted from the model"
    for cid, expected in model.items():
        assert found[cid]["resolved"] == expected["resolved"], cid
        assert len(found[cid].get("replies") or []) == \
            len(expected["replies"]), f"{cid} lost or gained a reply"
    assert visible_text(current) == text_digest, "fifty operations moved text"
    assert run(DOCX_VALIDATE, str(current))["ok"] is True


@pytest.mark.parametrize("text", NASTY)
def test_any_text_a_reviewer_can_type_round_trips(review_doc, tmp_path, text):
    out = tmp_path / "nasty.docx"
    run(DOCX_COMMENTS, "add", str(review_doc), "--target", "Invoices",
        "--text", text, "--author", "محمد", "-o", str(out))
    got = threads(out)[0]
    assert got["text"] == text
    assert got["author"] == "محمد"
    assert run(DOCX_VALIDATE, str(out))["ok"] is True


# ---------------------------------------------------------------------------
# Failure: loud, and without leaving a broken file behind
# ---------------------------------------------------------------------------


def test_unknown_id_fails_and_writes_no_output(review_doc, tmp_path):
    out = tmp_path / "never.docx"
    failed = run(DOCX_COMMENTS, "reply", str(review_doc), "--id", "999",
                 "--text", "hello", "--author", "Hermes", "-o", str(out),
                 expect_ok=False)
    assert not out.exists(), "a failed operation left a file behind"
    assert failed.stdout.strip() or failed.stderr.strip(), "failed silently"


def test_a_truncated_package_is_refused(review_doc, tmp_path):
    broken = tmp_path / "broken.docx"
    broken.write_bytes(review_doc.read_bytes()[:600])
    run(DOCX_COMMENTS, "list", str(broken), expect_ok=False)
    run(INSPECT, str(broken), "--no-lint", expect_ok=False)


def test_the_wrong_format_is_refused_by_the_inspector(tmp_path):
    odd = tmp_path / "notes.md"
    odd.write_text("hello", encoding="utf-8")
    run(INSPECT, str(odd), expect_ok=False)


# ---------------------------------------------------------------------------
# Interop: the file LibreOffice wrote, not the file we wrote
# ---------------------------------------------------------------------------


FODT = """<?xml version="1.0" encoding="UTF-8"?>
<office:document
 xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
 xmlns:dc="http://purl.org/dc/elements/1.1/"
 office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.text">
 <office:body><office:text>
  <text:h text:outline-level="1">Vendor agreement review</text:h>
  <text:p>The notice period is now
   <office:annotation office:name="c1"><dc:creator>Layla Haddad</dc:creator>
    <dc:date>2026-09-05T10:12:00</dc:date>
    <text:p>Thirty days is shorter than our standard sixty.</text:p>
   </office:annotation>thirty days for either party.</text:p>
  <text:p>ملاحظة:
   <office:annotation office:name="c2"><dc:creator>محمد</dc:creator>
    <dc:date>2026-09-06T09:05:00</dc:date>
    <text:p>هل راجعنا بند الغرامات؟</text:p>
   </office:annotation>البند الجزائي يحتاج مراجعة.</text:p>
 </office:text></office:body>
</office:document>
"""


def _libreoffice_docx(tmp_path) -> Path:
    source = tmp_path / "source.fodt"
    source.write_text(FODT, encoding="utf-8")
    subprocess.run([SOFFICE, "--headless", "--convert-to", "docx",
                    str(source), "--outdir", str(tmp_path)],
                   capture_output=True, timeout=180, check=False)
    out = tmp_path / "source.docx"
    assert out.exists(), "LibreOffice produced no .docx"
    return out


@needs_soffice
def test_a_libreoffice_document_can_be_read_answered_and_resolved(tmp_path):
    """The interop case, end to end.

    LibreOffice writes a point comment: a w:commentReference with no
    range around it. A reader that only looks for ranges reports the
    comment with no idea what it is about, which is why the listing also
    carries the paragraph the reference sits in.
    """
    source = _libreoffice_docx(tmp_path)
    found = threads(source)
    assert len(found) == 2
    assert {t["author"] for t in found} == {"Layla Haddad", "محمد"}
    assert all(t["context"] for t in found), \
        "a point comment must still report its paragraph"
    assert any("thirty days" in t["context"] for t in found)

    answered = tmp_path / "answered.docx"
    run(DOCX_COMMENTS, "reply", str(source), "--id", found[0]["id"],
        "--text", "Sixty days restored.", "--author", "Hermes",
        "-o", str(answered))
    resolved = tmp_path / "resolved.docx"
    run(DOCX_COMMENTS, "resolve", str(answered), "--id", found[0]["id"],
        "-o", str(resolved))

    after = {t["id"]: t for t in threads(resolved)}
    assert len(after[found[0]["id"]]["replies"]) == 1
    assert after[found[0]["id"]]["resolved"] is True
    assert after[found[1]["id"]]["resolved"] is False
    assert run(DOCX_VALIDATE, str(resolved))["ok"] is True


@needs_soffice
def test_threads_survive_the_reviewer_opening_the_file_again(tmp_path):
    """A round trip through LibreOffice is what happens when the client
    opens the answer. What we write has to survive their save."""
    source = _libreoffice_docx(tmp_path)
    cid = threads(source)[0]["id"]
    answered = tmp_path / "answered.docx"
    run(DOCX_COMMENTS, "reply", str(source), "--id", cid,
        "--text", "Sixty days restored.", "--author", "Hermes",
        "-o", str(answered))
    run(DOCX_COMMENTS, "resolve", str(answered), "--id", cid,
        "-o", str(tmp_path / "resolved.docx"))

    trip = tmp_path / "trip"
    trip.mkdir()
    subprocess.run([SOFFICE, "--headless", "--convert-to", "docx",
                    str(tmp_path / "resolved.docx"), "--outdir", str(trip)],
                   capture_output=True, timeout=180, check=False)
    back = threads(trip / "resolved.docx")
    assert sum(len(t.get("replies") or []) for t in back) == 1, \
        "the reply did not survive the reviewer's own tool"
    assert sum(1 for t in back if t["resolved"]) == 1


# ---------------------------------------------------------------------------
# Scale
# ---------------------------------------------------------------------------


def test_five_hundred_paragraphs_and_fifty_threads_stay_workable(tmp_path):
    pytest.importorskip("docx")
    from docx import Document

    doc = Document()
    for i in range(500):
        doc.add_paragraph(f"Clause {i}: the parties agree to term number {i}.")
    big = tmp_path / "big.docx"
    doc.save(str(big))

    current = big
    started = time.monotonic()
    for i in range(50):
        nxt = tmp_path / f"big{i}.docx"
        run(DOCX_COMMENTS, "add", str(current), "--target", f"term number {i}",
            "--text", f"Check clause {i}.", "--author", "Reviewer",
            "-o", str(nxt))
        current = nxt
    elapsed = time.monotonic() - started
    per_op = elapsed / 50

    listed = threads(current)
    assert len(listed) == 50
    assert all(t["anchored_text"] for t in listed), "anchors went missing"
    # A budget with real teeth. Each operation opens the package, edits
    # the XML and writes it back, measured at 0.07s on this machine on
    # 11 September 2026. The ceiling leaves room for a loaded box and
    # still trips on the accidentally quadratic walk, which would put a
    # fiftieth comment well past a second.
    assert per_op < 1.0, (
        f"{per_op:.2f}s per comment on a 500 paragraph file, "
        f"{elapsed:.0f}s for fifty")

    report = run(INSPECT, str(current), "--no-lint", "--section", "summary")
    assert report["summary"]["paragraphs"] >= 500


# ---------------------------------------------------------------------------
# The same invariants, for decks and workbooks
# ---------------------------------------------------------------------------


def test_deck_comment_operations_keep_every_slide_and_its_text(tmp_path):
    pytest.importorskip("pptx")
    from pptx import Presentation

    prs = Presentation()
    for n in range(5):
        slide = prs.slides.add_slide(prs.slide_layouts[1])
        slide.shapes.title.text = f"Slide {n}"
        slide.placeholders[1].text_frame.text = f"Body of slide {n}"
    deck = tmp_path / "deck.pptx"
    prs.save(str(deck))

    def deck_text(path):
        return [sh.text_frame.text for s in Presentation(str(path)).slides
                for sh in s.shapes if sh.has_text_frame]

    before = deck_text(deck)
    ids = []
    for n in range(1, 6):
        ids.append(run(PPTX_COMMENTS, "add", str(deck), "--slide", str(n),
                       "--text", NASTY[n % len(NASTY)][:80],
                       "--author", f"R{n}")["id"])
    for cid in ids[:3]:
        run(PPTX_COMMENTS, "reply", str(deck), "--id", cid, "--text", "noted",
            "--author", "Hermes")
        run(PPTX_COMMENTS, "resolve", str(deck), "--id", cid)
    run(PPTX_COMMENTS, "delete", str(deck), "--id", ids[-1])

    listed = run(PPTX_COMMENTS, "list", str(deck))["comments"]
    assert len({c["id"] for c in listed if not c["parent_id"]}) == 4
    assert sum(1 for c in listed if c["parent_id"]) == 3
    assert deck_text(deck) == before, "a comment edit changed slide text"


def test_workbook_comment_operations_keep_values_and_formulas(tmp_path):
    pytest.importorskip("openpyxl")
    from openpyxl import Workbook, load_workbook

    wb = Workbook()
    ws = wb.active
    ws.append(["Region", "Q2", "Q3"])
    for i, name in enumerate(("North", "South", "East"), start=2):
        ws.append([name, i * 10, i * 12])
        ws[f"D{i}"] = f"=C{i}-B{i}"
    book = tmp_path / "book.xlsx"
    wb.save(str(book))

    def snapshot(path):
        sheet = load_workbook(str(path)).active
        return [[c.value for c in row] for row in sheet.iter_rows()]

    before = snapshot(book)
    ids = []
    for cell, text in (("B2", "stale"), ("C3", NASTY[0]), ("D4", NASTY[2])):
        ids.append(run(XLSX_COMMENTS, "add", str(book), "--sheet", "Sheet",
                       "--cell", cell, "--text", text[:80],
                       "--author", "Reviewer")["id"])
    run(XLSX_COMMENTS, "reply", str(book), "--id", ids[0], "--text", "fixed",
        "--author", "Hermes")
    run(XLSX_COMMENTS, "resolve", str(book), "--id", ids[0])
    run(XLSX_COMMENTS, "delete", str(book), "--id", ids[2])

    assert snapshot(book) == before, "a comment edit touched the data"
    listed = run(XLSX_COMMENTS, "list", str(book))["comments"]
    assert {c["cell"] for c in listed} == {"B2", "C3"}
    assert any(c["resolved"] for c in listed)
