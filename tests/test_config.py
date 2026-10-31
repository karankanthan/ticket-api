import pytest

from app.config import load_settings


@pytest.fixture
def env(monkeypatch):
    for name in (
        "APP_ENV",
        "ADMIN_API_KEY",
        "SLA_HOURS_URGENT",
        "REMINDER_AFTER_HOURS",
        "MAX_REMINDERS",
    ):
        monkeypatch.delenv(name, raising=False)
    return monkeypatch


def test_defaults_match_agreed_targets(env):
    settings = load_settings()
    assert settings.ticket_sla_hours == {"urgent": 4, "high": 8, "normal": 24, "low": 72}
    assert settings.approval_response_hours == {"urgent": 4, "high": 24, "normal": 24, "low": 24}
    assert settings.reminder_after_hours == (2, 6, 24)
    assert settings.max_reminders == 3


def test_local_does_not_require_admin_key(env):
    settings = load_settings()
    assert settings.admin_key_required is False


def test_local_with_key_requires_it(env):
    env.setenv("ADMIN_API_KEY", "secret")
    assert load_settings().admin_key_required is True


def test_production_without_admin_key_fails(env):
    env.setenv("APP_ENV", "production")
    with pytest.raises(RuntimeError, match="ADMIN_API_KEY"):
        load_settings()


def test_sla_hours_are_configurable(env):
    env.setenv("SLA_HOURS_URGENT", "2")
    assert load_settings().ticket_sla_hours["urgent"] == 2


def test_invalid_hours_give_clear_error(env):
    env.setenv("SLA_HOURS_URGENT", "soon")
    with pytest.raises(RuntimeError, match="SLA_HOURS_URGENT"):
        load_settings()


def test_reminder_hours_must_increase(env):
    env.setenv("REMINDER_AFTER_HOURS", "6,2")
    with pytest.raises(RuntimeError, match="REMINDER_AFTER_HOURS"):
        load_settings()


def test_unknown_app_env_fails(env):
    env.setenv("APP_ENV", "staging")
    with pytest.raises(RuntimeError, match="APP_ENV"):
        load_settings()
