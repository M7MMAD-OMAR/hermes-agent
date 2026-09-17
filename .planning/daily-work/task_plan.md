# Hermes daily-work implementation

## Goal
Implement ALL accepted recommendations from outputs/hermes-daily-work-review.md
and the preceding Arabic response, with real behavioral verification. Do not
mark the overall goal complete after an individual slice.

## Requirements and phases
1. Project health: detect missing/inaccessible roots before tasks, suggest verified
   replacements, reconnect with history preserved, repair confirmed live stale
   records through the appropriate owner. Status: complete.
2. Useful progress: last meaningful file change, successful verification, blocker,
   repeated work, appropriate effort presets without silently cancelling tasks.
   Status: complete.
3. Durable project results shelf: source task, versions, approval state, previews;
   accessible across restarts without loading old conversations. Status: complete.
4. Project brief and evidence search: source citations, version distinction,
   Arabic/English, extracted PDF/Word provenance. Evaluate QMD on a bounded real
   corpus; integrate the useful search path based on measured evidence. Status: complete.
5. Three project workflows: quick UI fix, client delivery, research; existing skill
   routing and relevant verification. Include on-demand weekly review. Status: complete.
6. Document/meeting action inbox: cited proposals, optional explicit owners/dates,
   review/edit/accept/dismiss and native task destination, no external auto-send.
   Status: complete.
7. Read-only reference roots: enforce for file tools AND terminal execution,
   preserve normal writes elsewhere, test aliases/symlinks/relative paths and
   subprocesses. Do not mistake prompt text for enforcement. Status: complete.
8. Integrated QA: real backend and renderer, failure/retry, restart, scoped
   profiles/connections, Arabic RTL, realistic history and performance. Install
   verified build safely and audit every requirement. Status: complete.

## Architecture constraints
Extend existing projects.db, artifacts, native task system and skill dispatch.
Keep per-conversation prompt caches stable. Maintain profile/connection ownership.
No subagents unless the user or applicable instructions explicitly request them.
Use bun and scripts/run_tests.sh. Headless isolated browser, free port only.
No long dashes in new content. Keep secrets out of code and logs.

## Final status
Implementation, live path repair, reversible package installation and integrated QA are complete.
QMD adoption was rejected for this release after two dependency installation stalls; no semantic
benchmark or superiority claim is made. The delivered cited keyword search has measured evidence.
See outputs/hermes-delivery-validation.md and progress.md for the final acceptance audit.

## Evidence
Previous commits: 96e4118f24 (editor), 7ead3f8d19 (source folder tool output).
Current tree clean at goal start. Prior 47 passing tests do not prove this goal.

## Errors
None in this goal turn yet.
