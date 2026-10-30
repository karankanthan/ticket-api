"""Ticket SLA and manager response tracking.

Ticket SLA and manager approval response time are measured separately.
Nothing here invents a date: when a needed date is missing or invalid, the state is "unknown".
"""

from datetime import datetime, timedelta

from . import clock, config

CSV_FORMAT = "%Y-%m-%d %H:%M"
UNRESOLVED = {"open", "in_progress"}
DONE = {"resolved", "closed"}


def parse_csv_time(value):
    """CSV times have no zone; they are treated as this computer's local time."""
    value = (value or "").strip()
    if not value:
        return None
    try:
        return datetime.strptime(value, CSV_FORMAT).astimezone()
    except ValueError:
        return None


def parse_iso(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def ticket_sla(ticket, now=None):
    now = now or clock.now()
    settings = config.settings
    priority = (ticket.get("priority") or "").strip().lower()
    status = (ticket.get("status") or "").strip().lower()
    target = settings.ticket_sla_hours.get(priority)
    created = parse_csv_time(ticket.get("created_at"))

    result = {
        "target_hours": target,
        "due_at": None,
        "elapsed_hours": None,
        "remaining_hours": None,
        "state": "unknown",
        "reason": None,
    }
    if target is None:
        result["reason"] = f"no SLA target for priority {priority or '(blank)'}"
        return result
    if created is None:
        result["reason"] = "created date missing or invalid"
        return result

    due = created + timedelta(hours=target)
    result["due_at"] = due.isoformat(timespec="minutes")

    if status in UNRESOLVED:
        elapsed = (now - created).total_seconds() / 3600
        remaining = target - elapsed
        result["elapsed_hours"] = round(elapsed, 2)
        result["remaining_hours"] = round(remaining, 2)
        if remaining < 0:
            result["state"] = "breached"
        elif remaining <= target * settings.sla_at_risk_fraction:
            result["state"] = "at_risk"
        else:
            result["state"] = "on_track"
        return result

    if status in DONE:
        resolved = parse_csv_time(ticket.get("resolved_at"))
        if resolved is None:
            result["reason"] = "resolved date not available"
            return result
        elapsed = (resolved - created).total_seconds() / 3600
        result["elapsed_hours"] = round(elapsed, 2)
        result["state"] = "met" if elapsed <= target else "missed"
        return result

    result["reason"] = f"unrecognised status {status or '(blank)'}"
    return result


def approval_response(request, now=None):
    """How long the manager has had an emailed request, against the response target."""
    now = now or clock.now()
    sent = parse_iso(request.get("emailed_at"))
    priority = ((request.get("ticket") or {}).get("priority") or "").lower()
    target = config.settings.approval_response_hours.get(
        priority, config.settings.approval_response_hours["normal"]
    )
    if sent is None:
        return {"target_hours": target, "due_at": None, "waiting_hours": None, "overdue": False}

    waiting = (now - sent).total_seconds() / 3600
    return {
        "target_hours": target,
        "due_at": (sent + timedelta(hours=target)).isoformat(timespec="minutes"),
        "waiting_hours": round(waiting, 2),
        "overdue": request.get("status") == "pending" and waiting > target,
    }
