"""Employee decision notices and the one-step manager action."""

import re
from dataclasses import replace

import pytest
from conftest import SECRET_CUSTOMER_EMAIL

from app import config, email_service, main, notifications

EMPLOYEE = "agent.one@company.test"


def give_employee(ticket_id, address):
    for ticket in main.TICKETS:
        if ticket["ticket_id"] == ticket_id:
            ticket["raised_by_email"] = address


def batch_email(workflow):
    return [m for m in workflow.emails() if m["Subject"].startswith("Approval needed")][-1]


def decide(workflow, ticket, action, note=""):
    links = workflow.links(batch_email(workflow))
    return workflow.client.post(links[ticket][action], data={"confirm": "yes", "note": note})


def request_for(workflow, ticket):
    return workflow.client.get("/api/approvals", params={"ticket_id": ticket}).json()[0]


def employee_emails(workflow):
    return [m for m in workflow.emails() if m["To"] != email_service.UNSET_RECIPIENT and not m["Subject"].startswith("Approval needed")]


@pytest.mark.parametrize("action,decision,subject,phrase", [
    ("approve", "approved", "Ticket T-8: approved", "Next steps: go ahead"),
    ("reject", "rejected", "Ticket T-8: rejected", "Next steps: do not carry out"),
    ("need_more_info", "info_requested", "Ticket T-8: more information needed", "How to respond: send the requested information to the Helpdesk Head"),
])
def test_employee_is_told_about_each_decision(workflow, action, decision, subject, phrase):
    give_employee("T-8", EMPLOYEE)
    workflow.submit("T-8")
    assert decide(workflow, "T-8", action, "Checked the invoice").status_code == 200

    sent = employee_emails(workflow)
    assert len(sent) == 1
    message = sent[0]
    assert message["To"] == EMPLOYEE
    assert message["Subject"] == subject
    text = message.get_body(preferencelist=("plain",)).get_content()
    assert phrase in text
    assert "Checked the invoice" in text
    assert "Ticket: T-8" in text
    assert re.search(r"Date and time: \d{2} \w{3} \d{4}, \d{2}:\d{2}", text)

    request = request_for(workflow, "T-8")
    assert request["status"] == decision
    assert request["employee_notifications"][0]["status"] == "saved_to_outbox"
    assert request["employee_notifications"][0]["recipient"] == "a***@company.test"


def test_employee_email_has_no_links_tokens_or_customer_data(workflow):
    give_employee("T-8", EMPLOYEE)
    workflow.submit("T-8")
    decide(workflow, "T-8", "approve")
    raw = employee_emails(workflow)[0].as_string()
    assert "/act/" not in raw and "http" not in raw.split("\n\n", 1)[1].lower().replace("http-equiv", "")
    assert SECRET_CUSTOMER_EMAIL not in raw
    assert config.settings.manager_email not in raw or not config.settings.manager_email


def test_missing_employee_email_is_skipped_and_explained(workflow):
    workflow.submit("T-8")
    decide(workflow, "T-8", "reject")
    assert employee_emails(workflow) == []
    note = request_for(workflow, "T-8")["employee_notifications"][0]
    assert note["status"] == "skipped"
    assert "no employee email for this ticket" in note["reason"]
    events = workflow.client.get("/api/activity", params={"event": "employee_notification_skipped"}).json()
    assert len(events) == 1


def test_customer_address_is_never_used_as_employee(workflow):
    give_employee("T-8", SECRET_CUSTOMER_EMAIL)  # same as the row's customer_email
    workflow.submit("T-8")
    decide(workflow, "T-8", "approve")
    assert employee_emails(workflow) == []
    assert request_for(workflow, "T-8")["employee_notifications"][0]["status"] == "skipped"


@pytest.mark.parametrize("address,reason", [("not-an-email", "not a valid address"), ("agent@other.test", "not in EMPLOYEE_EMAIL_DOMAINS")])
def test_invalid_or_disallowed_address_is_skipped(workflow, monkeypatch, address, reason):
    monkeypatch.setattr(config, "settings", replace(config.settings, employee_email_domains=("company.test",)))
    give_employee("T-8", address)
    workflow.submit("T-8")
    decide(workflow, "T-8", "approve")
    assert employee_emails(workflow) == []
    note = request_for(workflow, "T-8")["employee_notifications"]
    assert note[0]["status"] == "skipped" and reason in note[0]["reason"]


def test_notifications_can_be_turned_off(workflow, monkeypatch):
    monkeypatch.setattr(config, "settings", replace(config.settings, employee_notifications=False))
    give_employee("T-8", EMPLOYEE)
    workflow.submit("T-8")
    decide(workflow, "T-8", "approve")
    assert employee_emails(workflow) == []
    assert "turned off" in request_for(workflow, "T-8")["employee_notifications"][0]["reason"]


def test_failed_employee_email_is_recorded_as_failed(workflow, monkeypatch):
    give_employee("T-8", EMPLOYEE)
    workflow.submit("T-8")
    real = email_service.send_to_employee
    monkeypatch.setattr(email_service, "send_to_employee", lambda *a: {**real(*a), "status": "failed", "delivered": False, "error": "SMTP down"})
    decide(workflow, "T-8", "approve")
    note = request_for(workflow, "T-8")["employee_notifications"][0]
    assert (note["status"], note["error"]) == ("failed", "SMTP down")
    assert workflow.client.get("/api/activity", params={"event": "employee_notification_failed"}).json()


def test_replayed_link_sends_no_second_notification(workflow):
    give_employee("T-8", EMPLOYEE)
    workflow.submit("T-8")
    assert decide(workflow, "T-8", "approve").status_code == 200
    assert decide(workflow, "T-8", "approve").status_code == 409
    assert decide(workflow, "T-8", "reject").status_code == 409
    assert len(employee_emails(workflow)) == 1
    assert len(request_for(workflow, "T-8")["employee_notifications"]) == 1


def test_one_tickets_link_cannot_decide_another(workflow):
    give_employee("T-8", EMPLOYEE)
    workflow.submit("T-8", "T-1")
    decide(workflow, "T-8", "approve")
    assert request_for(workflow, "T-1")["status"] == "pending"
    assert request_for(workflow, "T-1")["employee_notifications"] == []


def test_apis_show_only_masked_employee_address(workflow):
    give_employee("T-8", EMPLOYEE)
    workflow.submit("T-8")
    for path in ("/api/approvals", "/api/tickets", "/api/tickets/T-8", "/api/control-center/batches/BATCH-1", "/approval-requests"):
        assert EMPLOYEE not in workflow.client.get(path).text, path
    assert workflow.client.get("/api/tickets/T-8").json()["employee_email"] == "a***@company.test"


def test_manager_json_action_also_notifies(workflow):
    give_employee("T-8", EMPLOYEE)
    workflow.submit("T-8")
    token = workflow.links(batch_email(workflow))["T-8"]["reject"].rsplit("/", 1)[1]
    body = workflow.client.post(f"/api/manager/actions/{token}", json={"confirm": True, "note": "Over budget"}).json()
    assert body["state"] == "done"
    assert employee_emails(workflow)[0]["Subject"] == "Ticket T-8: rejected"
    assert request_for(workflow, "T-8")["note"] == "Over budget"


# --- import mapping -------------------------------------------------------------------

CSV = (
    "id,created,status,priority,customer_email,raised_by_email\n"
    "T-901,2026-10-30 10:00,open,P1,cust@example.org,agent@company.test\n"
    "T-902,2026-10-30 10:00,open,P1,cust@example.org,cust@example.org\n"
    "T-903,2026-10-30 10:00,open,P1,cust@example.org,not-an-email\n"
    "T-904,2026-10-30 10:00,open,P1,cust@example.org,\n"
)


def test_import_maps_employee_email_and_never_customer_email(workflow):
    body = workflow.client.post("/api/imports/preview", json={"content": CSV}).json()
    assert body["mapping"]["raised_by_email"] == "raised_by_email"
    assert body["excluded_sensitive_columns"] == ["customer_email"]
    assert [r["raised_by_email"] for r in body["normalized_sample"]] == ["a***@company.test", "", "", ""]
    # Employee-email problems are reported per row (line 3 = T-902, line 4 = T-903).
    row_warnings = {(w["line"], w["message"]) for w in body["row_warnings"]}
    assert (3, "Employee email equals a customer email; dropped so customers are never notified") in row_warnings
    assert (4, "Employee email is not a valid address; dropped (no decision notice)") in row_warnings
    assert "cust@example.org" not in str(body)


def test_requester_or_customer_columns_are_not_offered_as_employee_email(workflow):
    content = "id,created,status,priority,requester_email,email\nA-1,2026-10-30 10:00,open,P1,r@example.org,e@example.org\n"
    body = workflow.client.post("/api/imports/preview", json={"content": content}).json()
    assert body["mapping"]["raised_by_email"] is None
    assert sorted(body["excluded_sensitive_columns"]) == ["email", "requester_email"]


def test_imported_employee_email_reaches_the_notification(workflow):
    mapping = workflow.client.post("/api/imports/preview", json={"content": CSV}).json()["mapping"]
    assert workflow.client.post("/api/imports", json={"content": CSV, "mapping": mapping, "acknowledge_removals": True}).status_code == 201
    workflow.submit("T-901", "T-902")
    decide(workflow, "T-901", "approve")
    decide(workflow, "T-902", "approve")
    sent = employee_emails(workflow)
    assert [m["To"] for m in sent] == ["agent@company.test"]
    assert request_for(workflow, "T-902")["employee_notifications"][0]["status"] == "skipped"
