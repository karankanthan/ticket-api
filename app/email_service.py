"""Outgoing email with three backends.

- console: prints the message (nothing is delivered)
- file:    saves an .eml file to the outbox folder (nothing is delivered)
- smtp:    delivers through the configured SMTP server

Only the smtp backend can report "sent". The others report what they actually did.
"""

import hashlib
import logging
import re
import smtplib
import socket
import ssl
import time
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from pathlib import Path

from . import clock, config
from .serializers import mask_email
from .store import PersistentDict

log = logging.getLogger("ticket_api.email")

LOCAL_FROM = "ticket-api@localhost"
UNSET_RECIPIENT = "manager-email-not-configured@localhost"
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
GMAIL_APP_PASSWORD_HELP = (
    "Gmail needs a 16-character App Password (Google Account > Security > 2-Step Verification > "
    "App passwords), not your normal Gmail password."
)

# Outcome of real SMTP sends, so the dashboard can say whether delivery has been verified.
DELIVERY_LOG = PersistentDict(config.settings.store_dir / "email_delivery.json")


class EmailConfigError(Exception):
    pass


def missing_settings(settings=None):
    settings = settings or config.settings
    missing = []
    if settings.email_backend == "smtp":
        gmail = config.is_gmail_host(settings.smtp_host)
        if not settings.smtp_host:
            missing.append("SMTP_HOST")
        if gmail and not settings.smtp_username:
            missing.append("SMTP_USERNAME")
        if (settings.smtp_username or gmail) and not settings.smtp_password:
            missing.append("SMTP_PASSWORD")
        if not settings.email_from:
            missing.append("FROM_EMAIL")
        if not settings.manager_email:
            missing.append("MANAGER_EMAIL")
        elif not EMAIL_PATTERN.match(settings.manager_email):
            missing.append("MANAGER_EMAIL (not a valid email address)")
    return missing


def _fingerprint(settings):
    """Identifies the delivery setup, so a success with old settings is not reported as verified."""
    raw = "|".join(str(v) for v in (settings.smtp_host, settings.smtp_port, settings.smtp_security, settings.smtp_username, settings.manager_email))
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _record_delivery(result, settings):
    entry = {
        "status": result["status"],
        "error": result["error"],
        "at": result["at"],
        "recipient": result["recipient"],
        "fingerprint": _fingerprint(settings),
    }
    with DELIVERY_LOG.lock:
        DELIVERY_LOG.put("last_attempt", entry)
        if result["status"] == "sent":
            DELIVERY_LOG.put("last_success", entry)
        DELIVERY_LOG.save()


def delivery_record(settings=None):
    settings = settings or config.settings
    fingerprint = _fingerprint(settings)
    last = DELIVERY_LOG.get("last_attempt")
    success = DELIVERY_LOG.get("last_success")
    current = lambda e: e if e and e.get("fingerprint") == fingerprint else None
    last, success = current(last), current(success)
    return {
        "verified": settings.email_backend == "smtp" and success is not None,
        "last_success_at": success["at"] if success else None,
        "last_attempt_at": last["at"] if last else None,
        "last_attempt_status": last["status"] if last else None,
        "last_error": last["error"] if last and last["status"] != "sent" else None,
    }


def status():
    """Email configuration summary that is safe to show in the dashboard."""
    settings = config.settings
    missing = missing_settings(settings)
    warnings = []
    if settings.email_backend != "smtp":
        warnings.append(
            f"EMAIL_BACKEND={settings.email_backend}: emails are not delivered to anyone. "
            "Set EMAIL_BACKEND=smtp with SMTP settings for real delivery."
        )
    if not settings.manager_email:
        warnings.append("MANAGER_EMAIL is not set.")
    gmail = settings.email_backend == "smtp" and config.is_gmail_host(settings.smtp_host)
    if gmail and settings.email_from and settings.smtp_username and settings.email_from.lower() != settings.smtp_username.lower():
        warnings.append("Gmail sends as SMTP_USERNAME; a different FROM_EMAIL is replaced unless it is a verified alias.")
    delivery = delivery_record(settings)
    if settings.email_backend == "smtp" and not missing and not delivery["verified"]:
        warnings.append("SMTP is configured but delivery has not been verified yet. Send a test email.")
    if settings.public_base_url.startswith(("http://localhost", "http://127.0.0.1")):
        warnings.append(
            "PUBLIC_BASE_URL points to this computer, so action links only open on this computer."
        )
    return {
        "backend": settings.email_backend,
        "delivers_real_email": settings.email_backend == "smtp",
        "ready": not missing,
        "smtp_configured": settings.email_backend == "smtp" and not missing,
        "gmail": gmail,
        "delivery": delivery,
        "missing_settings": missing,
        "warnings": warnings,
        "manager_email": mask_email(settings.manager_email),
        "manager_email_configured": bool(settings.manager_email) and bool(EMAIL_PATTERN.match(settings.manager_email)),
        "email_from": settings.email_from,
        "smtp_host": settings.smtp_host if settings.email_backend == "smtp" else "",
        "smtp_port": settings.smtp_port if settings.email_backend == "smtp" else None,
        "smtp_security": settings.smtp_security if settings.email_backend == "smtp" else "",
        "smtp_auth_configured": bool(settings.smtp_username and settings.smtp_password),
        "outbox_dir": str(settings.email_outbox_dir) if settings.email_backend == "file" else "",
        "public_base_url": settings.public_base_url,
    }


def build_message(subject, text, html, employee=None):
    """Manager emails go to MANAGER_EMAIL; decision notices go to the ticket's employee. Never to customers."""
    settings = config.settings
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.email_from or LOCAL_FROM
    if employee:
        message["To"] = employee
    else:
        recipient = settings.manager_email or UNSET_RECIPIENT
        message["To"] = formataddr((settings.manager_name, recipient)) if settings.manager_name else recipient
    message["Message-ID"] = make_msgid(domain="ticket-api.local")
    message["Date"] = clock.now().strftime("%a, %d %b %Y %H:%M:%S %z")
    message.set_content(text)
    message.add_alternative(html, subtype="html")
    return message


def send(subject, text, html):
    """Send a message to the manager with the configured backend. Never raises; returns a delivery result."""
    return _deliver(build_message(subject, text, html), config.settings.manager_email, manager=True)


def send_to_employee(address, subject, text, html):
    """Decision notice to the employee who raised a ticket. The caller checks the address policy first."""
    return _deliver(build_message(subject, text, html, employee=address), address, manager=False)


def _deliver(message, recipient, manager):
    settings = config.settings
    result = {
        "backend": settings.email_backend,
        "status": "failed",
        "delivered": False,
        "message_id": message["Message-ID"],
        "recipient": mask_email(recipient),
        "attempts": 0,
        "error": None,
        "outbox_file": None,
        "at": clock.timestamp(),
    }

    missing = missing_settings(settings)
    if missing:
        result["error"] = f"Email is not configured. Missing: {', '.join(missing)}."
        if settings.email_backend == "smtp" and manager:
            _record_delivery(result, settings)
        return result

    try:
        if settings.email_backend == "console":
            result["attempts"] = 1
            print(f"\n----- EMAIL (console backend, not delivered) -----\n{message.as_string()}\n-----")
            result["status"] = "printed_to_console"
        elif settings.email_backend == "file":
            result["attempts"] = 1
            result["outbox_file"] = str(_save_to_outbox(message, settings.email_outbox_dir))
            result["status"] = "saved_to_outbox"
        else:
            _send_smtp(message, settings, result)
    except Exception as error:  # report every failure instead of crashing the request
        log.warning("Email delivery failed: %s", error)
        result["status"] = "failed"
        result["error"] = _describe(error, settings)

    result["at"] = clock.timestamp()
    if settings.email_backend == "smtp" and manager:
        _record_delivery(result, settings)
    return result


def _save_to_outbox(message, outbox_dir):
    outbox = Path(outbox_dir)
    outbox.mkdir(parents=True, exist_ok=True)
    stamp = clock.now().strftime("%Y%m%d-%H%M%S")
    message_id = message["Message-ID"].strip("<>").split("@")[0].replace(".", "-")
    path = outbox / f"{stamp}-{message_id}.eml"
    path.write_bytes(bytes(message))
    return path


def _is_temporary(error):
    if isinstance(error, smtplib.SMTPResponseException):
        return 400 <= error.smtp_code < 500
    return isinstance(
        error,
        (smtplib.SMTPServerDisconnected, smtplib.SMTPConnectError, socket.timeout, ConnectionError),
    )


def _send_smtp(message, settings, result):
    context = ssl.create_default_context()
    for attempt in range(1, settings.smtp_max_attempts + 1):
        result["attempts"] = attempt
        try:
            if settings.smtp_security == "ssl":
                server = smtplib.SMTP_SSL(
                    settings.smtp_host, settings.smtp_port,
                    timeout=settings.smtp_timeout_seconds, context=context,
                )
            else:
                server = smtplib.SMTP(
                    settings.smtp_host, settings.smtp_port, timeout=settings.smtp_timeout_seconds
                )
            with server:
                if settings.smtp_security == "starttls":
                    server.starttls(context=context)
                if settings.smtp_username:
                    server.login(settings.smtp_username, settings.smtp_password)
                refused = server.send_message(message)
            if refused:
                raise smtplib.SMTPRecipientsRefused(refused)
            result["status"] = "sent"
            result["delivered"] = True
            result["error"] = None
            return
        except Exception as error:
            if attempt >= settings.smtp_max_attempts or not _is_temporary(error):
                raise
            log.warning("Temporary SMTP error (attempt %s): %s", attempt, error)
            time.sleep(min(2 ** attempt, 10))


def _describe(error, settings=None):
    if isinstance(error, smtplib.SMTPAuthenticationError):
        if settings is not None and config.is_gmail_host(settings.smtp_host):
            return f"Gmail rejected the login ({error.smtp_code}). {GMAIL_APP_PASSWORD_HELP}"
        return "SMTP login failed. Check SMTP_USERNAME and SMTP_PASSWORD."
    if isinstance(error, smtplib.SMTPRecipientsRefused):
        return "The SMTP server refused the recipient address."
    if isinstance(error, smtplib.SMTPResponseException):
        detail = error.smtp_error.decode(errors="replace") if isinstance(error.smtp_error, bytes) else str(error.smtp_error)
        return f"SMTP server error {error.smtp_code}: {detail}"
    if isinstance(error, (socket.timeout, TimeoutError)):
        return "Timed out connecting to the SMTP server."
    if isinstance(error, (ConnectionError, OSError)):
        return f"Could not connect to the SMTP server: {error}"
    return f"{type(error).__name__}: {error}"
