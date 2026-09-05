"""Kimi / Moonshot provider profiles (chat_completions path; sk-kimi-* keys are
redirected to api.kimi.com/coding by core)."""

from typing import Any
from urllib.parse import urlparse

from agent.reasoning_effort import KIMI_K3_EFFORTS, KIMI_K3_OVERRIDES, clamp_effort, requested_effort
from hermes_cli import __version__ as _HERMES_VERSION
from providers import register_provider
from providers.base import OMIT_TEMPERATURE, ProviderProfile

_HEADERS = {
    "HTTP-Referer": "https://hermes-agent.nousresearch.com",
    "X-Title": "Hermes Agent",
    "User-Agent": f"HermesAgent/{_HERMES_VERSION}",
}


def _is_confirmed_kimi_coding_url(base_url: str) -> bool:
    """True only for Kimi Code's canonical HTTPS API surfaces."""
    try:
        p = urlparse(base_url)
        port = p.port
    except ValueError:
        return False
    return (
        p.scheme.lower() == "https" and (p.hostname or "").lower() == "api.kimi.com" and port in (None, 443)
        and p.username is None and p.password is None
        and p.path.rstrip("/") in {"/coding", "/coding/v1"} and not p.query and not p.fragment
    )



KIMI_CODE_USAGE_BASE_URL = "https://api.kimi.com/coding/v1"

_KIMI_TIME_UNIT_SECONDS = {
    "TIME_UNIT_SECOND": 1,
    "TIME_UNIT_MINUTE": 60,
    "TIME_UNIT_HOUR": 3600,
    "TIME_UNIT_DAY": 86400,
}


def _kimi_window_label(window: dict) -> str:
    """Name a window from its declared length, not from a guessed period."""
    try:
        duration = int(window.get("duration") or 0)
    except (TypeError, ValueError):
        duration = 0
    seconds = duration * _KIMI_TIME_UNIT_SECONDS.get(str(window.get("timeUnit") or ""), 0)
    if seconds <= 0:
        return "window"
    if seconds % 86400 == 0:
        return f"{seconds // 86400}d"
    if seconds % 3600 == 0:
        return f"{seconds // 3600}h"
    return f"{max(1, seconds // 60)}m"



class KimiProfile(ProviderProfile):
    """Kimi/Moonshot — temperature omitted, thinking xor reasoning_effort."""

    def fetch_models(
        self, *, api_key: str | None = None, base_url: str | None = None, timeout: float = 8.0
    ) -> list[str] | None:
        """Use Kimi Code's OpenAI-compatible surface for model discovery; the bare
        ``k3`` slug is only served there, so it is filtered off other endpoints."""
        effective_base = (base_url or self.base_url or "").rstrip("/")
        confirmed_coding_endpoint = _is_confirmed_kimi_coding_url(effective_base)
        if confirmed_coding_endpoint and urlparse(effective_base).path.rstrip("/") == "/coding":
            effective_base += "/v1"
        models = super().fetch_models(api_key=api_key, base_url=effective_base or None, timeout=timeout)
        if models is None or confirmed_coding_endpoint:
            return models
        return [model for model in models if model.strip().lower() != "k3"]

    def build_api_kwargs_extras(
        self, *, reasoning_config: dict | None = None, **context
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """Moonshot treats extra_body.thinking and reasoning_effort as mutually
        exclusive (400 on both): send effort when requested, else the toggle."""
        if isinstance(reasoning_config, dict) and reasoning_config.get("enabled", True) is False:
            return {"thinking": {"type": "disabled"}}, {}
        effort = requested_effort(reasoning_config)
        k3_effort = clamp_effort(effort, KIMI_K3_EFFORTS, KIMI_K3_OVERRIDES) if effort != "none" else None
        if k3_effort in KIMI_K3_EFFORTS:
            return {}, {"reasoning_effort": k3_effort}
        return {"thinking": {"type": "enabled"}}, {}

    def fetch_usage(
        self,
        *,
        credential=None,
        base_url: str | None = None,
        timeout: float = 8.0,
    ):
        """Kimi Code plan quotas: a rolling window plus a longer one.

        ``GET {coding}/v1/usages``. The response labels a field ``used`` whose
        value tracks what is LEFT, while the sibling window calls the same
        quantity ``remaining`` — so nothing here derives a percentage from
        ``used``. Both figures are stored verbatim and the shared model derives
        a percentage only from ``limit`` + ``remaining``, which is unambiguous.

        Window length comes from the payload (``window.duration`` +
        ``timeUnit``), never from a guessed name: the second window's
        ``resetTime`` lands ~a day out, not a week, despite third-party docs
        calling it "weekly".
        """
        import httpx

        from agent.provider_usage_types import (
            UNIT_COUNT,
            ProviderUsage,
            UsageWindow,
            to_datetime,
            to_decimal,
        )

        token = str(getattr(credential, "access_token", "") or "").strip()
        if not token:
            return None

        base = str(base_url or getattr(credential, "base_url", "") or KIMI_CODE_USAGE_BASE_URL)
        base = base.rstrip("/")
        if not base.endswith("/v1"):
            base = base + "/v1"

        with httpx.Client(timeout=timeout) as client:
            response = client.get(
                f"{base}/usages",
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            )
            response.raise_for_status()
            payload = response.json() or {}

        windows = []
        for entry in payload.get("limits") or ():
            if not isinstance(entry, dict):
                continue
            detail = entry.get("detail") or {}
            windows.append(
                UsageWindow(
                    label=_kimi_window_label(entry.get("window") or {}),
                    unit=UNIT_COUNT,
                    limit=to_decimal(detail.get("limit")),
                    remaining=to_decimal(detail.get("remaining")),
                    reset_at=to_datetime(detail.get("resetTime")),
                )
            )

        rolling = payload.get("usage")
        if isinstance(rolling, dict) and rolling:
            windows.append(
                UsageWindow(
                    label="period",
                    unit=UNIT_COUNT,
                    limit=to_decimal(rolling.get("limit")),
                    remaining=to_decimal(rolling.get("used")),
                    reset_at=to_datetime(rolling.get("resetTime")),
                )
            )

        membership = ((payload.get("user") or {}).get("membership") or {}).get("level")
        plan = str(membership or "").replace("LEVEL_", "").title() or None

        return ProviderUsage(
            provider="kimi-coding",
            display_name="Kimi Code",
            plan=plan,
            windows=tuple(windows),
        )


def _kimi(name: str, aliases: tuple, env_vars: tuple, base_url: str) -> KimiProfile:
    return KimiProfile(
        name=name, aliases=aliases, env_vars=env_vars, base_url=base_url,
        fixed_temperature=OMIT_TEMPERATURE, default_max_tokens=32000,
        default_headers=dict(_HEADERS), default_aux_model="kimi-k2-turbo-preview",
        # The short window is 5 hours; a minute of cache costs nothing and
        # keeps a burst of panel opens off the endpoint.
        usage_ttl=60,
    )




kimi = _kimi("kimi-coding", ("kimi", "moonshot", "kimi-for-coding"), ("KIMI_API_KEY", "KIMI_CODING_API_KEY"),
             "https://api.moonshot.ai/v1")
kimi_cn = _kimi("kimi-coding-cn", ("kimi-cn", "moonshot-cn"), ("KIMI_CN_API_KEY",), "https://api.moonshot.cn/v1")

register_provider(kimi)
register_provider(kimi_cn)
