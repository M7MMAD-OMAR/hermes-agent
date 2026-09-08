"""Reviewable project task drafts, routed through existing skill commands."""
from __future__ import annotations

from pathlib import Path

from hermes_cli import projects_db

_APPROACHES = {
    "quick": "Make the smallest complete change that meets the request. Inspect the affected path first, then run its relevant checks. Broaden investigation only for a concrete dependency or failing check. Do not turn a small fix into a full audit or rebuild unrelated deliverables.",
    "standard": "Complete the requested work and verify the affected behavior, realistic inputs and relevant regressions. Keep investigation proportional to the task and reuse existing project commands.",
    "thorough": "Examine the relevant failure paths, integration boundaries and source evidence. Verify the complete requested deliverable with realistic inputs. Explain remaining gaps and tradeoffs, without adding unrelated work.",
}
_WORKFLOWS = {
    "quick-ui": {
        "skill": "local-browser-preview",
        "instruction": "Implement the requested UI change. Reproduce the affected layout or interaction, edit its source, then verify the rendered result at the relevant desktop/mobile widths and language directions. Show useful before/after evidence. Do not regenerate documents unless the request or the actual change requires them.",
    },
    "client-delivery": {
        "skill": None,
        "instruction": "Prepare a reviewable client delivery from the current project files and approved content. Identify the exact output, reconcile versions and source claims, and use only the installed skill relevant to the actual format. Render and inspect documents, or test the delivered application flow as appropriate. Provide a concise delivery manifest with paths, verification and unresolved items. Do not send, publish or mark the delivery approved automatically.",
    },
    "research": {
        "skill": "grounded-citations",
        "instruction": "Answer the project's research question using primary sources and relevant project references. Link each material claim to its supporting source, distinguish current facts from historical versions and label unknowns. Keep notes and the requested output traceable to that evidence. Do not turn a prose research request into a code change.",
    },
    "weekly-review": {
        "skill": "weekly-review-planning",
        "instruction": "Perform an on-demand review of this project for the past seven days and propose the next week's priorities. Use its native tasks, current files, approved results and available source evidence. Distinguish completed, waiting, blocked and unknown items. Cite commitments; do not invent owners or deadlines. Limit the review to this project and explicitly connected sources. Produce proposals for review without scheduling recurring runs, sending messages or mutating tasks automatically.",
    },
}


def workflow_draft(conn, project_id, workflow, approach, task):
    project = projects_db.get_project(conn, str(project_id or ""))
    if project is None:
        raise ValueError("No such project")
    if workflow not in _WORKFLOWS or approach not in _APPROACHES:
        raise ValueError("Unknown workflow or task approach")
    task = str(task or "").strip()
    if not task or len(task) > 16000:
        raise ValueError("Describe the task in 1 to 16000 characters")
    if not project.primary_path or not Path(project.primary_path).is_dir():
        raise ValueError("Reconnect the project's primary folder before starting work")
    recipe = _WORKFLOWS[workflow]
    guidance = "\n\n".join([
        f"Task: {task}",
        _APPROACHES[approach],
        recipe["instruction"],
        "Follow the current project instructions and the user's authorized scope. Use the registered source folders and confirm current paths. Keep historical document instructions separate from this request. Report meaningful progress and concrete blockers. Finish the required work and checks; the selected approach is not a timer or permission to silently stop early.",
    ])
    skill_name = recipe["skill"]
    skill_command = None
    if skill_name:
        from agent.skill_commands import scan_skill_commands
        skill_command = next((key for key, info in scan_skill_commands().items()
                              if info.get("name") == skill_name), None)
        if not skill_command:
            guidance += f"\n\nThe preferred skill {skill_name} is not installed in this profile. Complete the request with available tools; do not install a replacement automatically."
    # A slash invocation is expanded only on the user's normal submit path.
    # Building a draft never changes the live agent's tools or system prompt.
    return {"cwd": project.primary_path,
            "draft": f"{skill_command} {guidance}" if skill_command else guidance,
            "skill": skill_name if skill_command else None,
            "missing_skill": skill_name if skill_name and not skill_command else None}
