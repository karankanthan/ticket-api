import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

PROJECT_DIR = Path(__file__).resolve().parent.parent
PRIORITIES = ("urgent", "high", "normal", "low")


def _env(name, default=""):
    return os.environ.get(name, default).strip()


def _hours(name, default):
    raw = _env(name, str(default))
    try:
        value = float(raw)
    except ValueError:
        raise RuntimeError(f"{name} must be a number of hours, got {raw!r}.")
    if value <= 0:
        raise RuntimeError(f"{name} must be greater than 0, got {raw!r}.")
    return value


def _hours_list(name, default):
    raw = _env(name, ",".join(str(h) for h in default))
    try:
        values = [float(part) for part in raw.split(",") if part.strip()]
    except ValueError:
        raise RuntimeError(f"{name} must be comma-separated hours, got {raw!r}.")
    if not values or any(v <= 0 for v in values) or values != sorted(values):
        raise RuntimeError(f"{name} must be increasing positive hours, got {raw!r}.")
    return tuple(values)


def _int(name, default):
    raw = _env(name, str(default))
    try:
        value = int(raw)
    except ValueError:
        raise RuntimeError(f"{name} must be a whole number, got {raw!r}.")
    if value < 0:
        raise RuntimeError(f"{name} must not be negative, got {raw!r}.")
    return value


@dataclass(frozen=True)
class Settings:
    app_env: str
    tickets_data_path: str
    store_dir: Path
    admin_api_key: str
    ticket_sla_hours: dict = field(default_factory=dict)
    approval_response_hours: dict = field(default_factory=dict)
    reminder_after_hours: tuple = ()
    max_reminders: int = 3

    @property
    def is_production(self):
        return self.app_env == "production"

    @property
    def admin_key_required(self):
        return self.is_production or bool(self.admin_api_key)


def load_settings():
    app_env = _env("APP_ENV", "local").lower()
    if app_env not in ("local", "production"):
        raise RuntimeError(f"APP_ENV must be 'local' or 'production', got {app_env!r}.")

    admin_api_key = _env("ADMIN_API_KEY")
    if app_env == "production" and not admin_api_key:
        raise RuntimeError("ADMIN_API_KEY must be set when APP_ENV=production.")

    store_dir = Path(_env("APP_STORE_DIR") or PROJECT_DIR / "data" / "store")

    other_response = _hours("APPROVAL_RESPONSE_HOURS_OTHER", 24)

    return Settings(
        app_env=app_env,
        tickets_data_path=_env(
            "TICKETS_DATA_PATH", str(PROJECT_DIR / "data" / "tickets_sample.csv")
        ),
        store_dir=store_dir,
        admin_api_key=admin_api_key,
        ticket_sla_hours={
            "urgent": _hours("SLA_HOURS_URGENT", 4),
            "high": _hours("SLA_HOURS_HIGH", 8),
            "normal": _hours("SLA_HOURS_NORMAL", 24),
            "low": _hours("SLA_HOURS_LOW", 72),
        },
        approval_response_hours={
            "urgent": _hours("APPROVAL_RESPONSE_HOURS_URGENT", 4),
            "high": other_response,
            "normal": other_response,
            "low": other_response,
        },
        reminder_after_hours=_hours_list("REMINDER_AFTER_HOURS", (2, 6, 24)),
        max_reminders=_int("MAX_REMINDERS", 3),
    )


settings = load_settings()
