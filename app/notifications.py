"""Tell the employee who raised a ticket about the manager's decision.

Only the ticket's explicit employee address (the imported raised_by_email column) is ever
used: never a customer or requester column. Each attempt is recorded on the approval
request as sent, failed or skipped (with the reason); nothing is reported as delivered
unless the SMTP server accepted it.
"""

import threading

from . import activity, clock, config, email_service, email_templates
from .approvals import REQUESTS
from .serializers import mask_email

# Decisions are confirmed to the manager straight away; the employee email follows in the
# background so a slow SMTP server never delays the manager. Tests switch this off.
RUN_IN_BACKGROUND = True
_threads = []


def skip_reason(address, settings=None):
    """Why no email can be sent to this address, or None if it may be used."""
    settings = settings or config.settings
    if not settings.employee_notifications:
        return "employee notifications are turned off (EMPLOYEE_NOTIFICATIONS=false)"
    if not address:
        return "no employee email for this ticket (the import has no raised-by email for it)"
    if not email_service.EMAIL_PATTERN.match(address):
        return "the employee email is not a valid address"
    domain = address.rsplit("@", 1)[1].lower()
    if settings.employee_email_domains and domain not in settings.employee_email_domains:
        return f"{domain} is not in EMPLOYEE_EMAIL_DOMAINS"
    return None


def dispatch(request_id):
    if RUN_IN_BACKGROUND:
        thread = threading.Thread(target=notify, args=(request_id,), daemon=True, name=f"notify-{request_id}")
        _threads.append(thread)
        thread.start()
    else:
        notify(request_id)


def wait(timeout=30):
    """Wait for background notifications (used by tests and the shutdown hook)."""
    while _threads:
        _threads.pop().join(timeout)


def _record(request_id, entry):
    with REQUESTS.lock:
        request = REQUESTS[request_id]
        request.setdefault("employee_notifications", []).append(entry)
        REQUESTS.save()


def notify(request_id):
    request = REQUESTS.get(request_id)
    if request is None:
        return None
    decision = request["status"]
    address = (request.get("employee_email") or "").strip()
    entry = {"decision": decision, "recipient": mask_email(address), "status": "skipped", "reason": None, "error": None, "at": clock.timestamp()}

    reason = skip_reason(address)
    if reason:
        entry["reason"] = reason
        _record(request_id, entry)
        activity.record(
            "employee_notification_skipped",
            f"No employee email for {request['ticket_id']} ({decision.replace('_', ' ')}): {reason}",
            request_id=request_id, ticket_id=request["ticket_id"], reason=reason,
        )
        return entry

    subject, text, html = email_templates.employee_decision_email(request)
    result = email_service.send_to_employee(address, subject, text, html)
    entry.update(status=result["status"], error=result["error"], at=result["at"])
    _record(request_id, entry)
    if result["status"] == "failed":
        activity.record(
            "employee_notification_failed",
            f"Employee email for {request['ticket_id']} was not sent: {result['error']}",
            request_id=request_id, ticket_id=request["ticket_id"], error=result["error"],
        )
    else:
        how = {
            "sent": "sent",
            "saved_to_outbox": "saved to the local outbox (not delivered)",
            "printed_to_console": "printed to the console (not delivered)",
        }[result["status"]]
        activity.record(
            "employee_notified",
            f"Employee email for {request['ticket_id']} ({decision.replace('_', ' ')}) {how} to {entry['recipient']}",
            request_id=request_id, ticket_id=request["ticket_id"], status=result["status"],
        )
    return entry
