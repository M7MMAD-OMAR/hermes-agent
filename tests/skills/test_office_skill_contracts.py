"""Contracts between the office skills and the things that call them.

Two bugs motivated this file, and both survived a 2,000 test suite because
nothing tested the seam they lived on.

The first: `office_inspect` asked three of its four comment helpers for
`--json`, a flag only the docx helper defines. argparse rejected it, exit 2,
and `_run_helper` turned that into `items: []`. The inspector reported
"no comments" for every deck, workbook and PDF. `test_office_inspect.py`
covers `_run_helper` thoroughly, but with stub scripts it writes itself, so
the real argv contract with the real helpers was never exercised.

The second: the docx SKILL.md worked example told the agent to run
`--anchor`, a flag that does not exist, and `list --json` with no value for a
flag that requires one. Both fail instantly. Nothing checked that the
documented commands are commands.

So the tests here sit at two deliberately different layers:

  Layer A, below the interface: import the module, call the function, assert
  on what it returns. Fast, and it can reach error paths that are awkward to
  provoke from outside.

  Layer B, through the interface: run the script as a subprocess with the
  real arguments, the way the agent runs it, and assert on real output.
  Slower, and the only layer that can catch a broken argv contract.
"""

from __future__ import annotations

import importlib.util
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
SKILLS = REPO / "skills" / "productivity"
HOUSE = SKILLS / "house-style" / "scripts"


# ---------------------------------------------------------------------------
# Layer B: office_inspect against the real comment helpers
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def inspector():
    """Load office_inspect the way test_office_inspect.py already does."""
    if str(HOUSE) not in sys.path:
        sys.path.insert(0, str(HOUSE))
    spec = importlib.util.spec_from_file_location(
        "office_inspect_contract_under_test", HOUSE / "office_inspect.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["office_inspect_contract_under_test"] = module
    spec.loader.exec_module(module)
    return module


def _a_docx(tmp_path: Path) -> Path:
    pytest.importorskip("docx")
    from docx import Document

    doc = Document()
    doc.add_paragraph("Q3 revenue grew by eleven percent.")
    out = tmp_path / "doc.docx"
    doc.save(str(out))
    return out


def _a_pptx(tmp_path: Path) -> Path:
    pytest.importorskip("pptx")
    from pptx import Presentation

    prs = Presentation()
    prs.slides.add_slide(prs.slide_layouts[5])
    out = tmp_path / "deck.pptx"
    prs.save(str(out))
    return out


def _an_xlsx(tmp_path: Path) -> Path:
    pytest.importorskip("openpyxl")
    from openpyxl import Workbook

    wb = Workbook()
    wb.active["A1"] = "Region"
    out = tmp_path / "book.xlsx"
    wb.save(str(out))
    return out


@pytest.mark.parametrize("builder", [_a_docx, _a_pptx, _an_xlsx],
                         ids=["docx", "pptx", "xlsx"])
def test_the_real_comment_helper_is_actually_reached(inspector, tmp_path,
                                                     builder):
    """The inspector must read each helper, not silently fail to call it.

    This is the regression test for the `--json` bug. A helper invoked with
    a flag it does not define exits 2, and `_run_helper` reports that as an
    empty `items` list plus a `stderr` field. From the caller's side that is
    indistinguishable from a document with no comments, which is why the bug
    was invisible for as long as it was.

    The assertion that matters is `data`: `_run_helper` only produces that
    key when the helper exited 0 and printed parseable JSON.
    """
    report = inspector.inspect(builder(tmp_path), lint=False)
    comments = report["review"]["comments"]

    assert "data" in comments, (
        f"the helper was not read successfully. source={comments.get('source')!r} "
        f"stderr={comments.get('stderr', '')!r}"
    )
    assert "stderr" not in comments, (
        f"the helper wrote to stderr, which means it did not run cleanly: "
        f"{comments.get('stderr')!r}"
    )
    assert comments["data"].get("ok") is True, comments["data"]


def test_an_empty_document_reports_no_comments_not_a_failure(inspector,
                                                             tmp_path):
    """"No comments" and "could not look" must stay distinguishable.

    The inverse of the test above, and the reason that bug mattered: both
    states used to render as an empty list.
    """
    report = inspector.inspect(_a_pptx(tmp_path), lint=False)
    comments = report["review"]["comments"]
    assert comments["data"]["comments"] == []
    assert "not installed" not in comments["source"]
    assert "exited" not in comments["source"]


# ---------------------------------------------------------------------------
# Layer B: the documented commands are commands
# ---------------------------------------------------------------------------

# A documented line looks like:
#   python scripts/pptx_read.py deck.pptx --outline   # full JSON outline
_DOC_LINE = re.compile(r"^python scripts/(?P<script>[\w.]+\.py)\s+(?P<rest>.*)$")
# Flags the examples pass that take a value we cannot guess; we only assert
# the flag exists, never that the example's value is valid.
_SKILL_MDS = ["docx", "powerpoint", "xlsx", "pdf"]


def _documented_invocations(skill: str) -> list[tuple[str, str, list[str]]]:
    """Return (script, subcommand_or_empty, flags) for each documented line."""
    md = SKILLS / skill / "SKILL.md"
    if not md.is_file():
        return []
    found = []
    # Examples wrap across lines with a trailing backslash; join them first.
    text = md.read_text(encoding="utf-8").replace("\\\n", " ")
    for raw in text.splitlines():
        m = _DOC_LINE.match(raw.strip())
        if not m:
            continue
        rest = m.group("rest").split("#", 1)[0].strip()
        tokens = rest.split()
        # A subcommand is a bare first token that is not a path or a flag.
        sub = ""
        if tokens and not tokens[0].startswith("-") and "." not in tokens[0] \
                and "/" not in tokens[0]:
            sub = tokens[0]
        flags = [t for t in tokens if t.startswith("--")]
        found.append((m.group("script"), sub, flags))
    return found


@pytest.mark.parametrize("skill", _SKILL_MDS)
def test_every_documented_flag_exists(skill):
    """Each `--flag` in a SKILL.md example must exist in that script's parser.

    Checked by reading the script's own `--help`, which is the cheapest
    honest source: it is generated by argparse from the real parser, so it
    cannot drift from the implementation the way prose can.

    This is the test that catches `--anchor` on `docx_comments.py add`, a
    flag the worked example used and the parser never defined.
    """
    scripts_dir = SKILLS / skill / "scripts"
    invocations = _documented_invocations(skill)
    if not invocations:
        pytest.skip(f"{skill}: no documented python invocations")

    helps: dict[tuple[str, str], str] = {}
    missing: list[str] = []

    for script, sub, flags in invocations:
        path = scripts_dir / script
        if not path.is_file():
            missing.append(f"{skill}/SKILL.md names {script}, which does not exist")
            continue
        if not flags:
            continue
        key = (script, sub)
        if key not in helps:
            argv = [sys.executable, str(path)] + ([sub] if sub else []) + ["--help"]
            proc = subprocess.run(argv, capture_output=True, text=True,
                                  timeout=120)
            # A subcommand that does not exist fails here, which is itself
            # a documentation defect worth reporting by name.
            if proc.returncode != 0:
                missing.append(
                    f"{script} {sub} --help exited {proc.returncode}: "
                    f"{proc.stderr.strip().splitlines()[-1] if proc.stderr.strip() else ''}")
                helps[key] = ""
                continue
            helps[key] = proc.stdout
        text = helps[key]
        if not text:
            continue
        for flag in flags:
            # argparse prints "--flag", "--flag VALUE" or "--flag {a,b}".
            if not re.search(rf"{re.escape(flag)}\b", text):
                where = f"{script} {sub}".strip()
                missing.append(f"{where}: documented flag {flag} is not in its parser")

    assert not missing, (
        f"{skill}/SKILL.md documents commands that do not work:\n  "
        + "\n  ".join(sorted(set(missing)))
    )


@pytest.mark.parametrize("skill", ["docx"])
def test_the_documented_comment_example_actually_runs(skill, tmp_path):
    """Run the worked example end to end, not just check its flags parse.

    A flag can exist and the example still be wrong, for example when a flag
    requires a value the example omits. `list --json` was exactly that: the
    flag exists, takes `flat` or `threads`, and the documented line passed it
    bare.
    """
    pytest.importorskip("docx")
    from docx import Document

    doc = Document()
    doc.add_paragraph("A price move worth a comment.")
    src = tmp_path / "draft.docx"
    doc.save(str(src))

    script = SKILLS / skill / "scripts" / "docx_comments.py"
    out = tmp_path / "out.docx"

    for argv in (
        ["list", str(src), "--json", "threads"],
        ["add", str(src), "--target", "price move", "--text", "Which month?",
         "--author", "Reviewer", "-o", str(out)],
    ):
        proc = subprocess.run([sys.executable, str(script), *argv],
                              capture_output=True, text=True, timeout=120)
        assert proc.returncode == 0, f"{argv}: rc={proc.returncode}\n{proc.stderr}"
        json.loads(proc.stdout)


# ---------------------------------------------------------------------------
# Layer A: style_lint's PDF reader, on the paths a subprocess can take
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def linter():
    if str(HOUSE) not in sys.path:
        sys.path.insert(0, str(HOUSE))
    spec = importlib.util.spec_from_file_location(
        "style_lint_contract_under_test", HOUSE / "style_lint.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["style_lint_contract_under_test"] = module
    spec.loader.exec_module(module)
    return module


# `read_pdf` does `import shutil` and `import subprocess` inside the function
# body rather than at module scope, so `linter.shutil` does not exist. Patching
# the stdlib modules directly is what reaches it.
def _warned(findings) -> str:
    assert findings, "expected a warning finding, got none"
    assert findings[0]["level"] == "warn", findings[0]
    assert findings[0]["rule"] == "no_extractor", findings[0]
    return findings[0]["detail"]


def test_pdf_reader_warns_when_the_extractor_is_absent(linter, tmp_path,
                                                       monkeypatch):
    """The pre-existing no-extractor path, pinned so the others can be trusted."""
    monkeypatch.setattr(shutil, "which", lambda _exe: None)
    text, findings = linter.read_pdf(tmp_path / "absent.pdf")
    assert text == ""
    assert "not installed" in _warned(findings)


def test_pdf_reader_gives_up_rather_than_hanging(linter, tmp_path,
                                                 monkeypatch):
    """A stuck extractor must time out and say so.

    Before the timeout was added this call could block forever, and it was
    the only subprocess in the skill cluster without one.
    """
    monkeypatch.setattr(shutil, "which", lambda _exe: "/usr/bin/pdftotext")

    def _hang(*_args, **kwargs):
        assert kwargs.get("timeout"), "read_pdf must pass a timeout"
        raise subprocess.TimeoutExpired(cmd="pdftotext", timeout=kwargs["timeout"])

    monkeypatch.setattr(subprocess, "run", _hang)
    text, findings = linter.read_pdf(tmp_path / "slow.pdf")
    assert text == ""
    assert "did not finish" in _warned(findings)


def test_pdf_reader_does_not_lint_clean_when_extraction_failed(linter,
                                                               tmp_path,
                                                               monkeypatch):
    """A failed extractor must not read as "this document has no prose".

    The return code used to be ignored, so a broken pdftotext produced empty
    text and zero findings, which renders identically to a clean document.
    That is the same failure shape as the `--json` bug above: absence of
    evidence presented as evidence of absence.
    """
    monkeypatch.setattr(shutil, "which", lambda _exe: "/usr/bin/pdftotext")

    class _Failed:
        returncode = 3
        stdout = ""
        stderr = "Syntax Error: Couldn't find trailer dictionary"

    monkeypatch.setattr(subprocess, "run", lambda *_a, **_k: _Failed())
    text, findings = linter.read_pdf(tmp_path / "broken.pdf")
    assert text == ""
    detail = _warned(findings)
    assert "failed" in detail
    assert "trailer dictionary" in detail, "the real reason must survive"
