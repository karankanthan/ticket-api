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


def _int(name, default, minimum=0):
    raw = _env(name, str(default))
    try:
        value = int(raw)
    except ValueError:
        raise RuntimeError(f"{name} must be a whole number, got {raw!r}.")
    if value < minimum:
        raise RuntimeError(f"{name} must be at least {minimum}, got {raw!r}.")
    return value


def _bool(name, default):
    raw = _env(name, "true" if default else "false").lower()
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    raise RuntimeError(f"{name} must be true or false, got {raw!r}.")


def _choice(name, default, choices):
    value = _env(name, default).lower()
    if value not in choices:
        raise RuntimeError(f"{name} must be one of {', '.join(choices)}, got {value!r}.")
    return value


def _fraction(name, default):
    raw = _env(name, str(default))
    try:
        value = float(raw)
    except ValueError:
        raise RuntimeError(f"{name} must be a number between 0 and 1, got {raw!r}.")
    if not 0 < value < 1:
        raise RuntimeError(f"{name} must be between 0 and 1, got {raw!r}.")
    return value


@dataclass(frozen=True)
class Settings:
    app_env: str
    tickets_data_path: str
    store_dir: Path
    admin_api_key: str = field(repr=False)
    ticket_sla_hours: dict = field(default_factory=dict)
    approval_response_hours: dict = field(default_factory=dict)
    reminder_after_hours: tuple = ()
    max_reminders: int = 3
    sla_at_risk_fraction: float = 0.25
    max_batch_size: int = 100
    public_base_url: str = "http://localhost:8000"
    action_link_ttl_hours: float = 72
    scheduler_enabled: bool = True
    scheduler_interval_seconds: int = 300
    email_backend: str = "file"
    email_outbox_dir: Path = PROJECT_DIR / "data" / "outbox"
    email_from: str = ""
    manager_email: str = ""
    manager_name: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = field(default="", repr=False)
    smtp_password: str = field(default="", repr=False)
    smtp_security: str = "starttls"
    smtp_timeout_seconds: int = 20
    smtp_max_attempts: int = 3

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
        sla_at_risk_fraction=_fraction("SLA_AT_RISK_FRACTION", 0.25),
        max_batch_size=_int("MAX_BATCH_SIZE", 100, minimum=1),
        public_base_url=_env("PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/"),
        action_link_ttl_hours=_hours("ACTION_LINK_TTL_HOURS", 72),
        scheduler_enabled=_bool("SCHEDULER_ENABLED", True),
        scheduler_interval_seconds=_int("SCHEDULER_INTERVAL_SECONDS", 300, minimum=10),
        email_backend=_choice("EMAIL_BACKEND", "file", ("console", "file", "smtp")),
        email_outbox_dir=Path(_env("EMAIL_OUTBOX_DIR") or PROJECT_DIR / "data" / "outbox"),
        email_from=_env("EMAIL_FROM"),
        manager_email=_env("MANAGER_EMAIL"),
        manager_name=_env("MANAGER_NAME"),
        smtp_host=_env("SMTP_HOST"),
        smtp_port=_int("SMTP_PORT", 587, minimum=1),
        smtp_username=_env("SMTP_USERNAME"),
        smtp_password=os.environ.get("SMTP_PASSWORD", ""),
        smtp_security=_choice("SMTP_SECURITY", "starttls", ("starttls", "ssl", "none")),
        smtp_timeout_seconds=_int("SMTP_TIMEOUT_SECONDS", 20, minimum=1),
        smtp_max_attempts=_int("SMTP_MAX_ATTEMPTS", 3, minimum=1),
    )


settings = load_settings()
