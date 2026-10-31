"""Approval Control Center queue.

Detection only adds recommendations. Approval requests are created when the
Helpdesk Head submits a batch, never automatically.
"""

import math

from . import activity, clock, config
from .approvals import REQUESTS, active_request_for
from .config import settings
from .escalation import escalation_reasons
from .serializers import is_team_account_closing, parse_refund, ticket_brief
from .sla import UNRESOLVED, parse_csv_time, ticket_sla
from .store import PersistentDict

QUEUE = PersistentDict(settings.store_dir / "queue.json")

# queued: waiting for the Helpdesk Head; submitted: in a batch; dismissed: Helpdesk Head
# chose not to send; withdrawn: the ticket no longer needs approval after a re-import.
OPEN_ITEM = "queued"


class QueueError(Exception):
    def __init__(self, message, status_code=409):
        super().__init__(message)
        self.status_code = status_code


def _items_for(ticket_id):
    return [item for item in QUEUE.values() if item["ticket_id"] == ticket_id]


def queued_item_for(ticket_id):
    for item in _items_for(ticket_id):
        if item["status"] == OPEN_ITEM:
            return item
    return None


def _has_any_request(ticket_id):
    return any(r["ticket_id"] == ticket_id for r in REQUESTS.values())


def _new_item(ticket_id, source, reasons, refund_amount, team_account_closing, note=None, request_id=None):
    now = clock.timestamp()
    item_id = QUEUE.next_id("REC")
    item = {
        "item_id": item_id,
        "ticket_id": ticket_id,
        "source": source,
        "reasons": reasons,
        "refund_amount": refund_amount,
        "team_account_closing": team_account_closing,
        "note": note,
        "status": OPEN_ITEM,
        "request_id": request_id,
        "batch_id": None,
        "created_at": now,
        "updated_at": now,
        "status_reason": None,
        "sla_breach_recorded_at": None,
    }
    QUEUE.put(item_id, item)
    return item


def analyse_tickets(tickets):
    """Detect tickets that need manager approval and keep the queue in step with the data.

    Automatic recommendations are only made for unresolved tickets. Tickets that already
    have an approval request (open or decided), or that the Helpdesk Head dismissed,
    are not recommended again.
    """
    summary = {"analysed": len(tickets), "detected": 0, "added": 0, "updated": 0, "withdrawn": 0, "skipped": 0}
    with QUEUE.lock:
        now = clock.timestamp()
        for ticket in tickets:
            ticket_id = ticket["ticket_id"]
            refund = parse_refund(ticket)
            closing = is_team_account_closing(ticket)
            reasons = escalation_reasons(ticket.get("priority"), refund, closing)
            unresolved = (ticket.get("status") or "").strip().lower() in UNRESOLVED
            needs_approval = bool(reasons) and unresolved
            if needs_approval:
                summary["detected"] += 1

            queued = queued_item_for(ticket_id)
            if queued:
                if queued["source"] == "auto" and queued["request_id"] is None and not needs_approval:
                    queued["status"] = "withdrawn"
                    queued["status_reason"] = "ticket no longer needs approval after re-import"
                    queued["updated_at"] = now
                    summary["withdrawn"] += 1
                elif queued["source"] == "auto" and (queued["reasons"], queued["refund_amount"]) != (reasons, refund):
                    queued.update(reasons=reasons, refund_amount=refund, team_account_closing=closing, updated_at=now)
                    summary["updated"] += 1
                continue

            if not needs_approval:
                continue

            handled = any(i["status"] in ("submitted", "dismissed") for i in _items_for(ticket_id))
            if handled or _has_any_request(ticket_id):
                summary["skipped"] += 1
                continue

            withdrawn = [i for i in _items_for(ticket_id) if i["status"] == "withdrawn"]
            if withdrawn:
                withdrawn[-1].update(
                    status=OPEN_ITEM, status_reason=None, reasons=reasons,
                    refund_amount=refund, team_account_closing=closing, updated_at=now,
                )
            else:
                _new_item(ticket_id, "auto", reasons, refund, closing)
            summary["added"] += 1

        # After an import replaces the tickets, queued items for tickets that are no
        # longer in the data cannot be sent, so take them out of the queue.
        current = {t["ticket_id"] for t in tickets}
        for item in QUEUE.values():
            if item["status"] == OPEN_ITEM and item["ticket_id"] not in current:
                item.update(status="withdrawn", status_reason="ticket is not in the current ticket data", updated_at=now)
                summary["withdrawn"] += 1
        QUEUE.save()

    activity.record(
        "tickets_analysed",
        f"Analysed {summary['analysed']} tickets: {summary['added']} added to the approval queue",
        **summary,
    )
    return summary


def _manual_item(ticket, refund_amount=None, team_account_closing=False, note=None):
    refund = refund_amount if refund_amount is not None else parse_refund(ticket)
    closing = team_account_closing or is_team_account_closing(ticket)
    reasons = escalation_reasons(ticket.get("priority"), refund, closing)
    return _new_item(ticket["ticket_id"], "manual", reasons, refund, closing, note=note)


def add_manual(ticket, refund_amount=None, team_account_closing=False, note=None):
    """Queue any ticket for approval at the Helpdesk Head's request."""
    ticket_id = ticket["ticket_id"]
    with QUEUE.lock:
        if queued_item_for(ticket_id):
            raise QueueError(f"{ticket_id} is already in the approval queue.")
        active = active_request_for(ticket_id)
        if active:
            raise QueueError(f"{ticket_id} already has an open approval request ({active['request_id']}).")
        item = _manual_item(ticket, refund_amount, team_account_closing, note)
        QUEUE.save()
    activity.record("queue_manual_add", f"{ticket_id} added to the approval queue manually", item_id=item["item_id"], ticket_id=ticket_id)
    return item


def requeue_request(request, note):
    """Put a request back in the queue after the Helpdesk Head answers a request for more information."""
    with QUEUE.lock:
        if queued_item_for(request["ticket_id"]):
            raise QueueError(f"{request['ticket_id']} is already in the approval queue.")
        item = _new_item(
            request["ticket_id"], "resubmission", request["escalation_reasons"],
            request["refund_amount"], request["team_account_closing"], note=note,
            request_id=request["request_id"],
        )
        QUEUE.save()
    return item


def dismiss(item_id, reason=None):
    with QUEUE.lock:
        item = QUEUE.get(item_id)
        if item is None:
            raise QueueError("queue item not found", 404)
        if item["status"] != OPEN_ITEM:
            raise QueueError(f"{item_id} is {item['status']}, not queued.")
        item.update(status="dismissed", status_reason=reason or "dismissed by Helpdesk Head", updated_at=clock.timestamp())
        QUEUE.save()
    activity.record("queue_dismissed", f"{item['ticket_id']} removed from the approval queue", item_id=item_id, ticket_id=item["ticket_id"])
    return item


def item_view(item, ticket, now=None):
    view = dict(item)
    view["ticket"] = ticket_brief(ticket) if ticket else None
    view["sla"] = ticket_sla(ticket, now) if ticket else None
    return view


def rank_key(view):
    ticket = view["ticket"] or {}
    sla = view["sla"] or {}
    created = parse_csv_time(ticket.get("created_at"))
    remaining = sla.get("remaining_hours")
    return (
        0 if ticket.get("priority") == "urgent" else 1,
        0 if sla.get("state") == "breached" else 1,
        remaining if remaining is not None else math.inf,
        created.timestamp() if created else math.inf,
        -(view.get("refund_amount") or 0),
        view["ticket_id"],
    )


def ranked_queue(tickets_by_id, priorities=None, now=None):
    now = now or clock.now()
    views = []
    for item in QUEUE.values():
        if item["status"] != OPEN_ITEM:
            continue
        ticket = tickets_by_id.get(item["ticket_id"])
        # A ticket that is not in the current data cannot be sent, so it is not eligible.
        if ticket is None:
            continue
        if priorities and ticket.get("priority") not in priorities:
            continue
        views.append(item_view(item, ticket, now))
    views.sort(key=rank_key)
    for position, view in enumerate(views, start=1):
        view["rank"] = position
    return views


def select(tickets_by_id, mode, count=None, priorities=None, item_ids=None):
    """Return (selected views, warnings) for Top-N or manual selection."""
    queue = ranked_queue(tickets_by_id, priorities)
    warnings = []
    if mode == "top":
        if not count or count < 1:
            raise QueueError("count must be at least 1", 422)
        if count > config.settings.max_batch_size:
            raise QueueError(f"count must be at most {config.settings.max_batch_size}", 422)
        selected = queue[:count]
        if len(selected) < count:
            warnings.append(f"Only {len(selected)} eligible tickets are in the queue; {count} were requested.")
        return selected, warnings

    if mode == "manual":
        if not item_ids:
            raise QueueError("select at least one queue item", 422)
        wanted = list(dict.fromkeys(item_ids))
        if len(wanted) > config.settings.max_batch_size:
            raise QueueError(f"select at most {config.settings.max_batch_size} items", 422)
        by_id = {view["item_id"]: view for view in ranked_queue(tickets_by_id)}
        problems = []
        for item_id in wanted:
            if item_id not in by_id:
                item = QUEUE.get(item_id)
                if item is None:
                    problems.append(f"{item_id} was not found")
                elif item["status"] != OPEN_ITEM:
                    problems.append(f"{item_id} is {item['status']}")
                else:
                    problems.append(f"{item_id} ({item['ticket_id']}) is not in the current ticket data")
        if problems:
            raise QueueError("Some selected items cannot be sent: " + "; ".join(problems) + ".")
        selected = [by_id[i] for i in wanted]
        selected.sort(key=lambda v: v["rank"])
        return selected, warnings

    raise QueueError("mode must be 'top' or 'manual'", 422)
