"""Background checks: pending reminders, overdue manager responses and SLA breaches.

Nothing here approves or rejects a request; overdue items are only reported.
"""

import asyncio
import logging

from . import activity, batches, clock, config
from .approvals import REQUESTS
from .recommendations import OPEN_ITEM, QUEUE
from .sla import approval_response, ticket_sla

log = logging.getLogger("ticket_api.automation")

STATE = {"last_run_at": None, "last_result": None, "last_error": None, "runs": 0}


def run_once(tickets, now=None):
    now = now or clock.now()
    tickets_by_id = {t["ticket_id"]: t for t in tickets}

    reminders = batches.send_reminders(tickets_by_id, now)

    newly_overdue = []
    with batches.WORKFLOW_LOCK:
        with REQUESTS.lock:
            for request in REQUESTS.values():
                if request.get("overdue_recorded_at"):
                    continue
                if approval_response(request, now)["overdue"]:
                    request["overdue_recorded_at"] = now.isoformat(timespec="seconds")
                    newly_overdue.append(request["request_id"])
            if newly_overdue:
                REQUESTS.save()

        newly_breached = []
        with QUEUE.lock:
            for item in QUEUE.values():
                if item["status"] != OPEN_ITEM or item.get("sla_breach_recorded_at"):
                    continue
                ticket = tickets_by_id.get(item["ticket_id"])
                if ticket and ticket_sla(ticket, now)["state"] == "breached":
                    item["sla_breach_recorded_at"] = now.isoformat(timespec="seconds")
                    newly_breached.append(item["ticket_id"])
            if newly_breached:
                QUEUE.save()

    if newly_overdue:
        activity.record(
            "approval_overdue",
            f"{len(newly_overdue)} approval request(s) passed the manager response target",
            request_ids=newly_overdue,
        )
    if newly_breached:
        activity.record(
            "sla_breached",
            f"{len(newly_breached)} queued ticket(s) have breached their SLA",
            ticket_ids=newly_breached,
        )

    result = {
        "ran_at": now.isoformat(timespec="seconds"),
        "reminder_emails": [
            {"status": r["status"], "error": r["error"], "request_ids": r["request_ids"]} for r in reminders
        ],
        "newly_overdue_requests": newly_overdue,
        "newly_breached_tickets": newly_breached,
    }
    STATE.update(last_run_at=result["ran_at"], last_result=result, last_error=None, runs=STATE["runs"] + 1)
    return result


async def scheduler_loop(get_tickets):
    interval = config.settings.scheduler_interval_seconds
    log.info("Automation scheduler started (every %s seconds)", interval)
    while True:
        try:
            await asyncio.to_thread(run_once, get_tickets())
        except Exception as error:  # keep the loop alive; the error is visible in the status API
            log.exception("Automation run failed")
            STATE["last_error"] = f"{type(error).__name__}: {error}"
        await asyncio.sleep(interval)
