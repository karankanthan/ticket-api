import smtplib
from dataclasses import replace

import pytest

from app import config, email_service


@pytest.fixture
def smtp_settings(monkeypatch):
    def apply(**overrides):
        values = dict(
            email_backend="smtp", smtp_host="smtp.test", smtp_port=587,
            smtp_username="helpdesk", smtp_password="super-secret-password",
            email_from="helpdesk@company.test", manager_email="manager@company.test",
            smtp_max_attempts=3,
        )
        values.update(overrides)
        monkeypatch.setattr(config, "settings", replace(config.settings, **values))
    monkeypatch.setattr(email_service.time, "sleep", lambda seconds: None)
    return apply


class FakeSMTP:
    sent = []
    failures = []

    def __init__(self, host, port, timeout=None, context=None):
        self.host = host

    def __enter__(self):
        if FakeSMTP.failures:
            raise FakeSMTP.failures.pop(0)
        return self

    def __exit__(self, *exc):
        return False

    def starttls(self, context=None):
        pass

    def login(self, username, password):
        self.username = username

    def send_message(self, message):
        FakeSMTP.sent.append(message)
        return {}


@pytest.fixture
def fake_smtp(monkeypatch):
    FakeSMTP.sent = []
    FakeSMTP.failures = []
    monkeypatch.setattr(email_service.smtplib, "SMTP", FakeSMTP)
    return FakeSMTP


def test_file_backend_saves_but_does_not_claim_delivery(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "settings", replace(config.settings, email_backend="file", email_outbox_dir=tmp_path))
    result = email_service.send("Subject", "text", "<p>html</p>")
    assert result["status"] == "saved_to_outbox"
    assert result["delivered"] is False
    assert len(list(tmp_path.glob("*.eml"))) == 1


def test_console_backend_does_not_claim_delivery(monkeypatch, capsys):
    monkeypatch.setattr(config, "settings", replace(config.settings, email_backend="console"))
    result = email_service.send("Subject", "text", "<p>html</p>")
    assert result["status"] == "printed_to_console"
    assert result["delivered"] is False
    assert "Subject" in capsys.readouterr().out


def test_smtp_sends(smtp_settings, fake_smtp):
    smtp_settings()
    result = email_service.send("Subject", "text", "<p>html</p>")
    assert (result["status"], result["delivered"], result["attempts"]) == ("sent", True, 1)
    assert fake_smtp.sent[0]["To"] == "manager@company.test"


def test_smtp_missing_settings_fails_without_sending(smtp_settings, fake_smtp):
    smtp_settings(smtp_host="", manager_email="")
    result = email_service.send("Subject", "text", "<p>html</p>")
    assert result["status"] == "failed"
    assert "SMTP_HOST" in result["error"] and "MANAGER_EMAIL" in result["error"]
    assert fake_smtp.sent == []


def test_smtp_retries_temporary_errors(smtp_settings, fake_smtp):
    smtp_settings()
    fake_smtp.failures = [smtplib.SMTPServerDisconnected("gone"), smtplib.SMTPResponseException(421, b"busy")]
    result = email_service.send("Subject", "text", "<p>html</p>")
    assert (result["status"], result["attempts"]) == ("sent", 3)


def test_smtp_gives_up_after_max_attempts(smtp_settings, fake_smtp):
    smtp_settings(smtp_max_attempts=2)
    fake_smtp.failures = [ConnectionRefusedError("no"), ConnectionRefusedError("no"), ConnectionRefusedError("no")]
    result = email_service.send("Subject", "text", "<p>html</p>")
    assert (result["status"], result["delivered"], result["attempts"]) == ("failed", False, 2)


def test_smtp_does_not_retry_login_failure(smtp_settings, fake_smtp):
    smtp_settings()
    fake_smtp.failures = [smtplib.SMTPAuthenticationError(535, b"bad credentials")]
    result = email_service.send("Subject", "text", "<p>html</p>")
    assert result["attempts"] == 1
    assert "SMTP login failed" in result["error"]
    assert "super-secret-password" not in str(result)


def test_status_never_shows_password_and_masks_manager(smtp_settings):
    smtp_settings()
    status = email_service.status()
    assert "super-secret-password" not in str(status)
    assert status["manager_email"] == "m***@company.test"
    assert status["ready"] is True
    assert status["delivers_real_email"] is True


def test_status_warns_for_local_backend(workflow):
    status = workflow.client.get("/api/email/status").json()
    assert status["delivers_real_email"] is False
    assert any("not delivered" in w for w in status["warnings"])


def test_test_email_needs_confirmation(workflow):
    assert workflow.client.post("/api/email/test", json={}).status_code == 400
    result = workflow.client.post("/api/email/test", json={"confirm": True}).json()
    assert result["status"] == "saved_to_outbox"


def test_failed_batch_email_is_reported_and_links_never_work(workflow, smtp_settings, fake_smtp):
    smtp_settings(smtp_max_attempts=1)
    fake_smtp.failures = [ConnectionRefusedError("no")]
    batch = workflow.submit("T-8")

    assert batch["status"] == "email_failed"
    assert batch["emails"][0]["delivered"] is False
    request = workflow.client.get("/api/approvals", params={"ticket_id": "T-8"}).json()[0]
    assert request["emailed_at"] is None

    from app import tokens
    assert all(t["revoked_reason"] == "email was not sent" for t in tokens.TOKENS.values())

    resent = workflow.client.post(f"/api/control-center/batches/{batch['batch_id']}/resend").json()
    assert resent["status"] == "sent"
    assert len(fake_smtp.sent) == 1


def test_resend_with_nothing_pending_is_409(workflow):
    batch = workflow.submit("T-8")
    links = workflow.links(workflow.emails()[-1])
    workflow.client.post(links["T-8"]["approve"], data={"confirm": "yes"})
    assert workflow.client.post(f"/api/control-center/batches/{batch['batch_id']}/resend").status_code == 409
