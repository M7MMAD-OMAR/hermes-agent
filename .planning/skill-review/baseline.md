# Test baseline, recorded before any change

Taken so that any regression introduced by the cleanup pass is visible. Every
number here was produced by running the command shown, on this host, before a
single file was edited.

## Finding 0: five test files exist that CI never runs

`pyproject.toml:605` sets `testpaths = ["tests"]`. These five files live
outside that path and are therefore **never collected**:

```
skills/productivity/docx/tests/test_docx_skill.py
skills/productivity/pdf/tests/test_pdf_skill.py
skills/productivity/powerpoint/tests/test_powerpoint_skill.py
skills/productivity/xlsx/tests/test_xlsx_skill.py
skills/productivity/diagrams/tests/test_diagram_render.py
```

This was found before the reviewers reported, and it is the most consequential
thing about the current test setup: **98 tests exist that no CI run has ever
executed.** They are not dead code, they pass (mostly, see below), they are
simply invisible.

Two conventions are in conflict, and neither is wrong on its own:

- Tests under `tests/skills/` are collected, and they guard optional
  dependencies (`tests/skills/test_docx_report.py:21` does
  `docx = pytest.importorskip("docx")`).
- Tests under `skills/<area>/<skill>/tests/` are not collected, and **none of
  the five uses `importorskip`**. A missing optional dependency is a hard
  failure there rather than a skip.

The second point is why the pdf failures below look alarming and are not.

## Baseline numbers

### In-skill suites, run explicitly

```bash
venv/bin/python -m pytest skills/productivity/*/tests/ -q -p no:randomly
```

```
17 failed, 81 passed in 26.69s
```

**All 17 failures are in `skills/productivity/pdf/tests/test_pdf_skill.py`,
and all of them are the same environmental cause**, not a code defect:

```
Missing dependency: install with 'python3 -m pip install pypdf'
assert 2 == 0
```

`pypdf` is not installed in this venv. The script under test exits 2 with a
clear message, which is correct behaviour; the test asserts `rc == 0`
unconditionally, which is the defect. Had this file followed the
`tests/skills/` convention and called `pytest.importorskip("pypdf")` at import
time, all 17 would skip cleanly.

### The scope actually being changed

```bash
venv/bin/python -m pytest skills/productivity/powerpoint/tests/ skills/productivity/docx/tests/ -q -p no:randomly
```

```
54 passed in 10.07s
```

**This is the baseline that matters for this cleanup.** docx and powerpoint
are the scope, and both suites are green. Any failure here after a change is
caused by the change.

### Collected suite

```bash
venv/bin/python -m pytest tests/skills/ -q -p no:randomly
```

```
1942 passed, 1 skipped in 136.36s (0:02:16)
```

Green. This is the suite CI actually runs, and 2 minutes 16 seconds is cheap
enough to re-run after each applied fix rather than at the end.

### Totals

| Suite | Collected by CI | Result |
|---|---|---|
| `tests/skills/` | yes | 1942 passed, 1 skipped |
| `skills/productivity/{docx,powerpoint}/tests/` | **no** | 54 passed |
| `skills/productivity/{pdf,xlsx,diagrams}/tests/` | **no** | 27 passed, 17 failed (all pdf, all `pypdf` missing) |

So 98 of the 2,040 tests in this tree are invisible to CI, and 17 of those 98
are red for a reason no one has seen.

## Rules this baseline imposes on the cleanup

1. **Verify against both paths, not just `tests/`.** Editing
   `pptx_create.py` and running only `tests/skills/` would miss the 475 line
   suite at `skills/productivity/powerpoint/tests/test_powerpoint_skill.py`
   that actually exercises it.
2. **Do not "fix" the 17 pdf failures by installing `pypdf`.** The failure is
   the missing skip guard, not the missing package. Installing the package
   hides the defect instead of fixing it.
3. **pdf is out of the review scope** (the scope is docx, powerpoint,
   house-style), so the guard fix is recorded here as a known defect rather
   than applied as part of the cleanup.
