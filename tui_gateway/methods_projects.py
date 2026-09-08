"""Projects RPC surface: per-profile multi-folder workspaces, repo discovery, sidebar tree.
Bodies are rebound onto server.py's globals at install (method_ctx.bind_module)."""

from __future__ import annotations

from .method_ctx import HandlerRegistry, bind_module

_registry = HandlerRegistry()
method = _registry.method


# JSON-RPC error codes: generic failure / id resolved to nothing / invalid argument.
_E_PROJECTS, _E_NO_PROJECT, _E_PROJECT_ARG = 5061, 5062, 5063


class _NoProject(Exception):
    """Raised inside a projects handler when ``params['id']`` resolves to None."""


def _projects_payload(conn, *, include_health=False) -> dict:
    from hermes_cli import projects_db as pdb
    return {
        "projects": [_project_payload(p, include_health) for p in pdb.list_projects(conn, include_archived=True)],
        "active_id": pdb.get_active_id(conn)}


def _project_payload(project, include_health=False) -> dict:
    if include_health:
        from hermes_cli.projects_health import project_with_health
        return project_with_health(project)
    return project.to_dict()


def _projects_method(name: str):
    """Register a projects RPC, injecting (pdb, conn) and unifying error mapping; profile-scoped
    so app-global remote mode reads that profile's ``projects.db``."""
    def decorator(fn):
        @method(name)
        @_registry.profile_scoped
        def handler(rid, params: dict) -> dict:
            try:
                from hermes_cli import projects_db as pdb
                with pdb.connect_closing() as conn:
                    return fn(rid, params, pdb, conn)
            except _NoProject:
                return _err(rid, _E_NO_PROJECT, "no such project")
            except ValueError as e:
                return _err(rid, _E_PROJECT_ARG, str(e))
            except Exception as e:
                return _err(rid, _E_PROJECTS, str(e))
        return handler
    return decorator


def _require_project(pdb, conn, params: dict):
    """The project named by ``params['id']`` (or raise ``_NoProject``)."""
    proj = pdb.get_project(conn, str(params.get("id") or ""))
    if proj is None:
        raise _NoProject
    return proj


def _pick(params: dict, *keys: str) -> dict:
    return {k: params.get(k) for k in keys}


@_projects_method("projects.brief")
def _(rid, params, pdb, conn) -> dict:
    from hermes_cli.project_references import project_brief
    return _ok(rid, project_brief(conn, params.get("id")))


@_projects_method("projects.workflow")
def _(rid, params, pdb, conn) -> dict:
    from hermes_cli.project_workflows import workflow_draft
    return _ok(rid, workflow_draft(conn, params.get("id"), params.get("workflow"),
        params.get("approach", "standard"), params.get("task")))


@_projects_method("projects.references.scan")
def _(rid, params, pdb, conn) -> dict:
    from hermes_cli.project_references import scan_references
    return _ok(rid, scan_references(conn, params.get("id")))


@_projects_method("projects.references.index")
def _(rid, params, pdb, conn) -> dict:
    from hermes_cli.project_references import index_references
    return _ok(rid, index_references(conn, params.get("id")))


@_projects_method("projects.references.search")
def _(rid, params, pdb, conn) -> dict:
    from hermes_cli.project_references import search_references
    return _ok(rid, search_references(conn, params.get("id"), params.get("query"),
        include_history=bool(params.get("include_history"))))


@_projects_method("projects.references.citation")
def _(rid, params, pdb, conn) -> dict:
    from hermes_cli.project_references import reference_citation
    return _ok(rid, reference_citation(conn, params.get("id"), params.get("citation_id")))


@_projects_method("projects.results.refresh")
def _(rid, params, pdb, conn) -> dict:
    from hermes_cli.project_results import refresh_index
    return _ok(rid, refresh_index(conn))


@_projects_method("projects.actions.list")
def _(rid, params, pdb, conn) -> dict:
    from hermes_cli.project_actions import list_actions
    return _ok(rid, list_actions(conn, params.get("id")))


@_projects_method("projects.actions.draft")
def _(rid, params, pdb, conn) -> dict:
    from hermes_cli.project_actions import extraction_draft
    return _ok(rid, extraction_draft(conn, params.get("id"), params.get("file_id")))


@_projects_method("projects.actions.edit")
def _(rid, params, pdb, conn) -> dict:
    from hermes_cli.project_actions import edit_action
    return _ok(rid, edit_action(conn, params.get("id"), params.get("action_id"),
        **_pick(params, "title", "owner", "due_text")))


@_projects_method("projects.actions.dismiss")
def _(rid, params, pdb, conn) -> dict:
    from hermes_cli.project_actions import dismiss_action
    return _ok(rid, dismiss_action(conn, params.get("id"), params.get("action_id")))


@_projects_method("projects.actions.accept")
def _(rid, params, pdb, conn) -> dict:
    from hermes_cli.project_actions import accept_action
    return _ok(rid, accept_action(conn, params.get("id"), params.get("action_id")))


@_projects_method("projects.results.list")
def _(rid, params, pdb, conn) -> dict:
    from hermes_cli.project_results import list_results
    return _ok(rid, list_results(conn, project_id=params.get("project_id"),
        before=params.get("before"), limit=params.get("limit", 100)))


@_projects_method("projects.results.versions")
def _(rid, params, pdb, conn) -> dict:
    from hermes_cli.project_results import result_versions
    return _ok(rid, {"versions": result_versions(conn, str(params.get("result_id") or ""))})


@_projects_method("projects.results.preview")
def _(rid, params, pdb, conn) -> dict:
    from hermes_cli.project_results import preview_version
    return _ok(rid, preview_version(conn, str(params.get("version_id") or "")))


@_projects_method("projects.results.capture")
def _(rid, params, pdb, conn) -> dict:
    from hermes_cli.project_results import capture_version
    return _ok(rid, {"version": capture_version(conn, str(params.get("result_id") or ""))})


@_projects_method("projects.results.review")
def _(rid, params, pdb, conn) -> dict:
    from hermes_cli.project_results import review_version
    return _ok(rid, {"version": review_version(conn,
        str(params.get("version_id") or ""), params.get("state"))})


def _register_project_mutator(suffix: str, fn_name: str, takes_path: bool, kwargs_of) -> None:
    """``projects.<suffix>``: resolve ``params['id']`` (5062 when missing), call
    ``pdb.<fn_name>(conn, id[, path], **kwargs_of(params))``, answer with the refreshed project."""
    @_projects_method(f"projects.{suffix}")
    def _(rid, params, pdb, conn) -> dict:
        proj = _require_project(pdb, conn, params)
        args = (str(params.get("path") or ""),) if takes_path else ()
        getattr(pdb, fn_name)(conn, proj.id, *args, **kwargs_of(params))
        return _ok(rid, {"project": pdb.get_project(conn, proj.id).to_dict()})


_register_project_mutator(
    "update", "update_project", False,
    lambda p: _pick(p, "name", "description", "icon", "color", "board_slug"))
_register_project_mutator(
    "add_folder", "add_folder", True,
    lambda p: {"label": p.get("label"), "is_primary": bool(p.get("is_primary"))})
_register_project_mutator("remove_folder", "remove_folder", True, lambda p: {})
_register_project_mutator("set_primary", "set_primary", True, lambda p: {})


@_projects_method("projects.edit")
def _(rid, params, pdb, conn) -> dict:
    from hermes_constants import get_hermes_home
    from hermes_state_registry import acquire

    project = _require_project(pdb, conn, params)
    name = params.get("name")
    prepared, moves = pdb.prepare_project_edit(conn, project.id, name, params.get("folders"))
    home = get_hermes_home()
    # Keep live workspace changes ordered with registry mutations. Never re-home
    # a running task while its tools are still using the previous directory.
    with _sessions_lock:
        affected = []
        for sid, session in _sessions.items():
            session_home = Path(session.get("profile_home") or _hermes_home)
            if session_home.resolve() != home.resolve():
                continue
            old = session.get("cwd")
            cwd = pdb.relocated_path(old, moves)
            if cwd != old:
                if session.get("running"):
                    raise ValueError("A task in this folder is running. Save after it finishes.")
                if not os.path.isdir(cwd):
                    raise ValueError(f"task working directory does not exist: {cwd}")
                affected.append((sid, session, cwd))
        if moves:
            with contextlib.closing(acquire(home / "state.db")) as db:
                pdb.save_project_edit(conn, project.id, name, prepared, moves, state_db_path=db.db_path)
        else:
            pdb.save_project_edit(conn, project.id, name, prepared, moves)
        for sid, session, cwd in affected:
            _set_session_cwd(session, cwd)
            _emit("session.info", sid, _cwd_info(session, cwd))
    git_probe.invalidate()
    return _ok(rid, {"project": pdb.get_project(conn, project.id).to_dict(), "relocated_paths": moves})


@_projects_method("projects.list")
def _(rid, params, pdb, conn) -> dict:
    return _ok(rid, _projects_payload(conn, include_health=bool(params.get("include_health"))))


@_projects_method("projects.get")
def _(rid, params, pdb, conn) -> dict:
    return _ok(rid, {"project": _project_payload(_require_project(pdb, conn, params), bool(params.get("include_health")))})


@_projects_method("projects.create")
def _(rid, params, pdb, conn) -> dict:
    pid = pdb.create_project(
        conn, name=str(params.get("name") or ""), folders=params.get("folders") or [],
        **_pick(params, "slug", "primary_path", "description", "icon", "color", "board_slug"))
    if params.get("use"):
        pdb.set_active(conn, pid)
    proj = pdb.get_project(conn, pid)
    return _ok(rid, {"project": proj.to_dict() if proj else None})


@_projects_method("projects.archive")
def _(rid, params, pdb, conn) -> dict:
    proj = _require_project(pdb, conn, params)
    (pdb.restore_project if params.get("restore") else pdb.archive_project)(conn, proj.id)
    return _ok(rid, _projects_payload(conn))


@_projects_method("projects.delete")
def _(rid, params, pdb, conn) -> dict:
    pdb.delete_project(conn, _require_project(pdb, conn, params).id)
    return _ok(rid, _projects_payload(conn))


@_projects_method("projects.set_active")
def _(rid, params, pdb, conn) -> dict:
    pdb.set_active(conn, _require_project(pdb, conn, params).id if params.get("id") else None)
    return _ok(rid, {"active_id": pdb.get_active_id(conn)})


@_projects_method("projects.for_cwd")
def _(rid, params, pdb, conn) -> dict:
    cwd = _completion_cwd(
        {"cwd": str(params.get("cwd") or "").strip()} if params.get("cwd") else {})
    proj = pdb.project_for_path(conn, cwd)
    return _ok(rid, {
        "project": proj.to_dict() if proj else None, "cwd": cwd,
        "branch": git_probe.branch(cwd)})


def _non_workspace_dirs() -> set[str]:
    """Never-a-workspace dirs: ``/``, the user's home, the dir homes live in, plus both POSIX
    spellings on every host (remote shells hand back Linux paths; promoting one mints a
    catch-all project)."""
    home = os.path.realpath(os.path.expanduser("~"))
    candidates = (os.sep, home, os.path.dirname(home), "/home", "/Users")
    return {os.path.normcase(os.path.realpath(path)) for path in candidates if path}


def _is_repo_junk(root: str) -> bool:
    """A git root never auto-surfaced as a project: a non-workspace dir or anything under
    HERMES_HOME. User-created projects pointing there are still honored."""
    if not root:
        return True
    from hermes_constants import get_hermes_home
    real = os.path.realpath(root)
    hermes_home = os.path.realpath(str(get_hermes_home()))
    return (
        os.path.normcase(real) in _non_workspace_dirs()
        or real == hermes_home
        or real.startswith(hermes_home + os.sep))


def _is_session_cwd_junk(cwd: str) -> bool:
    """A non-git cwd that stays in flat Recents. A DESCENDANT of HERMES_HOME may be an
    intentional prose/data workspace, so only HERMES_HOME itself is excluded here."""
    if not cwd:
        return True
    from hermes_constants import get_hermes_home
    real = os.path.normcase(os.path.realpath(cwd))
    hermes_home = os.path.normcase(os.path.realpath(str(get_hermes_home())))
    return real in _non_workspace_dirs() or real == hermes_home


def _repo_discovery_policy(raw: dict | None = None) -> dict:
    """Return the effective, profile-local Desktop repository scan policy."""
    from hermes_cli.config import DEFAULT_CONFIG
    defaults = DEFAULT_CONFIG["desktop"]
    source = raw if isinstance(raw, dict) else (_load_cfg().get("desktop") or {})
    if not isinstance(source, dict):
        source = {}

    def _get(short: str, long: str):
        return source.get(short, source.get(long, defaults[long]))

    def _paths(short: str, long: str) -> list[str]:
        values = _get(short, long)
        if not isinstance(values, list):
            return list(defaults[long])
        return [v.strip() for v in values if isinstance(v, str) and v.strip()]
    enabled = _get("enabled", "repo_scan_enabled")
    return {
        "enabled": enabled if isinstance(enabled, bool) else defaults["repo_scan_enabled"],
        "roots": _paths("roots", "repo_scan_roots"),
        "exclude_paths": _paths("exclude_paths", "repo_scan_exclude_paths")}


def _repo_discovery_policy_key(policy: dict) -> str:
    def _paths(values: list[str]) -> list[str]:
        home = os.path.expanduser("~")
        return sorted({
            os.path.normcase(os.path.abspath(os.path.join(home, os.path.expanduser(v))))
            for v in values})
    canonical = {
        "enabled": bool(policy["enabled"]), "roots": _paths(policy["roots"]),
        "exclude_paths": _paths(policy["exclude_paths"])}
    return json.dumps(canonical, sort_keys=True, separators=(",", ":"))


def _repo_discovery_policy_is_default(policy: dict) -> bool:
    from hermes_cli.config import DEFAULT_CONFIG
    return _repo_discovery_policy_key(policy) == _repo_discovery_policy_key(
        _repo_discovery_policy(DEFAULT_CONFIG["desktop"]))


def _scan_discovered_repos_remote(conn, policy: dict) -> bool:
    """Backend-side disk scan of the policy roots into the discovery cache. Best-effort:
    failures log and leave the cache untouched. True only when the scan is authoritative
    (every root walked to completion, cap not hit) — only then is the cache write
    ``replace=True``; a partial/errored scan must MERGE, or a failed refresh blanks the sidebar.

    The desktop's native repo scan only runs on the local filesystem. On a remote gateway connection the
    host must scan its own disk so repos with zero Hermes sessions still appear in the sidebar (#81723).
    Mirrors the desktop's behavior: walk each root (bounded depth), find `.git` directories, record (root,
    label) pairs into the discovery cache.
    See #81723.
    """
    from hermes_cli import projects_db as pdb
    roots = policy.get("roots") or []
    excludes = policy.get("exclude_paths") or []
    pairs: list[tuple[str, str | None]] = []
    seen: set[str] = set()
    authoritative = True

    def _is_excluded(path: str) -> bool:
        return any(
            path == ex or path.startswith(ex.rstrip("/\\") + os.sep) for ex in excludes if ex)
    for root in roots:
        if not os.path.isdir(root):
            # `os.walk` on a missing root yields nothing; an unmounted volume must not wipe.
            authoritative = False
            logger.debug("discover_repos scan root missing, skipping: %s", root)
            continue
        try:
            for dirpath, dirnames, _filenames in os.walk(root):
                if _is_excluded(dirpath):
                    dirnames[:] = []
                elif ".git" in dirnames:  # check BEFORE pruning hidden dirs — `.git` is hidden
                    if dirpath not in seen:
                        seen.add(dirpath)
                        pairs.append((dirpath, os.path.basename(dirpath)))
                    dirnames[:] = []  # don't hunt nested repos inside a repo
                else:
                    dirnames[:] = [
                        d for d in dirnames if not d.startswith(".") and d != "node_modules"]
                if len(pairs) >= 500:
                    break
        except Exception:
            authoritative = False
            logger.debug("discover_repos scan failed for root %s", root, exc_info=True)
        if len(pairs) >= 500:  # cap hit: the walk didn't cover the full roots
            authoritative = False
            break
    if pairs:
        try:
            pdb.record_discovered_repos(
                conn, pairs, replace=authoritative, policy_key=_repo_discovery_policy_key(policy))
        except Exception:
            logger.debug("discover_repos cache write failed", exc_info=True)
            authoritative = False
    return authoritative


def _discover_repos_payload(
    db, *, conn=None, backfill: bool = True, include_cached: bool = True) -> list[dict]:
    """Merge cached filesystem-scanned repos with session-derived roots, junk-filtered, with
    session totals. ``backfill`` persists resolved roots onto session rows — kept OFF the
    per-turn tree path and done only on explicit refresh."""
    repos: dict[str, dict] = {}

    def _agg(root: str) -> dict:
        return repos.setdefault(
            root, {"root": root, "label": "", "sessions": 0, "last_active": 0.0})
    cwd_rows = list(db.distinct_session_cwds())
    # Parallel-warm the per-cwd git probes so a cold first paint doesn't serialize them.
    git_probe.warm_roots(str(r.get("cwd") or "") for r in cwd_rows)
    cwd_to_root: dict[str, str] = {}
    for row in cwd_rows:
        cwd = str(row.get("cwd") or "")
        root = git_probe.common_repo_root(cwd)
        if not root:
            continue
        cwd_to_root[cwd] = root
        if _is_repo_junk(root):
            continue
        agg = _agg(root)
        agg["sessions"] += int(row.get("sessions") or 0)
        agg["last_active"] = max(agg["last_active"], float(row.get("last_active") or 0))
    if backfill:
        try:
            db.backfill_repo_roots(cwd_to_root)
        except Exception:
            logger.debug("failed to backfill repo roots", exc_info=True)
    if include_cached:
        # `last_seen` is scan time, not user activity — never fold it into `last_active`.
        try:
            from hermes_cli import projects_db as pdb
            with (contextlib.nullcontext(conn) if conn is not None else pdb.connect_closing()) as c:
                for entry in pdb.list_discovered_repos(c):
                    root = str(entry.get("root") or "")
                    if root and not _is_repo_junk(root):
                        agg = _agg(root)
                        if entry.get("label"):
                            agg["label"] = entry["label"]
        except Exception:
            logger.debug("failed to read discovered repo cache", exc_info=True)
    out = sorted(repos.values(), key=lambda r: r["last_active"], reverse=True)
    for r in out:
        r["label"] = r["label"] or os.path.basename(r["root"].rstrip("/\\")) or r["root"]
    return out


# Not user conversations; subagent/compression children are dropped by include_children=False.
_PROJECT_TREE_EXCLUDED_SOURCES = ["cron", "kanban"]


def _project_tree_row(r: dict) -> dict:
    """Project a SessionDB row to the minimal shape the sidebar renders (grouping fields +
    what ``SidebarSessionRow`` reads), minus the heavy columns."""
    row = {k: r.get(k) for k in (
        "id", "_lineage_root_id", "_lineage_ids", "parent_session_id", "title", "preview")}
    row.update(
        started_at=r.get("started_at") or 0, ended_at=r.get("ended_at"),
        last_active=r.get("last_active") or r.get("started_at") or 0,
        source=r.get("source"), archived=bool(r.get("archived")),
        **{k: r.get(k) or 0 for k in (
            "message_count", "tool_call_count", "input_tokens", "output_tokens")},
        **{k: r.get(k) for k in ("actual_cost_usd", "estimated_cost_usd", "model")},
        is_active=False, **{k: r.get(k) for k in ("cwd", "git_branch", "git_repo_root")})
    return row


def _project_tree_inputs(
    db, session_limit: int, *, include_discovered: bool
) -> tuple[list[dict], list[dict], list[dict], str | None]:
    """Gather (sessions, projects, discovered_repos, active_id) for build_tree.
    ``include_discovered`` is the zero-session-repo overview tier; drill-in skips it (and
    the distinct-cwd scan + git probes) on that per-turn path."""
    # compact_rows: selecting the system-prompt blob only to drop it costs tens of MB of reads.
    rows = db.list_sessions_rich(
        limit=session_limit, offset=0, order_by_last_active=True, min_message_count=1,
        include_children=False, exclude_sources=_PROJECT_TREE_EXCLUDED_SOURCES,
        include_archived=False, compact_rows=True)
    sessions = [_project_tree_row(r) for r in rows]
    # Parallel-warm the git cache so build_tree's resolver doesn't cold-probe each cwd in turn.
    git_probe.warm_roots(s["cwd"] for s in sessions if s.get("cwd"))
    from hermes_cli import projects_db as pdb
    policy = _repo_discovery_policy()
    policy_key = _repo_discovery_policy_key(policy)
    with pdb.connect_closing() as conn:
        if include_discovered:
            pdb.reconcile_discovered_repos_policy(
                conn, policy_key, preserve_unversioned=_repo_discovery_policy_is_default(policy))
        projects = [p.to_dict() for p in pdb.list_projects(conn)]
        active_id = pdb.get_active_id(conn)
        # backfill stays off the hot tree path — grouping uses the live resolver.
        discovered = []
        if include_discovered:
            discovered = _discover_repos_payload(
                db, conn=conn, backfill=False, include_cached=policy["enabled"])
    return sessions, projects, discovered, active_id


# Per-build memo for `_dir_exists_cached`; cleared by every `_build_project_tree`.
_DIR_EXISTS_CACHE: dict[str, bool] = {}


def _dir_exists_cached(path: str) -> bool:
    """``os.path.isdir`` memoized per build — ``build_tree`` asks per SESSION, not per path."""
    hit = _DIR_EXISTS_CACHE.get(path)
    if hit is None:
        hit = _DIR_EXISTS_CACHE[path] = os.path.isdir(path)
    return hit


def _build_project_tree(
    db, *, preview_limit: int, hydrate: bool, session_limit: int, include_discovered: bool
) -> tuple[dict, str | None]:
    """Gather inputs and run the one authoritative builder. Returns (tree, active_id)."""
    from tui_gateway import project_tree
    _DIR_EXISTS_CACHE.clear()
    sessions, projects, discovered, active_id = _project_tree_inputs(
        db, session_limit, include_discovered=include_discovered)
    # build_tree also resolves declared project folders and discovered roots — warm them too.
    git_probe.warm_roots(
        [str(f.get("path") or "") for p in projects for f in (p.get("folders") or [])]
        + [str(r.get("root") or "") for r in discovered])
    tree = project_tree.build_tree(
        projects, sessions, discovered, git_probe.resolve, preview_limit=preview_limit,
        hydrate=hydrate, is_junk_root=_is_repo_junk, is_junk_cwd=_is_session_cwd_junk,
        exists=_dir_exists_cached)
    return tree, active_id


def register(server) -> None:
    """Publish this module's helpers + handlers onto ``server``, rebound to its globals."""
    bind_module(globals(), server, skip=("_",))
