"""Pages the manager reaches from email links. No login: the single-use link is the credential.

GET only shows a confirmation page, because email scanners and link previews open links
automatically. The decision is recorded only by the POST from that page.
"""

from html import escape
from urllib.parse import parse_qs

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from . import approvals, tokens
from .approvals import REQUESTS
from .batches import WORKFLOW_LOCK
from .email_templates import FONT, money, priority_label

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
    cells = "".join(
        f'<tr><td style="padding:4px 12px 4px 0;color:#475467;vertical-align:top">{escape(k)}</td>'
        f'<td style="padding:4px 0">{escape(str(v))}</td></tr>'
        for k, v in rows
    )
    return f'<table style="font-size:14px;border-collapse:collapse;margin-bottom:16px">{cells}</table>'


def _history(request):
    notes = [h for h in request.get("history", []) if h.get("note")]
    if not notes:
        return ""
    lines = "".join(
        f'<li style="margin-bottom:4px">{escape(h["at"])} - {escape(h["event"].replace("_", " "))}: {escape(h["note"])}</li>'
        for h in notes
    )
    return f'<h2 style="font-size:15px;margin:0 0 6px">Notes so far</h2><ul style="font-size:13px;padding-left:18px;margin:0 0 16px">{lines}</ul>'


def _token_error_page(error):
    titles = {
        "invalid": ("Link not valid", 404),
        "expired": ("Link expired", 410),
        "used": ("Link already used", 409),
        "revoked": ("Link no longer active", 409),
    }
    title, code = titles[error.reason]
    body = f'<p style="font-size:14px">{escape(str(error))}</p>'
    record = error.record
    if record and record["request_id"] in REQUESTS:
        request = REQUESTS[record["request_id"]]
        body += _summary(request)
    if error.reason == "expired":
        body += '<p style="font-size:14px">Ask the helpdesk to resend the request if a decision is still needed.</p>'
    return _page(title, body, code)


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


@router.get("/act/{token}", response_class=HTMLResponse, include_in_schema=False)
def show_action(token: str):
    try:
        _, record = tokens.check(token)
    except tokens.TokenError as error:
        return _token_error_page(error)

    request = REQUESTS.get(record["request_id"])
    if request is None:
        return _page("Link not valid", "<p>This request no longer exists.</p>", 404)
    if request["status"] not in approvals.OPEN_STATUSES:
        return _page("Already decided", f"<p>This request was already {escape(request['status'])}.</p>{_summary(request)}", 409)
    return _page(f"Confirm: {ACTION_TEXT[record['action']][0]}", _form(request, record["action"]))


@router.post("/act/{token}", response_class=HTMLResponse, include_in_schema=False)
async def confirm_action(token: str, http_request: Request):
    raw = (await http_request.body())[:20000].decode("utf-8", errors="replace")
    form = parse_qs(raw, keep_blank_values=True)
    confirmed = form.get("confirm", [""])[0] == "yes"
    note = form.get("note", [""])[0].strip()

    with WORKFLOW_LOCK:
        try:
            token_hash, record = tokens.check(token)
        except tokens.TokenError as error:
            return _token_error_page(error)

        request = REQUESTS.get(record["request_id"])
        if request is None:
            return _page("Link not valid", "<p>This request no longer exists.</p>", 404)
        action = record["action"]
        title = f"Confirm: {ACTION_TEXT[action][0]}"

        if not confirmed:
            return _page(title, _form(request, action, "Please confirm using the button below."), 400)
        if len(note) > NOTE_MAX:
            return _page(title, _form(request, action, f"Please keep the comment under {NOTE_MAX} characters.", note[:NOTE_MAX]), 400)
        if request["status"] not in approvals.OPEN_STATUSES:
            tokens.revoke_for_request(request["request_id"], "request already decided")
            return _page("Already decided", f"<p>This request was already {escape(request['status'])}.</p>{_summary(request)}", 409)

        try:
            approvals.apply_action(request["request_id"], action, note or None, via="email")
        except ValueError as error:
            return _page(title, _form(request, action, str(error).capitalize() + ".", note), 400)
        tokens.mark_used(token_hash)

    done = {
        "approve": "Approved. Thank you.",
        "reject": "Rejected. Thank you.",
        "need_more_info": "Your request for more information was sent to the helpdesk.",
    }[action]
    return _page(done, f'<p style="font-size:14px">Your decision has been recorded. You can close this page.</p>{_summary(request)}')
