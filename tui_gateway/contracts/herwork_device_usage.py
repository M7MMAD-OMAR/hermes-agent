"""Contracts for the surfaces this fork adds: the HerWork project workspace
(``projects.brief`` / ``.workflow`` / ``.references.*`` / ``.actions.*`` /
``.results.*``), the device panel (``device.*``) and the provider usage panel
(``account.usage``).

Upstream has no handler for any of these, so they live in a module of their own
rather than being threaded into ``projects_pets.py``: a future upstream merge
touches that file and never this one.

Rows that come straight out of ``projects.db`` with ``SELECT *`` are ``OpenModel``.
That is the same licence ``events.py`` takes for payloads whose closed set is
owned elsewhere: the schema in ``hermes_cli/projects_db.py`` owns these columns,
and pinning every one here would turn a migration into a contract violation. The
keys each surface actually reads are typed, so a field the backend stops sending
still fails ``tsc``.
"""

from __future__ import annotations

from pydantic import Field

from .base import JsonValue, Params, Result
from .common import OpenModel, ProfileParams
from .registry import method

# ── shared params ─────────────────────────────────────────────────────────────────────────────


class ProjectIdParams(ProfileParams):
    """Every ``projects.*`` method below names its project with ``id``."""

    id: str | None = None


# ── projects.brief / projects.workflow ────────────────────────────────────────────────────────


class ProjectHealth(OpenModel):
    """``hermes_cli/projects_health.py::project_with_health`` — the stored project plus its
    derived health fields."""

    id: str
    name: str


class ReferenceFile(OpenModel):
    """One row of ``project_reference_files`` (id, path, status, error, current_hash)."""

    id: str
    path: str
    status: str


class ApprovedResult(OpenModel):
    """A result whose newest version is approved, for the brief's shortlist."""

    id: str
    version_id: str


class ProjectBriefResult(Result):
    """``hermes_cli/project_references.py::project_brief``."""

    project: ProjectHealth
    files: list[ReferenceFile] = Field(default_factory=list)
    approved_results: list[ApprovedResult] = Field(default_factory=list)


method("projects.brief", params=ProjectIdParams, result=ProjectBriefResult,
       doc="The project's sources and approved results, for the workspace overview.")


class ProjectWorkflowParams(ProjectIdParams):
    workflow: str | None = None
    approach: str = "standard"
    task: str | None = None


class ProjectWorkflowResult(Result):
    """``hermes_cli/project_workflows.py::workflow_draft`` — composer text, never an agent change.
    Building a draft never touches the live agent's tools or system prompt."""

    cwd: str | None = None
    draft: str
    skill: str | None = None
    missing_skill: str | None = None


method("projects.workflow", params=ProjectWorkflowParams, result=ProjectWorkflowResult,
       doc="Draft the composer text for a project workflow. Local to this fork.")


# ── projects.references.* ─────────────────────────────────────────────────────────────────────


class ReferenceScanResult(Result):
    """``scan_references``: what the source folders hold now."""

    discovered: int
    truncated: list[str] = Field(default_factory=list)
    failures: list[str] = Field(default_factory=list)
    pending: int


method("projects.references.scan", params=ProjectIdParams, result=ReferenceScanResult,
       doc="Re-read the project's source folders and queue what changed.")


class ReferenceIndexResult(Result):
    """``index_references``: one batch. ``has_more`` drives the caller's next call."""

    indexed: int
    has_more: bool
    pending: int
    failures: list[str] = Field(default_factory=list)


method("projects.references.index", params=ProjectIdParams, result=ReferenceIndexResult,
       doc="Extract one batch of queued sources; call again while has_more.")


class Citation(OpenModel):
    """``_CITATION_SELECT`` — one quotation tied to the exact saved source version."""

    citation_id: int
    text: str


class ReferenceSearchParams(ProjectIdParams):
    query: str | None = None
    include_history: bool = False


class ReferenceSearchResult(Result):
    matches: list[Citation] = Field(default_factory=list)


method("projects.references.search", params=ReferenceSearchParams, result=ReferenceSearchResult,
       doc="Full-text search across the project's indexed sources.")


class ReferenceCitationParams(ProjectIdParams):
    citation_id: int | None = None


method("projects.references.citation", params=ReferenceCitationParams, result=Citation,
       doc="One citation by id, with the source version it was taken from.")


# ── projects.actions.* ────────────────────────────────────────────────────────────────────────


class ProjectAction(OpenModel):
    """A row of ``project_actions`` (``SELECT *``), with its ``citation`` joined in by
    ``list_actions``."""

    id: str
    title: str
    state: str
    citation: Citation | None = None


class ActionListParams(ProjectIdParams):
    before: str | None = None


class ActionListResult(Result):
    actions: list[ProjectAction] = Field(default_factory=list)
    board: str
    next_before: str | None = None


method("projects.actions.list", params=ActionListParams, result=ActionListResult,
       doc="A page of extracted action proposals, newest first.")


class ActionDraftParams(ProjectIdParams):
    file_id: str | None = None


method("projects.actions.draft", params=ActionDraftParams, result=ProjectWorkflowResult,
       doc="Composer text that asks the agent to extract actions from one indexed source.")


class ActionEditParams(ProjectIdParams):
    action_id: str | None = None
    title: str | None = None
    owner: str | None = None
    due_text: str | None = None


method("projects.actions.edit", params=ActionEditParams, result=ProjectAction,
       doc="Edit a pending proposal. Only pending proposals can be edited.")


class ActionIdParams(ProjectIdParams):
    action_id: str | None = None


method("projects.actions.dismiss", params=ActionIdParams, result=ProjectAction,
       doc="Dismiss a proposal without creating a task.")
method("projects.actions.accept", params=ActionIdParams, result=ProjectAction,
       doc="Accept a proposal onto the project's task board. Idempotent once accepted.")


# ── projects.results.* ────────────────────────────────────────────────────────────────────────


class ResultsRefreshResult(Result):
    """``refresh_index``: one scan batch. Oversized artifacts are counted, never truncated."""

    scanned: int
    has_more: bool
    skipped_oversized: int
    skipped_oversized_total: int = 0


method("projects.results.refresh", params=ProfileParams, result=ResultsRefreshResult,
       doc="Scan recent sessions for delivered results; call again while has_more.")


class ProjectResultRow(OpenModel):
    """A row of ``project_results`` (``SELECT *``) plus the joined ``version_count``."""

    id: str
    origin: str
    version_count: int = 0


class ResultsListParams(ProfileParams):
    project_id: str | None = None
    # Keyset cursor: ``[reported_at, id]`` from the previous page's ``next_cursor``.
    before: list[JsonValue] | None = None
    limit: int = 100


class ResultsListResult(Result):
    results: list[ProjectResultRow] = Field(default_factory=list)
    next_cursor: list[JsonValue] | None = None


method("projects.results.list", params=ResultsListParams, result=ResultsListResult,
       doc="A page of captured results, newest report first.")


class ResultVersion(OpenModel):
    """A row of ``project_result_versions`` (``SELECT *``)."""

    id: str
    result_id: str
    number: int


class ResultIdParams(ProfileParams):
    result_id: str | None = None


class ResultVersionsResult(Result):
    versions: list[ResultVersion] = Field(default_factory=list)


method("projects.results.versions", params=ResultIdParams, result=ResultVersionsResult,
       doc="Every captured version of one result, newest first.")


class ResultVersionResult(Result):
    version: ResultVersion


method("projects.results.capture", params=ResultIdParams, result=ResultVersionResult,
       doc="Snapshot the result's current bytes as a new version.")


class VersionIdParams(ProfileParams):
    version_id: str | None = None


class ResultPreviewResult(Result):
    """``preview_version``. ``kind`` says which of the three bodies is present: none for
    ``unsupported`` / ``too_large``, ``text`` for html / svg / text, ``data_url`` for image
    / pdf. Only a snapshot this profile owns is ever read, never a client path."""

    kind: str
    text: str | None = None
    extension: str | None = None
    data_url: str | None = None


method("projects.results.preview", params=VersionIdParams, result=ResultPreviewResult,
       doc="Read one verified snapshot for display.")


class ResultReviewParams(VersionIdParams):
    state: str | None = None


method("projects.results.review", params=ResultReviewParams, result=ResultVersionResult,
       doc="Set a version's review state: unreviewed, approved or changes_requested.")


# ── projects.edit ─────────────────────────────────────────────────────────────────────────────


class ProjectFolderEdit(Params):
    """One folder in an edit draft. ``path`` is required; the rest is optional."""

    path: str
    label: str | None = None
    is_primary: bool = False


class ProjectEditParams(ProjectIdParams):
    name: str | None = None
    folders: list[ProjectFolderEdit] | None = None


class ProjectEditResult(Result):
    """The saved project, plus every live workspace path that moved with it. A running task
    is never re-homed under its own tools, so a move refuses while one is running."""

    project: OpenModel
    relocated_paths: dict[str, str] = Field(default_factory=dict)


method("projects.edit", params=ProjectEditParams, result=ProjectEditResult,
       doc="Rename a project, reconnect a moved folder, add or remove source folders.")


# ── device.* ──────────────────────────────────────────────────────────────────────────────────


class DeviceStatusParams(Params):
    session_id: str | None = None


class DeviceStatusResult(Result):
    """``methods_device`` answers without touching the device where it can, so a panel can ask
    on every mount without making an absent phone expensive."""

    available: bool
    reason: str | None = None
    provisioned: bool = False
    devices: list[JsonValue] = Field(default_factory=list)


method("device.status", params=DeviceStatusParams, result=DeviceStatusResult,
       doc="Whether this host can show a device at all, and which one. Local to this fork.")


class DeviceFrameParams(Params):
    session_id: str | None = None
    quality: int | None = None
    max_width: int | None = None


class DeviceFrameResult(Result):
    """A failure is reported as unavailable with its reason rather than as an error: a panel
    polling this wants to show "the device went away" and keep polling."""

    available: bool
    reason: str | None = None
    frame: str | None = None
    width: int | None = None
    height: int | None = None
    device: str | None = None


method("device.frame", params=DeviceFrameParams, result=DeviceFrameResult,
       doc="One JPEG frame of this session's device, and the size it was captured at.")


# ── account.usage ─────────────────────────────────────────────────────────────────────────────


class ProviderUsageParams(Params):
    # The manual refresh button; otherwise a stale-while-revalidate cache read.
    refresh: bool = False


class ProviderUsage(OpenModel):
    """``agent/provider_usage.py::ProviderUsage.to_payload`` — one provider's windows."""

    provider: str
    available: bool


class ProviderUsageResult(Result):
    """Fails open: a collection failure answers ``available: false`` with no providers rather
    than an error, because this panel must never take the window down with it."""

    ok: bool = True
    available: bool
    providers: list[ProviderUsage] = Field(default_factory=list)


method("account.usage", params=ProviderUsageParams, result=ProviderUsageResult,
       doc="Subscription usage across every authenticated provider. Local to this fork.")
