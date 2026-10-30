"""Outgoing email with three backends.

- console: prints the message (nothing is delivered)
- file:    saves an .eml file to the outbox folder (nothing is delivered)
- smtp:    delivers through the configured SMTP server

Only the smtp backend can report "sent". The others report what they actually did.
"""

import logging
import smtplib
import socket
import ssl
import time
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from pathlib import Path

from . import clock, config
from .serializers import mask_email

log = logging.getLogger("ticket_api.email")

LOCAL_FROM = "ticket-api@localhost"
UNSET_RECIPIENT = "manager-email-not-configured@localhost"


class EmailConfigError(Exception):
    pass


def missing_settings(settings=None):
    settings = settings or config.settings
    missing = []
    if settings.email_backend == "smtp":
        if not settings.smtp_host:
            missing.append("SMTP_HOST")
        if not settings.email_from:
            missing.append("EMAIL_FROM")
        if not settings.manager_email:
            missing.append("MANAGER_EMAIL")
        if settings.smtp_username and not settings.smtp_password:
            missing.append("SMTP_PASSWORD")
    return missing


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
    if settings.public_base_url.startswith(("http://localhost", "http://127.0.0.1")):
        warnings.append(
            "PUBLIC_BASE_URL points to this computer, so action links only open on this computer."
        )
    return {
        "backend": settings.email_backend,
        "delivers_real_email": settings.email_backend == "smtp",
        "ready": not missing,
        "missing_settings": missing,
        "warnings": warnings,
        "manager_email": mask_email(settings.manager_email),
        "manager_email_configured": bool(settings.manager_email),
        "email_from": settings.email_from,
        "smtp_host": settings.smtp_host if settings.email_backend == "smtp" else "",
        "smtp_port": settings.smtp_port if settings.email_backend == "smtp" else None,
        "smtp_security": settings.smtp_security if settings.email_backend == "smtp" else "",
        "smtp_auth_configured": bool(settings.smtp_username and settings.smtp_password),
        "outbox_dir": str(settings.email_outbox_dir) if settings.email_backend == "file" else "",
        "public_base_url": settings.public_base_url,
    }


def build_message(subject, text, html, to=None):
    settings = config.settings
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.email_from or LOCAL_FROM
    recipient = to or settings.manager_email or UNSET_RECIPIENT
    message["To"] = formataddr((settings.manager_name, recipient)) if settings.manager_name and not to else recipient
    message["Message-ID"] = make_msgid(domain="ticket-api.local")
    message["Date"] = clock.now().strftime("%a, %d %b %Y %H:%M:%S %z")
    message.set_content(text)
    message.add_alternative(html, subtype="html")
    return message


def send(subject, text, html, to=None):
    """Send a message with the configured backend. Never raises; returns a delivery result."""
    settings = config.settings
    message = build_message(subject, text, html, to)
    result = {
        "backend": settings.email_backend,
        "status": "failed",
        "delivered": False,
        "message_id": message["Message-ID"],
        "recipient": mask_email(to or settings.manager_email),
        "attempts": 0,
        "error": None,
        "outbox_file": None,
        "at": clock.timestamp(),
    }

    missing = missing_settings(settings)
    if missing:
        result["error"] = f"Email is not configured. Missing: {', '.join(missing)}."
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
        result["error"] = _describe(error)

    result["at"] = clock.timestamp()
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


def _describe(error):
    if isinstance(error, smtplib.SMTPAuthenticationError):
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
