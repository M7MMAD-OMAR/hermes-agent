"""A key can say whose it is.

Two accounts at one provider — a company key and a personal one, each in its own profile's
.env — arrive under the SAME variable name, so every surface that names a credential by its
variable shows them identically and nobody can tell which account a turn spends. The variable
cannot answer that; only the person who owns the keys can, via ``<VAR>_ACCOUNT``.
"""

import agent.credential_pool as credential_pool
from hermes_cli.inventory import _account_label


def _payload(monkeypatch, env: dict) -> dict:
    monkeypatch.setattr(credential_pool, "get_env_prefer_dotenv", lambda key: env.get(key, ""))

    return credential_pool._env_payload(
        env_var="OPENROUTER_API_KEY", token="sk-or-" + "x" * 40, base_url="https://openrouter.ai/api/v1"
    )


def test_a_named_key_carries_its_account(monkeypatch):
    payload = _payload(monkeypatch, {"OPENROUTER_API_KEY_ACCOUNT": "DN"})

    assert payload["account_label"] == "DN"

    entry = credential_pool.PooledCredential.from_dict(
        "openrouter",
        {**payload, "id": "e1", "label": "OPENROUTER_API_KEY", "priority": 1, "source": "env:OPENROUTER_API_KEY"},
    )
    assert entry.account_label == "DN"
    # And it is the name the pickers show, in place of the variable both accounts share.
    assert _account_label([{"account_label": "DN", "priority": 1, "source": "env:OPENROUTER_API_KEY"}]) == "DN"


def test_an_unnamed_key_is_unchanged(monkeypatch):
    payload = _payload(monkeypatch, {})

    assert "account_label" not in payload
    assert _account_label([{"priority": 1, "source": "env:OPENROUTER_API_KEY"}]) == "OPENROUTER_API_KEY"


def test_blank_and_whitespace_names_do_not_count(monkeypatch):
    assert "account_label" not in _payload(monkeypatch, {"OPENROUTER_API_KEY_ACCOUNT": "   "})
    assert "account_label" not in _payload(monkeypatch, {"OPENROUTER_API_KEY_ACCOUNT": ""})


def test_a_name_that_describes_the_sign_in_method_is_still_ignored(monkeypatch):
    """The label ladder only accepts names that identify a HOLDER. "oauth" is not one, and a
    key named that way must fall back rather than pretend to answer "which account"."""
    payload = _payload(monkeypatch, {"OPENROUTER_API_KEY_ACCOUNT": "oauth"})

    assert payload["account_label"] == "oauth"
    assert _account_label([{"account_label": "oauth", "priority": 1, "source": "env:OPENROUTER_API_KEY"}]) == (
        "OPENROUTER_API_KEY"
    )
