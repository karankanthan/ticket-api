from datetime import timedelta

from conftest import NOW

from app import automation, main, sla
from app.approvals import REQUESTS


def run_at(workflow, hours):
    workflow.set_time(NOW + timedelta(hours=hours))
    return automation.run_once(main.TICKETS)


def reminder_count(workflow):
    return sum(1 for m in workflow.emails() if m["Subject"].startswith("Reminder"))


def test_reminders_follow_schedule_and_stop_at_three(workflow):
    workflow.submit("T-1", "T-3")
    expected = {1: 0, 2: 1, 2.5: 1, 6: 2, 23: 2, 24: 3, 100: 3}
    for hours, count in expected.items():
        run_at(workflow, hours)
        assert reminder_count(workflow) == count, f"at {hours}h"
    subjects = [m["Subject"] for m in workflow.emails()]
    assert subjects[-1].startswith("Reminder 3 of 3")


def test_one_reminder_email_per_batch(workflow):
    workflow.submit("T-1", "T-3")
    run_at(workflow, 2)
    reminder = workflow.emails()[-1]
    assert sorted(workflow.links(reminder)) == ["T-1", "T-3"]


def test_late_scheduler_sends_one_catch_up_reminder(workflow):
    workflow.submit("T-1")
    run_at(workflow, 30)
    assert reminder_count(workflow) == 1
    assert next(iter(REQUESTS.values()))["reminders_sent"] == 3
    run_at(workflow, 31)
    assert reminder_count(workflow) == 1


def test_reminder_links_replace_old_links(workflow):
    workflow.submit("T-1")
    old = workflow.links(workflow.emails()[0])["T-1"]["approve"]
    run_at(workflow, 2)
    new = workflow.links(workflow.emails()[-1])["T-1"]["approve"]
    assert workflow.client.get(old).status_code == 409
    assert workflow.client.post(new, data={"confirm": "yes"}).status_code == 200


def test_failed_reminder_keeps_old_links_and_retries(workflow, monkeypatch):
    from app import email_service

    workflow.submit("T-1")
    old = workflow.links(workflow.emails()[0])["T-1"]["approve"]

    real_send = email_service.send
    monkeypatch.setattr(email_service, "send", lambda *a, **k: {**real_send(*a, **k), "status": "failed", "error": "down"})
    run_at(workflow, 2)
    assert next(iter(REQUESTS.values()))["reminders_sent"] == 0
    assert workflow.client.get(old).status_code == 200

    monkeypatch.setattr(email_service, "send", real_send)
    run_at(workflow, 2.2)
    assert next(iter(REQUESTS.values()))["reminders_sent"] == 1


def test_no_reminders_after_decision_or_info_request(workflow):
    workflow.submit("T-1", "T-3")
    links = workflow.links(workflow.emails()[0])
    workflow.client.post(links["T-1"]["approve"], data={"confirm": "yes"})
    workflow.client.post(links["T-3"]["need_more_info"], data={"confirm": "yes", "note": "Receipt?"})
    run_at(workflow, 25)
    assert reminder_count(workflow) == 0


def test_overdue_requests_are_reported_not_decided(workflow):
    workflow.submit("T-1", "T-3")  # urgent target 4h, normal 24h
    result = run_at(workflow, 5)
    assert len(result["newly_overdue_requests"]) == 1
    assert all(r["status"] == "pending" for r in REQUESTS.values())

    again = run_at(workflow, 6)
    assert again["newly_overdue_requests"] == []
    overdue_events = workflow.client.get("/api/activity", params={"event": "approval_overdue"}).json()
    assert len(overdue_events) == 1


def test_sla_breach_events_recorded_once(workflow):
    first = run_at(workflow, 0)
    assert "T-8" in first["newly_breached_tickets"]
    assert run_at(workflow, 1)["newly_breached_tickets"] == []


def test_automation_endpoints(workflow):
    workflow.submit("T-1")
    workflow.set_time(NOW + timedelta(hours=3))
    assert workflow.client.get("/api/automation/status").json()["reminders_due"] == 1
    workflow.client.post("/api/automation/run")
    assert workflow.client.get("/api/automation/status").json()["reminders_due"] == 0


def test_sla_does_not_invent_dates():
    resolved_without_date = {"priority": "urgent", "status": "resolved", "created_at": "2026-10-30 09:00", "resolved_at": ""}
    bad_created = {"priority": "high", "status": "open", "created_at": "yesterday"}
    unknown_priority = {"priority": "p0", "status": "open", "created_at": "2026-10-30 09:00"}
    for ticket in (resolved_without_date, bad_created, unknown_priority):
        result = sla.ticket_sla(ticket, NOW)
        assert result["state"] == "unknown"
        assert result["remaining_hours"] is None


def test_sla_for_resolved_ticket_with_dates():
    met = {"priority": "high", "status": "closed", "created_at": "2026-10-30 01:00", "resolved_at": "2026-10-30 08:00"}
    missed = {**met, "resolved_at": "2026-10-30 10:00"}
    assert sla.ticket_sla(met, NOW)["state"] == "met"
    assert sla.ticket_sla(missed, NOW)["state"] == "missed"


def test_at_risk_when_little_time_left():
    ticket = {"priority": "urgent", "status": "open", "created_at": "2026-10-30 09:00"}  # 1h left of 4h
    assert sla.ticket_sla(ticket, NOW)["state"] == "at_risk"
