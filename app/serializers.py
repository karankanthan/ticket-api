"""Allow-listed views of tickets and requests for the dashboard and manager emails.

Ticket rows may contain customer email addresses, assignee names and labels.
Only the fields listed here ever leave the backend through the new APIs and emails.
"""

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
    return value if value >= 0 else None


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
    view["history"] = [
        {key: h.get(key) for key in ("event", "status", "via", "note", "at")}
        for h in request.get("history", [])
    ]
    return view


def mask_email(address):
    if not address or "@" not in address:
        return ""
    name, domain = address.split("@", 1)
    return f"{name[:1]}***@{domain}"
