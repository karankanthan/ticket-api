"""Helpdesk Head API for the Approval Control Center and dashboard.

When ADMIN_API_KEY is set (always in production) every route here needs the
X-Admin-Key header. This is one shared key, not per-person sign-in.
"""

import hmac
from collections import Counter
from typing import Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field

from . import activity, approvals, automation, batches, clock, config, email_service, email_templates, recommendations, ticket_imports
from .approvals import REQUESTS
from .batches import BATCHES
from .config import PRIORITIES
from .escalation import REFUND_THRESHOLD
from .recommendations import QUEUE, QueueError
from .serializers import request_view, ticket_brief, ticket_staff_view
from .sla import UNRESOLVED, approval_response, ticket_sla


def require_admin(x_admin_key: Optional[str] = Header(None)):
    settings = config.settings
    if not settings.admin_key_required:
        return
    if not x_admin_key or not hmac.compare_digest(x_admin_key.encode(), settings.admin_api_key.encode()):
        raise HTTPException(status_code=401, detail="A valid X-Admin-Key header is required.")


class ManualQueueItem(BaseModel):
    ticket_id: str = Field(min_length=1, max_length=50)
    refund_amount: Optional[float] = Field(None, ge=0)
    team_account_closing: bool = False
    note: Optional[str] = Field(None, max_length=1000)


class DismissBody(BaseModel):
    reason: Optional[str] = Field(None, max_length=500)


class SelectionBody(BaseModel):
    mode: Literal["top", "manual"]
    count: Optional[int] = Field(None, ge=1)
    priorities: Optional[List[Literal["urgent", "high", "normal", "low"]]] = None
    item_ids: Optional[List[str]] = None


class BatchBody(BaseModel):
    # Either queue items (Eligible Queue) or tickets (All Tickets), not both.
    item_ids: Optional[List[str]] = None
    ticket_ids: Optional[List[str]] = None
    note: Optional[str] = Field(None, max_length=1000)
    selection: Optional[SelectionBody] = None


class ProvideInfoBody(BaseModel):
    note: str = Field(min_length=1, max_length=1000)


class TestEmailBody(BaseModel):
    confirm: bool = False


class ImportPreviewBody(BaseModel):
    filename: str = Field("upload.csv", max_length=255)
    content: str = Field(max_length=ticket_imports.MAX_CONTENT_CHARS)
    mapping: Optional[Dict[str, Optional[str]]] = None
    date_format: Literal["auto", "DD/MM/YYYY", "MM/DD/YYYY"] = "auto"
    # Explicit choices for non-standard statuses, e.g. {"Escalated": "in_progress", "Pending": "in_progress"}.
    # A null/empty value means rows with that status are not imported.
    status_map: Optional[Dict[str, Optional[str]]] = None


class ImportCommitBody(ImportPreviewBody):
    mapping: Dict[str, Optional[str]]
    skip_invalid: bool = False
    # Additional columns to include in manager approval emails (off unless chosen).
    manager_fields: List[str] = Field(default_factory=list, max_length=50)
    # Required when current tickets are missing from the new file.
    acknowledge_removals: bool = False


def _queue_error(error):
    return HTTPException(status_code=error.status_code, detail=str(error))


def _priorities(raw):
    if not raw:
        return None
    values = [p.strip().lower() for p in raw.split(",") if p.strip()]
    unknown = [p for p in values if p not in PRIORITIES]
    if unknown:
        raise HTTPException(status_code=422, detail=f"unknown priority: {', '.join(unknown)}")
    return values


def create_router(get_tickets, reload_tickets, use_ticket_file, current_data_path, get_load_report=lambda: {}):
    router = APIRouter(prefix="/api", dependencies=[Depends(require_admin)])

    def tickets_by_id():
        return {t["ticket_id"]: t for t in get_tickets()}

    @router.get("/dashboard")
    def dashboard():
        now = clock.now()
        tickets = get_tickets()
        sla_states = Counter()
        for ticket in tickets:
            state = ticket_sla(ticket, now)["state"]
            unresolved = (ticket.get("status") or "").lower() in UNRESOLVED
            sla_states[("open_" if unresolved else "closed_") + state] += 1

        requests = list(REQUESTS.values())
        by_status = Counter(r["status"] for r in requests)
        pending = [r for r in requests if r["status"] == "pending"]
        lookup = tickets_by_id()
        # Same rule as the queue itself: only items whose ticket is in the current data.
        queued = [i for i in QUEUE.values() if i["status"] == recommendations.OPEN_ITEM and i["ticket_id"] in lookup]
        all_batches = sorted(BATCHES.values(), key=lambda b: int(b["batch_id"].split("-")[1]), reverse=True)

        return {
            "generated_at": now.isoformat(timespec="seconds"),
            "tickets": {
                "total": len(tickets),
                "by_status": dict(Counter(t.get("status") or "unknown" for t in tickets)),
                "by_priority": dict(Counter(t.get("priority") or "unknown" for t in tickets)),
            },
            "ticket_sla": {
                "open": {s: sla_states.get(f"open_{s}", 0) for s in ("breached", "at_risk", "on_track", "unknown")},
                "closed": {s: sla_states.get(f"closed_{s}", 0) for s in ("met", "missed", "unknown")},
            },
            "approvals": {
                "total": len(requests),
                "by_status": {s: by_status.get(s, 0) for s in ("pending", "info_requested", "approved", "rejected")},
                "pending_emailed": sum(1 for r in pending if r.get("emailed_at")),
                "pending_not_emailed": sum(1 for r in pending if not r.get("emailed_at")),
                "overdue_responses": sum(1 for r in pending if approval_response(r, now)["overdue"]),
            },
            "queue": {
                "queued": len(queued),
                "by_priority": dict(Counter((lookup.get(i["ticket_id"]) or {}).get("priority", "unknown") for i in queued)),
            },
            "batches": {
                "total": len(all_batches),
                "latest": batches.batch_view(all_batches[0]) if all_batches else None,
            },
            "email": email_service.status(),
            "automation": {
                "enabled": config.settings.scheduler_enabled,
                "last_run_at": automation.STATE["last_run_at"],
                "last_error": automation.STATE["last_error"],
            },
        }

    @router.get("/control-center/queue")
    def queue(priority: Optional[str] = Query(None, description="comma-separated, e.g. urgent,high")):
        items = recommendations.ranked_queue(tickets_by_id(), _priorities(priority))
        return {"total": len(items), "items": items}

    @router.post("/control-center/queue", status_code=201)
    def add_to_queue(body: ManualQueueItem):
        ticket = tickets_by_id().get(body.ticket_id)
        if ticket is None:
            raise HTTPException(status_code=404, detail="ticket not found")
        try:
            item = recommendations.add_manual(ticket, body.refund_amount, body.team_account_closing, body.note)
        except QueueError as error:
            raise _queue_error(error)
        return recommendations.item_view(item, ticket)

    @router.post("/control-center/queue/{item_id}/dismiss")
    def dismiss(item_id: str, body: Optional[DismissBody] = None):
        try:
            return recommendations.dismiss(item_id, body.reason if body else None)
        except QueueError as error:
            raise _queue_error(error)

    @router.post("/control-center/preview")
    def preview(body: SelectionBody):
        try:
            selected, warnings = recommendations.select(
                tickets_by_id(), body.mode, body.count, body.priorities, body.item_ids
            )
        except QueueError as error:
            raise _queue_error(error)
        return {
            "mode": body.mode,
            "requested": body.count if body.mode == "top" else len(set(body.item_ids or [])),
            "selected_count": len(selected),
            "items": selected,
            "item_ids": [v["item_id"] for v in selected],
            "warnings": warnings,
            "email": email_service.status(),
        }

    @router.post("/control-center/batches", status_code=201)
    def submit_batch(body: BatchBody):
        if bool(body.item_ids) == bool(body.ticket_ids):
            raise HTTPException(status_code=422, detail="Send either item_ids (queue) or ticket_ids (All Tickets), with at least one.")
        try:
            if body.ticket_ids:
                batch = batches.submit_tickets(body.ticket_ids, tickets_by_id(), body.note)
            else:
                batch = batches.submit(
                    body.item_ids, tickets_by_id(), body.note,
                    body.selection.model_dump() if body.selection else None,
                )
        except QueueError as error:
            raise _queue_error(error)
        return batches.batch_view(batch)

    @router.get("/control-center/batches")
    def list_batches():
        ordered = sorted(BATCHES.values(), key=lambda b: int(b["batch_id"].split("-")[1]), reverse=True)
        return [batches.batch_view(b) for b in ordered]

    @router.get("/control-center/batches/{batch_id}")
    def get_batch(batch_id: str):
        batch = BATCHES.get(batch_id)
        if batch is None:
            raise HTTPException(status_code=404, detail="batch not found")
        view = batches.batch_view(batch)
        view["requests"] = [request_view(REQUESTS[rid]) for rid in batch["request_ids"] if rid in REQUESTS]
        return view

    @router.post("/control-center/batches/{batch_id}/resend")
    def resend_batch(batch_id: str):
        try:
            return batches.batch_view(batches.resend(batch_id, tickets_by_id()))
        except QueueError as error:
            raise _queue_error(error)

    @router.post("/control-center/import")
    def import_tickets():
        try:
            count = reload_tickets()
        except (RuntimeError, ValueError, KeyError) as error:
            activity.record("import_failed", f"Ticket import failed: {error}")
            raise HTTPException(status_code=400, detail=f"Import failed; the previous ticket data is still in use. {error}")
        return {"imported": count, "analysis": recommendations.analyse_tickets(get_tickets())}

    @router.get("/approvals")
    def list_approvals(
        status: Optional[str] = None,
        batch_id: Optional[str] = None,
        ticket_id: Optional[str] = None,
    ):
        items = list(REQUESTS.values())
        if status:
            items = [r for r in items if r["status"] == status]
        if batch_id:
            items = [r for r in items if r.get("batch_id") == batch_id]
        if ticket_id:
            items = [r for r in items if r["ticket_id"] == ticket_id]
        items.sort(key=lambda r: r.get("updated_at") or "", reverse=True)
        now = clock.now()
        return [{**request_view(r), "response": approval_response(r, now), "delivery": batches.delivery_for(r)} for r in items]

    @router.get("/approvals/{request_id}")
    def get_approval(request_id: str):
        request = REQUESTS.get(request_id)
        if request is None:
            raise HTTPException(status_code=404, detail="request not found")
        return {**request_view(request), "response": approval_response(request), "delivery": batches.delivery_for(request)}

    @router.post("/approvals/{request_id}/provide-info")
    def provide_info(request_id: str, body: ProvideInfoBody):
        with batches.WORKFLOW_LOCK:
            try:
                request = approvals.provide_info(request_id, body.note)
                item = recommendations.requeue_request(request, body.note.strip())
            except LookupError:
                raise HTTPException(status_code=404, detail="request not found")
            except ValueError as error:
                raise HTTPException(status_code=400, detail=str(error))
            except QueueError as error:
                raise _queue_error(error)
        return {"request": request_view(request), "queue_item": item}

    @router.get("/activity")
    def list_activity(limit: int = Query(100, ge=1, le=1000), event: Optional[str] = None):
        return activity.recent(limit, event)

    @router.get("/email/status")
    def email_status():
        return email_service.status()

    @router.post("/email/test")
    def send_test_email(body: TestEmailBody):
        if not body.confirm:
            raise HTTPException(status_code=400, detail="Set confirm to true to send a test email to the manager.")
        subject, text, html = email_templates.test_email()
        result = email_service.send(subject, text, html)
        activity.record("email_test", f"Test email: {result['status']}", status=result["status"], error=result["error"])
        return {key: result[key] for key in ("status", "delivered", "backend", "recipient", "attempts", "error", "at", "outbox_file")}

    @router.get("/automation/status")
    def automation_status():
        due = batches.due_reminders()
        return {
            "enabled": config.settings.scheduler_enabled,
            "interval_seconds": config.settings.scheduler_interval_seconds,
            "reminder_after_hours": list(config.settings.reminder_after_hours),
            "max_reminders": config.settings.max_reminders,
            "reminders_due": sum(len(v) for v in due.values()),
            **automation.STATE,
        }

    @router.post("/automation/run")
    def run_automation():
        return automation.run_once(get_tickets())

    def approval_index():
        latest = {}
        for request in REQUESTS.values():
            current = latest.get(request["ticket_id"])
            if current is None or int(request["request_id"].split("-")[1]) > int(current["request_id"].split("-")[1]):
                latest[request["ticket_id"]] = request
        queued = {i["ticket_id"]: i for i in QUEUE.values() if i["status"] == recommendations.OPEN_ITEM}
        return latest, queued

    def approval_summary(ticket_id, latest, queued):
        request = latest.get(ticket_id)
        item = queued.get(ticket_id)
        if request and request["status"] in approvals.OPEN_STATUSES:
            status = request["status"]
        elif item:
            status = "queued"
        elif request:
            status = request["status"]
        else:
            status = "none"
        return {
            "status": status,
            "request_id": request["request_id"] if request else None,
            "batch_id": request.get("batch_id") if request else None,
            "decided_at": request.get("decided_at") if request else None,
            "queue_item_id": item["item_id"] if item else None,
            "queue_reasons": item["reasons"] if item else [],
        }

    @router.get("/tickets")
    def list_all_tickets():
        now = clock.now()
        latest, queued = approval_index()
        tickets = [
            {**ticket_staff_view(t), "sla": ticket_sla(t, now), "approval": approval_summary(t["ticket_id"], latest, queued)}
            for t in get_tickets()
        ]
        return {"total": len(tickets), "generated_at": now.isoformat(timespec="seconds"), "tickets": tickets}

    @router.get("/tickets/{ticket_id}")
    def ticket_detail(ticket_id: str):
        ticket = tickets_by_id().get(ticket_id)
        if ticket is None:
            raise HTTPException(status_code=404, detail="ticket not found")
        latest, queued = approval_index()
        requests = sorted(
            (r for r in REQUESTS.values() if r["ticket_id"] == ticket_id),
            key=lambda r: int(r["request_id"].split("-")[1]), reverse=True,
        )
        now = clock.now()
        return {
            **ticket_staff_view(ticket),
            "sla": ticket_sla(ticket, now),
            "approval": approval_summary(ticket_id, latest, queued),
            "requests": [{**request_view(r), "response": approval_response(r, now)} for r in requests],
        }

    @router.post("/imports/preview")
    def import_preview(body: ImportPreviewBody):
        try:
            return ticket_imports.preview(body.filename, body.content, body.mapping, body.date_format, body.status_map, current_tickets=get_tickets())
        except ticket_imports.ImportFailed as error:
            raise HTTPException(status_code=error.status_code, detail=str(error))

    @router.post("/imports", status_code=201)
    def import_commit(body: ImportCommitBody):
        try:
            entry = ticket_imports.commit(
                body.filename, body.content, body.mapping, body.date_format, body.skip_invalid, use_ticket_file,
                status_map=body.status_map, manager_fields=body.manager_fields,
                acknowledge_removals=body.acknowledge_removals, current_tickets=list(get_tickets()),
            )
        except ticket_imports.ImportFailed as error:
            detail = {"message": str(error), **(error.details or {})}
            raise HTTPException(status_code=error.status_code, detail=detail)
        analysis = recommendations.analyse_tickets(get_tickets())
        ticket_imports.set_analysis(entry["import_id"], analysis)
        return {**entry, "analysis": analysis}

    @router.get("/imports")
    def import_history():
        return {"active_file": current_data_path(), "imports": ticket_imports.history()}

    @router.get("/settings")
    def app_settings():
        settings = config.settings
        return {
            "environment": {
                "app_env": settings.app_env,
                "admin_key_required": settings.admin_key_required,
                "scheduler_enabled": settings.scheduler_enabled,
                "scheduler_interval_seconds": settings.scheduler_interval_seconds,
                "public_base_url": settings.public_base_url,
                "ticket_data_file": current_data_path(),
                "tickets_loaded": len(get_tickets()),
                "data_load": {
                    key: get_load_report().get(key)
                    for key in ("file", "total_rows", "loaded", "skipped")
                } | {"reasons": (get_load_report().get("reasons") or [])[:50]},
                "store_dir": str(settings.store_dir),
            },
            "sla": {
                "ticket_sla_hours": settings.ticket_sla_hours,
                "approval_response_hours": settings.approval_response_hours,
                "at_risk_fraction": settings.sla_at_risk_fraction,
            },
            "reminders": {
                "after_hours": list(settings.reminder_after_hours),
                "max_reminders": settings.max_reminders,
                "action_link_ttl_hours": settings.action_link_ttl_hours,
            },
            "approval_rules": [
                {"rule": "urgent ticket", "description": "Ticket priority is urgent (P1)."},
                {"rule": f"refund over ${REFUND_THRESHOLD}", "description": f"Refund amount is more than ${REFUND_THRESHOLD}, when refund data is available."},
                {"rule": "team account closing", "description": "An explicit team_account_closing value is yes/true/1. A team-account label alone does not count."},
            ],
            "batches": {"max_batch_size": settings.max_batch_size},
            "employee_notifications": {
                "enabled": settings.employee_notifications,
                "allowed_domains": list(settings.employee_email_domains),
                "source": "The ticket's raised-by employee email column (customer columns are never used).",
            },
            "email": email_service.status(),
        }

    @router.get("/tickets/{ticket_id}/sla")
    def ticket_sla_view(ticket_id: str):
        ticket = tickets_by_id().get(ticket_id)
        if ticket is None:
            raise HTTPException(status_code=404, detail="ticket not found")
        return {"ticket": ticket_brief(ticket), "sla": ticket_sla(ticket)}

    return router
