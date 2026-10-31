"""Pages the manager reaches from email links. No login: the single-use link is the credential.

GET only shows a confirmation page, because email scanners and link previews open links
automatically. The decision is recorded only by the POST from that page.
"""

from html import escape
from typing import Optional
from urllib.parse import parse_qs

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field

from . import approvals, notifications, tokens
from .approvals import REQUESTS
from .batches import WORKFLOW_LOCK
from .email_templates import FONT, money, priority_label, readable
from .serializers import sanitize_context

router = APIRouter()

NOTE_MAX = 1000
ACTION_TEXT = {
    "approve": ("Approve", "#067647", "approve this request"),
    "reject": ("Reject", "#b42318", "reject this request"),
    "need_more_info": ("Request more information", "#344054", "ask the helpdesk for more information"),
}
STATUS_TEXT = {
    "pending": "waiting for your decision",
    "info_requested": "waiting for more information from the helpdesk",
    "approved": "approved",
    "rejected": "rejected",
}
HEADERS = {
    "Cache-Control": "no-store",
    "Pragma": "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": (
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; "
        "base-uri 'none'; frame-ancestors 'none'"
    ),
}


def _page(title, body, status_code=200):
    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>{escape(title)}</title></head>
<body style="margin:0;background:#f2f4f7;{FONT};color:#101828">
<main style="max-width:560px;margin:32px auto;padding:0 16px">
<div style="background:#ffffff;border:1px solid #eaecf0;border-radius:10px;padding:24px">
<h1 style="font-size:20px;margin:0 0 16px">{escape(title)}</h1>
{body}
</div></main></body></html>"""
    return HTMLResponse(html, status_code=status_code, headers=HEADERS)


def _summary(request):
    ticket = request.get("ticket") or {}
    reasons = ", ".join(request.get("escalation_reasons") or []) or "Manual request"
    rows = [
        ("Ticket", ticket.get("ticket_id") or request["ticket_id"]),
        ("Request", request["request_id"]),
        ("Priority", priority_label(ticket.get("priority"))),
        ("Category", ticket.get("category") or "Uncategorised"),
        ("Why approval is needed", reasons),
        ("Refund amount", money(request.get("refund_amount"))),
        ("Current status", STATUS_TEXT.get(request["status"], request["status"])),
    ]
    context = sanitize_context(request.get("context")) or {}
    details = context.get("details") or {}
    if details:
        rows.append(("Assigned to", details.get("assigned_to") or "Not provided"))
        if details.get("original_status"):
            rows.append(("Helpdesk status", details["original_status"]))
        if details.get("escalated"):
            rows.append(("Escalated", "Yes"))
        if details.get("resolved_at"):
            rows.append(("Resolved", readable(details["resolved_at"])))
    rows.extend((f"{name} (helpdesk)", value) for name, value in (context.get("additional_fields") or {}).items())
    warnings = list(context.get("warnings") or [])
    cells = "".join(
        f'<tr><td style="padding:4px 12px 4px 0;color:#475467;vertical-align:top">{escape(k)}</td>'
        f'<td style="padding:4px 0">{escape(str(v))}</td></tr>'
        for k, v in rows
    )
    notes = "".join(f"<li>{escape(w)}</li>" for w in warnings)
    notes_html = (
        f'<div style="padding:8px 12px;margin-bottom:16px;background:#fffaeb;border-left:3px solid #f79009;color:#93370d;font-size:14px">'
        f'<strong>Please note:</strong><ul style="margin:4px 0 0;padding-left:18px">{notes}</ul></div>'
    ) if warnings else ""
    return f'<table style="font-size:14px;border-collapse:collapse;margin-bottom:16px">{cells}</table>' + notes_html


def _history(request):
    notes = [h for h in request.get("history", []) if h.get("note")]
    if not notes:
        return ""
    lines = "".join(
        f'<li style="margin-bottom:4px">{escape(h["at"])} - {escape(h["event"].replace("_", " "))}: {escape(h["note"])}</li>'
        for h in notes
    )
    return f'<h2 style="font-size:15px;margin:0 0 6px">Notes so far</h2><ul style="font-size:13px;padding-left:18px;margin:0 0 16px">{lines}</ul>'


def _form(request, action, error="", note=""):
    label, colour, phrase = ACTION_TEXT[action]
    required = action == "need_more_info"
    note_label = "What information do you need? (required)" if required else "Comment (optional)"
    error_html = f'<p role="alert" style="color:#b42318;font-size:14px">{escape(error)}</p>' if error else ""
    return f"""
{_summary(request)}
{_history(request)}
<p style="font-size:14px">You are about to <strong>{escape(phrase)}</strong>. Nothing is recorded until you press the button below.</p>
{error_html}
<form method="post">
  <input type="hidden" name="confirm" value="yes">
  <label for="note" style="display:block;font-size:14px;margin-bottom:4px">{escape(note_label)}</label>
  <textarea id="note" name="note" rows="4" maxlength="{NOTE_MAX}" {"required" if required else ""}
    style="width:100%;box-sizing:border-box;font:inherit;font-size:14px;padding:8px;border:1px solid #d0d5dd;border-radius:6px">{escape(note)}</textarea>
  <button type="submit" style="margin-top:12px;padding:10px 18px;border:0;border-radius:6px;background:{colour};color:#ffffff;font-size:15px;cursor:pointer">Confirm: {escape(label)}</button>
</form>
<p style="font-size:12px;color:#475467;margin-top:16px">To make a different decision, close this page and use the other button in the email.</p>"""


TOKEN_ERRORS = {
    "invalid": ("Link not valid", 404),
    "expired": ("Link expired", 410),
    "used": ("Link already used", 409),
    "revoked": ("Link no longer active", 409),
}
DONE_TITLES = {
    "approve": "Approved. Thank you.",
    "reject": "Rejected. Thank you.",
    "need_more_info": "Your request for more information was sent to the helpdesk.",
}


def inspect(token):
    """Look at a link without changing anything. Returns an outcome dict."""
    try:
        _, record = tokens.check(token)
    except tokens.TokenError as error:
        request = REQUESTS.get(error.record["request_id"]) if error.record else None
        return {"state": error.reason, "status_code": TOKEN_ERRORS[error.reason][1], "message": str(error), "request": request, "action": error.record["action"] if error.record else None}
    request = REQUESTS.get(record["request_id"])
    if request is None:
        return {"state": "invalid", "status_code": 404, "message": "This request no longer exists.", "request": None, "action": None}
    if request["status"] not in approvals.OPEN_STATUSES:
        return {"state": "decided", "status_code": 409, "message": f"This request was already {request['status']}.", "request": request, "action": record["action"]}
    return {"state": "ready", "status_code": 200, "message": "", "request": request, "action": record["action"], "expires_at": record["expires_at"]}


def decide(token, confirmed, note):
    """Record the manager's decision only after explicit confirmation. Returns an outcome dict."""
    note = (note or "").strip()
    with WORKFLOW_LOCK:
        outcome = inspect(token)
        if outcome["state"] == "decided":
            tokens.revoke_for_request(outcome["request"]["request_id"], "request already decided")
        if outcome["state"] != "ready":
            return outcome
        request, action = outcome["request"], outcome["action"]

        if not confirmed:
            return {**outcome, "state": "needs_confirmation", "status_code": 400, "message": "Please confirm using the button below."}
        if len(note) > NOTE_MAX:
            return {**outcome, "state": "invalid_note", "status_code": 400, "message": f"Please keep the comment under {NOTE_MAX} characters.", "note": note[:NOTE_MAX]}
        try:
            approvals.apply_action(request["request_id"], action, note or None, via="email")
        except ValueError as error:
            return {**outcome, "state": "invalid_note", "status_code": 400, "message": str(error).capitalize() + ".", "note": note}
        tokens.mark_used(tokens.hash_token(token))
    notifications.dispatch(request["request_id"])
    return {"state": "done", "status_code": 200, "message": DONE_TITLES[action], "request": request, "action": action}


def _html_outcome(outcome):
    state, request, action = outcome["state"], outcome["request"], outcome["action"]
    if state in TOKEN_ERRORS:
        body = f'<p style="font-size:14px">{escape(outcome["message"])}</p>'
        if request:
            body += _summary(request)
        if state == "expired":
            body += '<p style="font-size:14px">Ask the helpdesk to resend the request if a decision is still needed.</p>'
        return _page(TOKEN_ERRORS[state][0], body, outcome["status_code"])
    if request is None:
        return _page("Link not valid", f"<p>{escape(outcome['message'])}</p>", 404)
    if state == "decided":
        return _page("Already decided", f"<p>This request was already {escape(request['status'])}.</p>{_summary(request)}", 409)
    title = f"Confirm: {ACTION_TEXT[action][0]}"
    if state == "ready":
        return _page(title, _form(request, action))
    if state in ("needs_confirmation", "invalid_note"):
        return _page(title, _form(request, action, outcome["message"], outcome.get("note", "")), 400)
    return _page(outcome["message"], f'<p style="font-size:14px">Your decision has been recorded. You can close this page.</p>{_summary(request)}')


@router.get("/act/{token}", response_class=HTMLResponse, include_in_schema=False)
def show_action(token: str):
    return _html_outcome(inspect(token))


@router.post("/act/{token}", response_class=HTMLResponse, include_in_schema=False)
async def confirm_action(token: str, http_request: Request):
    raw = (await http_request.body())[:20000].decode("utf-8", errors="replace")
    form = parse_qs(raw, keep_blank_values=True)
    confirmed = form.get("confirm", [""])[0] == "yes"
    return _html_outcome(decide(token, confirmed, form.get("note", [""])[0]))


# JSON versions of the same pages for the TicketFlow web app (/act/:token in the browser).
# They need no admin key: the single-use link is the credential.

class DecisionBody(BaseModel):
    confirm: bool = False
    note: Optional[str] = Field(None, max_length=NOTE_MAX * 2)


def _request_json(request):
    if request is None:
        return None
    ticket = request.get("ticket") or {}
    return {
        "request_id": request["request_id"],
        "ticket_id": request["ticket_id"],
        "priority": ticket.get("priority"),
        "category": ticket.get("category"),
        "ticket_status": ticket.get("status"),
        "ticket_created_at": ticket.get("created_at"),
        "reasons": request.get("escalation_reasons") or [],
        "refund_amount": request.get("refund_amount"),
        "status": request["status"],
        "decided_at": request.get("decided_at"),
        "notes": [
            {"at": h["at"], "event": h["event"], "note": h["note"]}
            for h in request.get("history", []) if h.get("note")
        ],
        # Ticket details, additional helpdesk fields and data-quality warnings (privacy-filtered).
        "context": sanitize_context(request.get("context")),
    }


def _json_outcome(outcome):
    body = {
        "state": outcome["state"],
        "message": outcome["message"],
        "action": outcome["action"],
        "note_required": outcome["action"] == "need_more_info",
        "note_max_length": NOTE_MAX,
        "expires_at": outcome.get("expires_at"),
        "request": _request_json(outcome["request"]),
    }
    return JSONResponse(body, status_code=outcome["status_code"], headers=HEADERS)


@router.get("/api/manager/actions/{token}", include_in_schema=False)
def inspect_action_json(token: str):
    return _json_outcome(inspect(token))


@router.post("/api/manager/actions/{token}", include_in_schema=False)
def decide_action_json(token: str, body: DecisionBody):
    return _json_outcome(decide(token, body.confirm, body.note))
