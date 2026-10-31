"""Allow-listed views of tickets and requests for the dashboard and manager emails.

Ticket rows may contain customer email addresses, assignee names and labels.
Only the fields listed here ever leave the backend through the new APIs and emails.
"""

import hashlib
import math
import re

TICKET_FIELDS = ("ticket_id", "created_at", "resolved_at", "category", "priority", "status")
TRUTHY = {"1", "true", "yes", "y"}


def parse_refund(ticket):
    """Return the refund amount, or None when the column is missing, blank or not a number."""
    raw = (ticket.get("refund_amount") or "").strip().replace("$", "").replace(",", "")
    if not raw:
        return None
    try:
        value = float(raw)
    except ValueError:
        return None
    return value if math.isfinite(value) and value >= 0 else None


def is_team_account_closing(ticket):
    """Only an explicit team_account_closing column counts. A 'team-account' label does not."""
    return (ticket.get("team_account_closing") or "").strip().lower() in TRUTHY


def ticket_brief(ticket):
    brief = {key: ticket.get(key, "") or "" for key in TICKET_FIELDS}
    brief["refund_amount"] = parse_refund(ticket)
    return brief


def request_view(request):
    """Approval request without anything outside the allow-list (older records may carry extra keys)."""
    ticket = request.get("ticket") or {}
    view = {
        key: request.get(key)
        for key in (
            "request_id",
            "ticket_id",
            "refund_amount",
            "team_account_closing",
            "escalated",
            "escalation_reasons",
            "status",
            "note",
            "source",
            "batch_id",
            "created_at",
            "updated_at",
            "decided_at",
            "emailed_at",
            "reminders_sent",
            "last_reminder_at",
        )
    }
    view["ticket"] = {key: ticket.get(key) for key in TICKET_FIELDS if key in ticket}
    view["employee_email"] = mask_email(request.get("employee_email") or "")
    view["employee_notifications"] = [
        {key: n.get(key) for key in ("decision", "recipient", "status", "reason", "error", "at")}
        for n in request.get("employee_notifications", [])
    ]
    view["history"] = [
        {key: h.get(key) for key in ("event", "status", "via", "note", "at")}
        for h in request.get("history", [])
    ]
    view["context"] = sanitize_context(request.get("context"))
    return view


def mask_email(address):
    if not address or "@" not in address:
        return ""
    name, domain = address.split("@", 1)
    return f"{name[:1]}***@{domain}"


STAFF_FIELDS = ("assigned_to", "labels", "subject", "description")


def ticket_staff_view(ticket):
    """Ticket for the Helpdesk Head's screens: adds assignee, labels, subject and description.

    Customer contact columns (for example customer_email) are never included.
    """
    view = ticket_brief(ticket)
    for key in STAFF_FIELDS:
        view[key] = ticket.get(key, "") or ""
    view["team_account_closing"] = is_team_account_closing(ticket)
    view["employee_email"] = mask_email(employee_email_for(ticket))
    # Additional helpdesk columns, kept from the import (customer contact columns are never kept).
    view["extra_fields"] = {name: _mask_emails_in(value) for name, value in (ticket.get("extra_fields") or {}).items()}
    view["data_warnings"] = list(ticket.get("data_warnings") or [])
    view["escalated"] = (ticket.get("escalated") or "") == "yes"
    view["original_status"] = ticket.get("original_status") or ""
    view["carried_over"] = (ticket.get("carried_over") or "") == "yes"
    return view


# --- what a manager may see ---------------------------------------------------------------

SENSITIVE_NAME_WORDS = ("email", "phone", "mobile", "customer", "requester", "contact", "address")
EMAIL_IN_TEXT = re.compile(r"[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+")


def _mask_emails_in(value):
    return EMAIL_IN_TEXT.sub(lambda m: mask_email(m.group(0)), value or "")


def manager_safe(name, value):
    """Never show customer contact data or any email address to the manager, even if a column was chosen by mistake."""
    key = (name or "").lower()
    if any(word in key for word in SENSITIVE_NAME_WORDS):
        return False
    return not EMAIL_IN_TEXT.search(value or "")


def _dedupe(items):
    return list(dict.fromkeys(i for i in items if i))


def approval_context(ticket, manager_fields=()):
    """Snapshot of the ticket for the manager, saved with the approval request. Nothing is invented."""
    extras = {name: value for name, value in (ticket.get("extra_fields") or {}).items() if manager_safe(name, value)}
    shown = {name: extras[name] for name in manager_fields if name in extras}
    status = (ticket.get("status") or "").lower()
    warnings = list(ticket.get("data_warnings") or [])
    missing = []
    if not (ticket.get("assigned_to") or "").strip():
        missing.append("Assigned employee missing")
    if parse_refund(ticket) is None and any(w.startswith("Refund amount") for w in warnings):
        missing.append("Refund amount unavailable")
    if status in ("resolved", "closed") and not (ticket.get("resolved_at") or "").strip():
        missing.append("Resolved date missing")
    hidden = len(extras) - len(shown)
    return {
        "details": {
            "priority": ticket.get("priority") or "",
            "status": ticket.get("status") or "",
            "original_status": ticket.get("original_status") or "",
            "category": ticket.get("category") or "",
            "assigned_to": ticket.get("assigned_to") or "",
            "created_at": ticket.get("created_at") or "",
            "resolved_at": ticket.get("resolved_at") or "",
            "labels": _mask_emails_in(ticket.get("labels") or ""),
            "escalated": (ticket.get("escalated") or "") == "yes",
            "refund_amount": parse_refund(ticket),
            "not_in_latest_export": (ticket.get("carried_over") or "") == "yes",
        },
        "manager_fields": shown,
        "additional_fields": extras,
        "warnings": _dedupe(missing + warnings),
        "notes": [f"Additional helpdesk information available ({hidden} field(s)) on the approval page"] if hidden > 0 else [],
    }


def sanitize_context(context):
    """Re-apply the manager privacy rules to a stored snapshot before it is shown or emailed."""
    if not context:
        return None
    details = dict(context.get("details") or {})
    if details.get("labels"):
        details["labels"] = _mask_emails_in(details["labels"])
    return {
        "details": details,
        "manager_fields": {k: v for k, v in (context.get("manager_fields") or {}).items() if manager_safe(k, v)},
        "additional_fields": {k: v for k, v in (context.get("additional_fields") or {}).items() if manager_safe(k, v)},
        "warnings": list(context.get("warnings") or []),
        "notes": list(context.get("notes") or []),
    }


CUSTOMER_KEYS = {"email", "customer", "customer_email", "customer_name", "requester", "requester_email", "contact_email", "phone", "customer_phone"}


def employee_email_for(ticket):
    """The ticket's employee (raised-by) address, or "" if missing or equal to any customer contact value."""
    address = (ticket.get("raised_by_email") or "").strip()
    if not address:
        return ""
    customer_values = {
        str(value).strip().lower()
        for key, value in ticket.items()
        if key != "raised_by_email" and isinstance(value, str) and (key.lower() in CUSTOMER_KEYS or "email" in key.lower())
    }
    if address.lower() in customer_values:
        return ""
    # Imported tickets keep only one-way fingerprints of their customer contact values.
    digest = hashlib.sha256(address.lower().encode("utf-8")).hexdigest()[:24]
    return "" if digest in (ticket.get("customer_fingerprints") or []) else address
