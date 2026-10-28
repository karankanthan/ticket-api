from .escalation import escalation_reasons

ACTIONS = {
    "approve": "approved",
    "reject": "rejected",
    "need_more_info": "info_requested",
}
OPEN_STATUSES = {"pending", "info_requested"}

REQUESTS = {}


def create_request(ticket_id, priority, refund_amount=None, team_account_closing=False):
    reasons = escalation_reasons(priority, refund_amount, team_account_closing)
    request_id = f"REQ-{len(REQUESTS) + 1}"
    request = {
        "request_id": request_id,
        "ticket_id": ticket_id,
        "refund_amount": refund_amount,
        "team_account_closing": team_account_closing,
        "escalated": bool(reasons),
        "escalation_reasons": reasons,
        "status": "pending",
        "note": None,
    }
    REQUESTS[request_id] = request
    return request


def apply_action(request_id, action, note=None):
    request = REQUESTS.get(request_id)
    if request is None:
        raise LookupError("request not found")
    if action not in ACTIONS:
        raise ValueError("unknown action")
    if request["status"] not in OPEN_STATUSES:
        raise ValueError("request is already decided")
    if action == "need_more_info" and not note:
        raise ValueError("a note is required when asking for more info")

    request["status"] = ACTIONS[action]
    request["note"] = note
    return request