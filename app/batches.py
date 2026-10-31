"""Batch submission, consolidated manager emails, resends and reminders."""

import threading

from . import activity, approvals, clock, config, email_service, email_templates, recommendations, ticket_imports, tokens
from .approvals import REQUESTS, active_request_for
from .config import settings
from .recommendations import OPEN_ITEM, QUEUE, QueueError
from .serializers import TICKET_FIELDS, approval_context, employee_email_for, sanitize_context, ticket_brief
from .sla import approval_response, parse_iso, ticket_sla
from .store import PersistentDict

BATCHES = PersistentDict(settings.store_dir / "batches.json")

# Held for every multi-step change (batch submit, email links, manager decisions)
# so two of them can never interleave.
WORKFLOW_LOCK = threading.RLock()

DELIVERED_OR_SAVED = {"sent", "saved_to_outbox", "printed_to_console"}


def _public_ticket(ticket):
    return {key: ticket.get(key, "") for key in TICKET_FIELDS}


def submit(item_ids, tickets_by_id, note=None, selection=None):
    """Create approval requests for the reviewed queue items and email the manager once."""
    note = (note or "").strip() or None
    with WORKFLOW_LOCK:
        wanted = list(dict.fromkeys(item_ids or []))
        if not wanted:
            raise QueueError("select at least one queue item", 422)
        if len(wanted) > config.settings.max_batch_size:
            raise QueueError(f"a batch can hold at most {config.settings.max_batch_size} tickets", 422)

        items = []
        problems = []
        for item_id in wanted:
            item = QUEUE.get(item_id)
            if item is None:
                problems.append(f"{item_id} was not found")
                continue
            if item["status"] != OPEN_ITEM:
                problems.append(f"{item_id} ({item['ticket_id']}) is {item['status']}")
                continue
            if item["ticket_id"] not in tickets_by_id:
                problems.append(f"{item_id} ({item['ticket_id']}) is not in the current ticket data")
                continue
            active = active_request_for(item["ticket_id"])
            if active and active["request_id"] != item["request_id"]:
                problems.append(f"{item['ticket_id']} already has an open request ({active['request_id']})")
                continue
            items.append(item)
        if problems:
            raise QueueError("Batch not sent: " + "; ".join(problems) + ".")

        batch_id = BATCHES.next_id("BATCH")
        request_ids = []
        for item in items:
            ticket = tickets_by_id[item["ticket_id"]]
            if item["request_id"]:
                request = approvals.reopen_for_batch(item["request_id"], batch_id)
            else:
                request = approvals.create_request(
                    item["ticket_id"],
                    ticket.get("priority"),
                    item["refund_amount"],
                    item["team_account_closing"],
                    ticket=_public_ticket(ticket),
                    source="control_center",
                    batch_id=batch_id,
                    employee_email=employee_email_for(ticket) or None,
                    context=approval_context(ticket, ticket_imports.active_manager_fields()),
                )
            item.update(status="submitted", request_id=request["request_id"], batch_id=batch_id, updated_at=clock.timestamp())
            request_ids.append(request["request_id"])
        QUEUE.save()

        batch = {
            "batch_id": batch_id,
            "created_at": clock.timestamp(),
            "status": "sending",
            "item_ids": [item["item_id"] for item in items],
            "request_ids": request_ids,
            "note": note,
            "selection": selection or {"mode": "manual"},
            "emails": [],
        }
        BATCHES[batch_id] = batch
        activity.record(
            "batch_submitted",
            f"{batch_id} submitted with {len(request_ids)} ticket(s)",
            batch_id=batch_id,
            request_ids=request_ids,
        )
        _deliver(batch, request_ids, tickets_by_id, kind="initial")
    return batch


def submit_tickets(ticket_ids, tickets_by_id, note=None):
    """Batch tickets picked in All Tickets, eligible or not. Nothing is created unless every ticket is valid.

    A ticket already in the approval queue reuses its queue entry; any other ticket gets a manual entry.
    A ticket that already has an open request with the manager is refused (no duplicates).
    """
    with WORKFLOW_LOCK:
        wanted = list(dict.fromkeys((t or "").strip() for t in ticket_ids or [] if (t or "").strip()))
        if not wanted:
            raise QueueError("select at least one ticket", 422)
        if len(wanted) > config.settings.max_batch_size:
            raise QueueError(f"a batch can hold at most {config.settings.max_batch_size} tickets", 422)

        problems = []
        for ticket_id in wanted:
            if ticket_id not in tickets_by_id:
                problems.append(f"{ticket_id} is not in the current ticket data")
                continue
            active = active_request_for(ticket_id)
            queued = recommendations.queued_item_for(ticket_id)
            # A resubmission queue entry belongs to the open request, so it may be sent again.
            if active and not (queued and queued["request_id"] == active["request_id"]):
                problems.append(f"{ticket_id} already has an open request with the manager ({active['request_id']})")
        if problems:
            raise QueueError("Batch not sent: " + "; ".join(problems) + ".")

        item_ids = []
        manual = []
        with QUEUE.lock:
            for ticket_id in wanted:
                item = recommendations.queued_item_for(ticket_id)
                if item is None:
                    item = recommendations._manual_item(tickets_by_id[ticket_id], note="requested from All Tickets")
                    manual.append(ticket_id)
                item_ids.append(item["item_id"])
            QUEUE.save()
        if manual:
            activity.record(
                "queue_manual_add",
                f"{len(manual)} ticket(s) requested manually from All Tickets: {', '.join(manual)}",
                ticket_ids=manual,
            )
        return submit(item_ids, tickets_by_id, note, {"mode": "manual", "source": "all_tickets"})


def delivery_for(request):
    """The latest email attempt that carried this request's links, if any."""
    batch = BATCHES.get(request.get("batch_id") or "")
    if not batch:
        return None
    for email in reversed(batch.get("emails", [])):
        if request["request_id"] in email.get("request_ids", []):
            return {key: email.get(key) for key in ("kind", "status", "delivered", "error", "at")}
    return None


def resend(batch_id, tickets_by_id):
    """Send fresh links for the batch's still-pending requests (after a failed send or expired links)."""
    with WORKFLOW_LOCK:
        batch = BATCHES.get(batch_id)
        if batch is None:
            raise QueueError("batch not found", 404)
        pending = [
            rid for rid in batch["request_ids"]
            if REQUESTS[rid]["status"] == "pending" and REQUESTS[rid].get("batch_id") == batch_id
        ]
        if not pending:
            raise QueueError(f"{batch_id} has no pending requests to send.")
        _deliver(batch, pending, tickets_by_id, kind="resend")
    return batch


def _email_items(request_ids, tickets_by_id, now, issued):
    """Build email rows, recording each request's new token hashes in `issued` as they are created."""
    items = []
    expires_at = None
    for request_id in request_ids:
        request = REQUESTS[request_id]
        ticket = tickets_by_id.get(request["ticket_id"]) or request.get("ticket") or {"ticket_id": request["ticket_id"]}
        links, hashes, expires_at = tokens.issue_links(request_id, request.get("batch_id"))
        issued[request_id] = hashes
        response = approval_response({**request, "emailed_at": request.get("emailed_at") or now.isoformat()}, now)
        items.append({
            "request_id": request_id,
            "ticket": ticket_brief(ticket),
            "reasons": request["escalation_reasons"],
            "refund_amount": request["refund_amount"],
            "sla": ticket_sla(ticket, now),
            "response_due": response["due_at"],
            "links": links,
            "context": sanitize_context(request.get("context")) or {},
        })
    return items, expires_at


def _deliver(batch, request_ids, tickets_by_id, kind, reminder_counts=None):
    """Email links for the given requests and record exactly what happened."""
    now = clock.now()
    issued = {}
    try:
        items, expires_at = _email_items(request_ids, tickets_by_id, now, issued)
        name = config.settings.manager_name
        if kind == "reminder":
            number = max(reminder_counts.values())
            subject, text, html = email_templates.reminder_email(
                batch["batch_id"], number, config.settings.max_reminders, items, expires_at, name
            )
        else:
            subject, text, html = email_templates.batch_email(batch["batch_id"], items, expires_at, name, batch.get("note") or "")
    except Exception:
        for hashes in issued.values():
            tokens.discard(hashes)
        raise

    result = email_service.send(subject, text, html)
    result.update(kind=kind, request_ids=list(request_ids), links_expire_at=expires_at, subject=subject)
    ok = result["status"] in DELIVERED_OR_SAVED

    for request_id, hashes in issued.items():
        if ok:
            tokens.activate(request_id, hashes)
        else:
            tokens.discard(hashes)
    if ok:
        approvals.mark_emailed(request_ids, result["at"], reminder_counts)

    batch["emails"].append(result)
    if kind != "reminder":
        batch["status"] = result["status"] if ok else "email_failed"
    batch["updated_at"] = result["at"]
    BATCHES.save()

    label = {"initial": "Batch email", "resend": "Batch email (resend)", "reminder": "Reminder email"}[kind]
    if ok:
        how = {
            "sent": "sent to the manager",
            "saved_to_outbox": "saved to the local outbox (not delivered)",
            "printed_to_console": "printed to the console (not delivered)",
        }[result["status"]]
        activity.record(f"email_{kind}", f"{label} for {batch['batch_id']} {how}", batch_id=batch["batch_id"], status=result["status"], request_ids=list(request_ids))
    else:
        activity.record(f"email_{kind}_failed", f"{label} for {batch['batch_id']} failed: {result['error']}", batch_id=batch["batch_id"], error=result["error"], request_ids=list(request_ids))
    return result


def due_reminders(now=None):
    """{batch_id: {request_id: new reminder count}} for requests whose next reminder is due."""
    now = now or clock.now()
    thresholds = config.settings.reminder_after_hours[: config.settings.max_reminders]
    due = {}
    for request in REQUESTS.values():
        if request["status"] != "pending" or not request.get("batch_id"):
            continue
        sent = parse_iso(request.get("emailed_at"))
        if sent is None:
            continue
        waited = (now - sent).total_seconds() / 3600
        reached = sum(1 for hours in thresholds if waited >= hours)
        if reached > request.get("reminders_sent", 0):
            due.setdefault(request["batch_id"], {})[request["request_id"]] = reached
    return due


def send_reminders(tickets_by_id, now=None):
    """Send one reminder email per batch for requests that are due. Never decides anything."""
    results = []
    with WORKFLOW_LOCK:
        for batch_id, counts in due_reminders(now).items():
            batch = BATCHES.get(batch_id)
            if batch is None:
                continue
            results.append(_deliver(batch, list(counts), tickets_by_id, kind="reminder", reminder_counts=counts))
    return results


def batch_view(batch):
    view = {key: batch.get(key) for key in ("batch_id", "created_at", "updated_at", "status", "item_ids", "request_ids", "note", "selection")}
    statuses = [REQUESTS[rid]["status"] for rid in batch["request_ids"] if rid in REQUESTS]
    priorities = [((REQUESTS[rid].get("ticket") or {}).get("priority") or "unknown") for rid in batch["request_ids"] if rid in REQUESTS]
    view["priorities"] = {p: priorities.count(p) for p in dict.fromkeys(priorities)}
    view["counts"] = {s: statuses.count(s) for s in ("pending", "info_requested", "approved", "rejected")}
    view["total"] = len(statuses)
    view["emails"] = [
        {key: e.get(key) for key in ("kind", "status", "delivered", "backend", "recipient", "attempts", "error", "at", "links_expire_at", "subject", "request_ids", "outbox_file")}
        for e in batch.get("emails", [])
    ]
    return view
