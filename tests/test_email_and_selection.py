"""Manager email over SMTP, delivery verification, and Control Center eligibility fixes."""

import os
import smtplib
from dataclasses import replace

import pytest
from conftest import SECRET_CUSTOMER_EMAIL
from fastapi.testclient import TestClient

from app import config, email_service, main, recommendations
from app.config import load_settings
from app.instance_lock import InstanceLock, StoreInUse

MANAGER = "manager.test@example.com"


class RecordingSMTP:
    """Stands in for smtplib.SMTP: records what would be sent, sends nothing."""

    sent = []
    logins = []
    fail_login = None

    def __init__(self, host, port, timeout=None, context=None):
        self.host, self.port = host, port

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def starttls(self, context=None):
        pass

    def login(self, username, password):
        if RecordingSMTP.fail_login:
            raise RecordingSMTP.fail_login
        RecordingSMTP.logins.append((self.host, username, len(password)))

    def send_message(self, message):
        RecordingSMTP.sent.append(message)
        return {}


@pytest.fixture
def gmail(monkeypatch):
    RecordingSMTP.sent, RecordingSMTP.logins, RecordingSMTP.fail_login = [], [], None
    email_service.DELIVERY_LOG.clear()
    monkeypatch.setattr(email_service.smtplib, "SMTP", RecordingSMTP)
    monkeypatch.setattr(email_service.time, "sleep", lambda s: None)

    def configure(**overrides):
        values = dict(
            email_backend="smtp", smtp_host="smtp.gmail.com", smtp_port=587, smtp_security="starttls",
            smtp_username="helpdesk.sender@gmail.com", smtp_password="abcdabcdabcdabcd",
            email_from="helpdesk.sender@gmail.com", manager_email=MANAGER,
        )
        values.update(overrides)
        monkeypatch.setattr(config, "settings", replace(config.settings, **values))

    return configure


# --- Configuration ---------------------------------------------------------------

def test_tests_never_see_the_developers_env_file():
    # .env may hold the real manager address and an App Password; tests must not use them.
    assert config.settings.manager_email == ""
    assert config.settings.smtp_password == ""
    assert config.settings.email_backend == "file"


@pytest.fixture
def env(monkeypatch):
    for name in ("EMAIL_BACKEND", "SMTP_HOST", "SMTP_USERNAME", "SMTP_PASSWORD", "EMAIL_FROM", "FROM_EMAIL", "MANAGER_EMAIL"):
        monkeypatch.setenv(name, "")
    return monkeypatch


@pytest.mark.parametrize("name,read,default", [
    ("EMAIL_BACKEND", lambda s: s.email_backend, "file"),
    ("SMTP_PORT", lambda s: s.smtp_port, 587),
    ("SMTP_SECURITY", lambda s: s.smtp_security, "starttls"),
    ("SLA_HOURS_URGENT", lambda s: s.ticket_sla_hours["urgent"], 4),
    ("MAX_REMINDERS", lambda s: s.max_reminders, 3),
    ("SCHEDULER_ENABLED", lambda s: s.scheduler_enabled, True),
])
def test_blank_setting_in_env_file_uses_the_default(env, name, read, default):
    env.setenv(name, "")
    assert read(load_settings()) == default


def test_from_email_is_accepted_as_an_alias(env):
    env.setenv("FROM_EMAIL", "sender@example.org")
    assert load_settings().email_from == "sender@example.org"


def test_from_address_defaults_to_the_gmail_account(env):
    env.setenv("SMTP_USERNAME", "sender@gmail.com")
    assert load_settings().email_from == "sender@gmail.com"


def test_gmail_app_password_spaces_are_removed(env):
    env.setenv("SMTP_HOST", "smtp.gmail.com")
    env.setenv("SMTP_PASSWORD", "abcd efgh ijkl mnop")
    assert load_settings().smtp_password == "abcdefghijklmnop"


def test_gmail_without_credentials_is_not_ready(gmail):
    gmail(smtp_username="", smtp_password="", email_from="")
    assert email_service.missing_settings() == ["SMTP_USERNAME", "SMTP_PASSWORD", "FROM_EMAIL"]
    status = email_service.status()
    assert status["ready"] is False and status["smtp_configured"] is False
    result = email_service.send("s", "t", "<p>h</p>")
    assert result["status"] == "failed" and "SMTP_PASSWORD" in result["error"]
    assert RecordingSMTP.sent == []


def test_invalid_manager_address_is_reported(gmail):
    gmail(manager_email="not-an-address")
    assert "MANAGER_EMAIL (not a valid email address)" in email_service.missing_settings()


# --- Delivery ---------------------------------------------------------------------

def test_successful_delivery_goes_only_to_the_manager(gmail):
    gmail()
    result = email_service.send("Subject", "text", "<p>html</p>")
    assert (result["status"], result["delivered"]) == ("sent", True)
    message = RecordingSMTP.sent[0]
    assert message["To"] == MANAGER
    assert message["From"] == "helpdesk.sender@gmail.com"
    assert RecordingSMTP.logins == [("smtp.gmail.com", "helpdesk.sender@gmail.com", 16)]


def test_send_cannot_be_pointed_at_another_recipient():
    import inspect

    assert list(inspect.signature(email_service.send).parameters) == ["subject", "text", "html"]


def test_wrong_gmail_password_explains_app_passwords(gmail):
    gmail()
    RecordingSMTP.fail_login = smtplib.SMTPAuthenticationError(535, b"5.7.8 Username and Password not accepted")
    result = email_service.send("s", "t", "<p>h</p>")
    assert result["status"] == "failed" and result["delivered"] is False
    assert "App Password" in result["error"] and "535" in result["error"]
    assert "abcdabcdabcdabcd" not in str(result)


def test_delivery_is_only_verified_after_a_real_success(gmail):
    gmail()
    assert email_service.status()["delivery"]["verified"] is False
    assert any("not been verified" in w for w in email_service.status()["warnings"])

    RecordingSMTP.fail_login = smtplib.SMTPAuthenticationError(535, b"bad")
    email_service.send("s", "t", "<p>h</p>")
    delivery = email_service.status()["delivery"]
    assert delivery["verified"] is False and "App Password" in delivery["last_error"]

    RecordingSMTP.fail_login = None
    email_service.send("s", "t", "<p>h</p>")
    delivery = email_service.status()["delivery"]
    assert delivery["verified"] is True and delivery["last_error"] is None


def test_changing_settings_resets_verification(gmail):
    gmail()
    email_service.send("s", "t", "<p>h</p>")
    assert email_service.status()["delivery"]["verified"] is True
    gmail(manager_email="someone.else@example.org")
    assert email_service.status()["delivery"]["verified"] is False


def test_test_email_endpoint_reports_real_result(workflow, gmail):
    gmail()
    body = workflow.client.post("/api/email/test", json={"confirm": True}).json()
    assert body["status"] == "sent" and body["delivered"] is True
    assert body["recipient"] == "m***@example.com"
    assert workflow.client.get("/api/settings").json()["email"]["delivery"]["verified"] is True


def test_batch_email_round_trip_over_smtp(workflow, gmail):
    """One consolidated SMTP email; its links approve/reject/ask, and the dashboard follows."""
    gmail()
    batch = workflow.submit("T-8", "T-1", "T-4")
    assert batch["status"] == "sent" and batch["emails"][0]["delivered"] is True
    assert len(RecordingSMTP.sent) == 1

    message = RecordingSMTP.sent[0]
    assert message["To"] == MANAGER
    raw = message.as_string()
    assert SECRET_CUSTOMER_EMAIL not in raw
    text = message.get_body(preferencelist=("plain",)).get_content()
    for ticket in ("T-8", "T-1", "T-4"):
        assert ticket in text
    assert batch["batch_id"] in message["Subject"]

    links = workflow.links(message)
    assert sorted(links) == ["T-1", "T-4", "T-8"]
    c = workflow.client
    assert c.post(links["T-8"]["approve"], data={"confirm": "yes", "note": "ok"}).status_code == 200
    assert c.post(links["T-1"]["reject"], data={"confirm": "yes"}).status_code == 200
    assert c.post(links["T-4"]["need_more_info"], data={"confirm": "yes", "note": "invoice?"}).status_code == 200
    assert c.post(links["T-8"]["approve"], data={"confirm": "yes"}).status_code == 409

    by_status = c.get("/api/dashboard").json()["approvals"]["by_status"]
    assert by_status == {"pending": 0, "info_requested": 1, "approved": 1, "rejected": 1}
    assert c.get("/api/control-center/batches").json()[0]["counts"] == by_status


def test_batch_with_failing_smtp_is_reported_as_failed(workflow, gmail):
    gmail()
    RecordingSMTP.fail_login = smtplib.SMTPAuthenticationError(534, b"Application-specific password required")
    batch = workflow.submit("T-8")
    assert batch["status"] == "email_failed"
    assert batch["emails"][0]["delivered"] is False
    assert "App Password" in batch["emails"][0]["error"]


# --- Eligibility ------------------------------------------------------------------

def add_stale_item(ticket_id="GONE-1"):
    """A queued item whose ticket is no longer in the data, as after an import (or a stale second server)."""
    with recommendations.QUEUE.lock:
        recommendations._new_item(ticket_id, "auto", ["urgent ticket"], None, False)
        recommendations.QUEUE.save()


def test_queue_hides_items_for_tickets_not_in_the_data(workflow):
    add_stale_item()
    ids = workflow.queue_ids()
    assert "GONE-1" not in ids and len(ids) == 8
    assert workflow.client.get("/api/dashboard").json()["queue"]["queued"] == 8


def test_top_n_never_counts_stale_items(workflow):
    add_stale_item()
    body = workflow.client.post("/api/control-center/preview", json={"mode": "top", "count": 20}).json()
    assert body["selected_count"] == 8
    assert "GONE-1" not in [i["ticket_id"] for i in body["items"]]


def test_manual_selection_of_stale_item_explains_why(workflow):
    add_stale_item()
    stale = next(i["item_id"] for i in recommendations.QUEUE.values() if i["ticket_id"] == "GONE-1")
    response = workflow.client.post("/api/control-center/preview", json={"mode": "manual", "item_ids": [stale]})
    assert response.status_code == 409
    assert "not in the current ticket data" in response.json()["detail"]


def test_restart_withdraws_stale_items(workflow):
    add_stale_item()
    recommendations.analyse_tickets(main.TICKETS)
    item = next(i for i in recommendations.QUEUE.values() if i["ticket_id"] == "GONE-1")
    assert item["status"] == "withdrawn"


def test_all_priorities_are_eligible(workflow):
    priorities = {i["ticket"]["priority"] for i in workflow.client.get("/api/control-center/queue").json()["items"]}
    assert priorities == {"urgent", "high", "normal", "low"}


# --- Single running backend per data folder -----------------------------------------

def test_second_backend_on_the_same_data_folder_is_refused(tmp_path):
    first = InstanceLock(tmp_path).acquire()
    with pytest.raises(StoreInUse, match="already running"):
        InstanceLock(tmp_path).acquire()
    first.release()
    InstanceLock(tmp_path).acquire().release()


def test_server_startup_fails_while_another_holds_the_lock():
    holder = InstanceLock(config.settings.store_dir).acquire()
    try:
        with pytest.raises(StoreInUse):
            with TestClient(main.app):
                pass
    finally:
        holder.release()
    with TestClient(main.app) as client:
        assert client.get("/health").status_code == 200


def test_email_dates_are_human_readable(workflow):
    import re

    workflow.submit("T-8")
    text = workflow.emails()[-1].get_body(preferencelist=("plain",)).get_content()
    assert not re.search(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", text), "raw ISO timestamp in the email"
    assert "Ticket opened: 30 Oct 2026, 03:00" in text
    assert re.search(r"Please respond by: \d{2} \w{3} \d{4}, \d{2}:\d{2}", text)
    assert re.search(r"expires on \d{2} \w{3} \d{4}, \d{2}:\d{2}", text)
