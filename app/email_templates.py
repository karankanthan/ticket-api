"""Manager email content. Every value is HTML-escaped; only allow-listed ticket fields are used."""

from datetime import datetime
from html import escape

PRIORITY_LABELS = {"urgent": "P1 Urgent", "high": "P2 High", "normal": "P3 Normal", "low": "P4 Low"}
PRIORITY_COLOURS = {"urgent": "#b42318", "high": "#b54708", "normal": "#175cd3", "low": "#475467"}
SLA_LABELS = {
    "breached": "SLA breached",
    "at_risk": "SLA at risk",
    "on_track": "Within SLA",
    "met": "SLA met",
    "missed": "SLA missed",
    "unknown": "SLA not available",
}

FONT = "font-family:Segoe UI,Arial,Helvetica,sans-serif"


def priority_label(priority):
    return PRIORITY_LABELS.get(priority, priority or "Unknown priority")


def readable(value, fallback="Not set"):
    """'2026-10-31T03:11+05:30' or '2026-10-05 13:05' -> '31 Oct 2026, 03:11'."""
    if not value:
        return fallback
    try:
        return datetime.fromisoformat(value).strftime("%d %b %Y, %H:%M")
    except ValueError:
        return value


def money(amount):
    return f"${amount:,.2f}" if amount is not None else "Not provided"


def sla_text(sla):
    label = SLA_LABELS.get(sla["state"], sla["state"])
    if sla["state"] == "breached" and sla["remaining_hours"] is not None:
        return f"{label} by {abs(sla['remaining_hours']):.1f} h"
    if sla["state"] in ("at_risk", "on_track") and sla["remaining_hours"] is not None:
        return f"{label} ({sla['remaining_hours']:.1f} h left)"
    return label


def _button(url, label, colour):
    return (
        f'<a href="{escape(url, quote=True)}" style="display:inline-block;padding:12px 20px;margin:6px 8px 0 0;'
        f'background:{colour};color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;{FONT}">'
        f"{escape(label)}</a>"
    )


STATUS_NAMES = {"open": "Open", "in_progress": "In progress", "resolved": "Resolved", "closed": "Closed"}


def context_rows(item):
    """Decision-relevant details: assignee, helpdesk status, escalation, resolved date and chosen extra fields."""
    context = item.get("context") or {}
    details = context.get("details") or {}
    rows = []
    if details:
        rows.append(("Assigned to", details.get("assigned_to") or "Not provided"))
        if details.get("original_status"):
            rows.append(("Helpdesk status", f"{details['original_status']} (treated as {STATUS_NAMES.get(details.get('status'), details.get('status'))})"))
        if details.get("escalated"):
            rows.append(("Escalated", "Yes (helpdesk escalation)"))
        if details.get("resolved_at"):
            rows.append(("Resolved", readable(details["resolved_at"])))
    rows.extend((name, value) for name, value in (context.get("manager_fields") or {}).items())
    return rows


def context_notes(item):
    context = item.get("context") or {}
    return list(context.get("warnings") or []) + list(context.get("notes") or [])


def _item_html(item):
    ticket = item["ticket"]
    priority = ticket.get("priority", "")
    reasons = ", ".join(item["reasons"]) or "Manual request"
    return f"""
<tr><td style="padding:16px;border:1px solid #eaecf0;border-radius:8px;background:#ffffff">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="{FONT};font-size:14px;color:#101828">
    <tr><td style="font-size:16px;font-weight:600;padding-bottom:6px">
      {escape(ticket.get("ticket_id", ""))}
      <span style="display:inline-block;margin-left:8px;padding:2px 8px;border-radius:10px;font-size:12px;color:#ffffff;background:{PRIORITY_COLOURS.get(priority, "#475467")}">{escape(priority_label(priority))}</span>
    </td></tr>
    <tr><td style="color:#475467;padding-bottom:4px">Request {escape(item["request_id"])} &middot; {escape(ticket.get("category", "") or "Uncategorised")} &middot; Ticket status: {escape((ticket.get("status") or "").replace("_", " "))}</td></tr>
    <tr><td style="padding-bottom:4px"><strong>Why approval is needed:</strong> {escape(reasons)}</td></tr>
    <tr><td style="padding-bottom:4px"><strong>Refund amount:</strong> {escape(money(item["refund_amount"]))}</td></tr>
    {"".join(f'<tr><td style="padding-bottom:4px"><strong>{escape(label)}:</strong> {escape(value)}</td></tr>' for label, value in context_rows(item))}
    {_notes_html(context_notes(item))}
    <tr><td style="padding-bottom:4px"><strong>Ticket opened:</strong> {escape(readable(ticket.get("created_at"), "Not available"))} &middot; <strong>{escape(sla_text(item["sla"]))}</strong></td></tr>
    <tr><td style="padding-bottom:8px"><strong>Please respond by:</strong> {escape(readable(item["response_due"]))}</td></tr>
    <tr><td>
      {_button(item["links"]["approve"], "Approve", "#067647")}
      {_button(item["links"]["reject"], "Reject", "#b42318")}
      {_button(item["links"]["need_more_info"], "Request more information", "#344054")}
    </td></tr>
  </table>
</td></tr>
<tr><td style="height:12px"></td></tr>"""


def _notes_html(notes):
    if not notes:
        return ""
    items = "".join(f"<li>{escape(n)}</li>" for n in notes)
    return (
        '<tr><td style="padding:8px 12px;margin:4px 0;background:#fffaeb;border-left:3px solid #f79009;color:#93370d">'
        f'<strong>Please note:</strong><ul style="margin:4px 0 0;padding-left:18px">{items}</ul></td></tr>'
    )


def _item_text(item):
    ticket = item["ticket"]
    extra = [f"  {label}: {value}" for label, value in context_rows(item)]
    notes = [f"  Please note: {n}" for n in context_notes(item)]
    return "\n".join([
        f"{ticket.get('ticket_id')} - {priority_label(ticket.get('priority'))} - {ticket.get('category') or 'Uncategorised'} (request {item['request_id']})",
        f"  Why approval is needed: {', '.join(item['reasons']) or 'Manual request'}",
        f"  Refund amount: {money(item['refund_amount'])}",
        *extra,
        *notes,
        f"  Ticket opened: {readable(ticket.get('created_at'), 'Not available')} - {sla_text(item['sla'])}",
        f"  Please respond by: {readable(item['response_due'])}",
        f"  Approve: {item['links']['approve']}",
        f"  Reject: {item['links']['reject']}",
        f"  Request more information: {item['links']['need_more_info']}",
    ])


def _wrap(title, intro_html, items_html, footer_html):
    return f"""<!doctype html>
<html><body style="margin:0;padding:0;background:#f2f4f7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f7;padding:24px 0">
<tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;{FONT};color:#101828">
  <tr><td style="padding:20px 24px;background:#101828;color:#ffffff;border-radius:8px 8px 0 0;font-size:18px;font-weight:600">{escape(title)}</td></tr>
  <tr><td style="padding:20px 24px;background:#f9fafb;font-size:14px;line-height:1.5">{intro_html}</td></tr>
  <tr><td style="padding:0 24px 8px;background:#f9fafb">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">{items_html}</table>
  </td></tr>
  <tr><td style="padding:16px 24px;background:#f9fafb;border-radius:0 0 8px 8px;font-size:12px;color:#475467;line-height:1.5">{footer_html}</td></tr>
</table>
</td></tr></table>
</body></html>"""


FOOTER_TEXT = (
    "Each button opens a confirmation page; nothing changes until you confirm there. "
    "Each link works once and expires on {expires}. Do not forward this email: anyone with these links can record a decision."
)


def batch_email(batch_id, items, expires_at, greeting_name="", note=""):
    count = len(items)
    noun = "ticket" if count == 1 else "tickets"
    subject = f"Approval needed: {count} {noun} ({batch_id})"
    greeting = f"Hello {greeting_name}," if greeting_name else "Hello,"
    intro = (
        f"<p style=\"margin:0 0 8px\">{escape(greeting)}</p>"
        f"<p style=\"margin:0 0 8px\">The helpdesk needs your decision on <strong>{count} {noun}</strong> "
        f"in batch {escape(batch_id)}. You can decide each ticket separately. You do not need to sign in.</p>"
        f"<p style=\"margin:0 0 8px;color:#475467\">Each button opens a short confirmation page: add a comment if you like and press the button there once. Opening a link alone changes nothing.</p>"
    )
    if note:
        intro += f"<p style=\"margin:0;padding:8px 12px;background:#ffffff;border-left:3px solid #175cd3\"><strong>Note from the Helpdesk Head:</strong> {escape(note)}</p>"
    footer = escape(FOOTER_TEXT.format(expires=readable(expires_at)))
    html = _wrap(f"Approval needed - {batch_id}", intro, "".join(_item_html(i) for i in items), footer)
    text = "\n\n".join(
        [greeting, f"The helpdesk needs your decision on {count} {noun} in batch {batch_id}. You do not need to sign in.", "Each button opens a short confirmation page: add a comment if you like and press the button there once. Opening a link alone changes nothing."]
        + ([f"Note from the Helpdesk Head: {note}"] if note else [])
        + [_item_text(i) for i in items]
        + [FOOTER_TEXT.format(expires=readable(expires_at))]
    )
    return subject, text, html


def reminder_email(batch_id, reminder_number, max_reminders, items, expires_at, greeting_name=""):
    count = len(items)
    noun = "ticket is" if count == 1 else "tickets are"
    subject = f"Reminder {reminder_number} of {max_reminders}: {count} approval{'s' if count != 1 else ''} still pending ({batch_id})"
    greeting = f"Hello {greeting_name}," if greeting_name else "Hello,"
    intro = (
        f"<p style=\"margin:0 0 8px\">{escape(greeting)}</p>"
        f"<p style=\"margin:0\">{count} {noun} from batch {escape(batch_id)} still waiting for your decision. "
        "The links below replace the links in earlier emails for these tickets.</p>"
    )
    footer = escape(FOOTER_TEXT.format(expires=readable(expires_at)))
    html = _wrap(f"Reminder - {batch_id}", intro, "".join(_item_html(i) for i in items), footer)
    text = "\n\n".join(
        [greeting, f"{count} {noun} from batch {batch_id} still waiting for your decision. These links replace earlier ones."]
        + [_item_text(i) for i in items]
        + [FOOTER_TEXT.format(expires=readable(expires_at))]
    )
    return subject, text, html


def test_email():
    subject = "Ticket API email test"
    text = "This is a test message from the ticket API. If you received it, email delivery is working."
    html = _wrap(subject, f"<p style=\"margin:0\">{escape(text)}</p>", "", "No action is needed.")
    return subject, text, html


EMPLOYEE_TEXT = {
    "approved": (
        "Approved",
        "The manager approved the request for ticket {ticket}.",
        "Next steps: go ahead with the approved action for this ticket (for example the refund) and update the customer.",
    ),
    "rejected": (
        "Rejected",
        "The manager rejected the request for ticket {ticket}.",
        "Next steps: do not carry out the requested action. Let the customer know and, if needed, discuss alternatives with the Helpdesk Head.",
    ),
    "info_requested": (
        "More information requested",
        "The manager needs more information before deciding on ticket {ticket}.",
        "How to respond: send the requested information to the Helpdesk Head, who will add it in TicketFlow and send the request back to the manager. Do not reply to the manager directly.",
    ),
}


def employee_decision_email(request):
    """Notice to the employee who raised the ticket. Contains no action links or tokens."""
    title, summary, next_steps = EMPLOYEE_TEXT[request["status"]]
    ticket = request["ticket_id"]
    comment = request.get("note") or ""
    decided = readable(request.get("decided_at") or request.get("updated_at"), "Not available")
    subject = f"Ticket {ticket}: {title.lower()}" if request["status"] != "info_requested" else f"Ticket {ticket}: more information needed"
    comment_label = "Information requested" if request["status"] == "info_requested" else "Manager comment"
    rows = [
        ("Ticket", ticket),
        ("Decision", title),
        (comment_label, comment or "No comment"),
        ("Date and time", decided),
    ]
    cells = "".join(
        f'<tr><td style="padding:4px 12px 4px 0;color:#475467;vertical-align:top">{escape(k)}</td><td style="padding:4px 0">{escape(v)}</td></tr>'
        for k, v in rows
    )
    intro = f'<p style="margin:0 0 12px">{escape(summary.format(ticket=ticket))}</p><table role="presentation" style="font-size:14px">{cells}</table>'
    html = _wrap(f"Ticket {ticket}: {title}", intro, "", escape(next_steps))
    text = "\n".join(
        [summary.format(ticket=ticket), ""]
        + [f"{k}: {v}" for k, v in rows]
        + ["", next_steps, "", "This is an automatic message from TicketFlow."]
    )
    return subject, text, html
