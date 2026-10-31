"""All Tickets view, manual batches from any ticket, and Awaiting Manager data."""

from app import approvals, main, recommendations


def rows(n):
    priorities = ["urgent", "high", "normal", "low"]
    statuses = ["open", "in_progress", "resolved", "closed"]
    lines = ["ticket_id,created_at,status,priority,category,refund_amount"]
    for i in range(1, n + 1):
        lines.append(f"GEN-{i:03d},2026-10-{1 + i % 28:02d} 09:00,{statuses[i % 4]},{priorities[i % 4]},Cat{i % 5},{'' if i % 3 else 50 * i}")
    return "\n".join(lines) + "\n"


def import_csv(workflow, content):
    mapping = workflow.client.post("/api/imports/preview", json={"content": content}).json()["mapping"]
    response = workflow.client.post("/api/imports", json={"content": content, "mapping": mapping, "acknowledge_removals": True})
    assert response.status_code == 201, response.text
    return response.json()


def submit_tickets(workflow, *ticket_ids, note=None):
    return workflow.client.post("/api/control-center/batches", json={"ticket_ids": list(ticket_ids), "note": note})


def test_all_120_imported_tickets_are_listed(workflow):
    assert import_csv(workflow, rows(120))["imported_rows"] == 120
    body = workflow.client.get("/api/tickets").json()
    assert body["total"] == 120
    assert len({t["ticket_id"] for t in body["tickets"]}) == 120
    statuses = {t["status"] for t in body["tickets"]}
    assert statuses == {"open", "in_progress", "resolved", "closed"}  # not only eligible tickets


def test_eligible_queue_holds_only_tickets_matching_the_rules(workflow):
    import_csv(workflow, rows(120))
    queue = workflow.client.get("/api/control-center/queue").json()["items"]
    tickets = {t["ticket_id"]: t for t in workflow.client.get("/api/tickets").json()["tickets"]}
    assert 0 < len(queue) < 120
    for item in queue:
        ticket = tickets[item["ticket_id"]]
        assert ticket["status"] in ("open", "in_progress")
        assert ticket["priority"] == "urgent" or (ticket["refund_amount"] or 0) > 200


def test_manual_batch_for_an_ineligible_ticket(workflow):
    # T-9 matches no rule (normal priority, $45 refund) and T-5 is resolved.
    assert "T-9" not in workflow.queue_ids() and "T-5" not in workflow.queue_ids()
    response = submit_tickets(workflow, "T-9", "T-5", note="Customer escalated by phone")
    assert response.status_code == 201
    batch = response.json()
    assert batch["total"] == 2 and batch["selection"]["source"] == "all_tickets"
    assert len(workflow.emails()) == 1  # one consolidated email
    links = workflow.links(workflow.emails()[0])
    assert sorted(links) == ["T-5", "T-9"]
    for ticket in ("T-5", "T-9"):
        request = workflow.client.get("/api/approvals", params={"ticket_id": ticket}).json()[0]
        assert request["status"] == "pending" and request["batch_id"] == batch["batch_id"]


def test_already_queued_ticket_reuses_its_queue_entry(workflow):
    item_id = workflow.item_ids_for("T-8")[0]
    assert submit_tickets(workflow, "T-8", "T-9").status_code == 201
    assert recommendations.QUEUE[item_id]["status"] == "submitted"
    assert [i for i in recommendations.QUEUE.values() if i["ticket_id"] == "T-8" and i["status"] == "queued"] == []
    assert "T-8" not in workflow.queue_ids()


def test_duplicate_pending_request_is_refused_and_nothing_is_created(workflow):
    submit_tickets(workflow, "T-9")
    before_requests = len(approvals.REQUESTS)
    before_items = len(recommendations.QUEUE)
    response = submit_tickets(workflow, "T-3", "T-9")  # T-9 is already with the manager
    assert response.status_code == 409
    assert "T-9 already has an open request" in response.json()["detail"]
    assert len(approvals.REQUESTS) == before_requests  # all-or-nothing
    assert len(recommendations.QUEUE) == before_items
    assert len(workflow.emails()) == 1


def test_legacy_pending_request_also_blocks(workflow):
    approvals.create_request("T-9", "normal")
    assert submit_tickets(workflow, "T-9").status_code == 409


def test_unknown_ticket_and_bad_bodies(workflow):
    assert submit_tickets(workflow, "NOPE-1").status_code == 409
    assert workflow.client.post("/api/control-center/batches", json={"ticket_ids": []}).status_code == 422
    assert workflow.client.post("/api/control-center/batches", json={"ticket_ids": ["T-9"], "item_ids": ["REC-1"]}).status_code == 422
    assert workflow.emails() == []


def test_decided_ticket_can_be_requested_again(workflow):
    submit_tickets(workflow, "T-9")
    links = workflow.links(workflow.emails()[0])
    workflow.client.post(links["T-9"]["reject"], data={"confirm": "yes"})
    assert submit_tickets(workflow, "T-9").status_code == 201


def test_awaiting_manager_data_includes_delivery_and_decisions(workflow):
    submit_tickets(workflow, "T-9", "T-8")
    links = workflow.links(workflow.emails()[0])
    workflow.client.post(links["T-8"]["approve"], data={"confirm": "yes", "note": "Fine"})
    requests = {r["ticket_id"]: r for r in workflow.client.get("/api/approvals").json()}
    assert requests["T-9"]["delivery"]["status"] == "saved_to_outbox"
    assert requests["T-9"]["delivery"]["delivered"] is False
    assert (requests["T-8"]["status"], requests["T-8"]["note"]) == ("approved", "Fine")
    assert workflow.client.get(f"/api/approvals/{requests['T-8']['request_id']}").json()["delivery"]["kind"] == "initial"


def test_ticket_already_with_manager_is_not_an_eligible_candidate(workflow):
    submit_tickets(workflow, "T-8")
    assert "T-8" not in workflow.queue_ids()
    body = workflow.client.post("/api/control-center/preview", json={"mode": "top", "count": 20}).json()
    assert "T-8" not in [i["ticket_id"] for i in body["items"]]
    recommendations.analyse_tickets(main.TICKETS)
    assert "T-8" not in workflow.queue_ids()


def test_opening_a_link_changes_nothing_and_sends_nothing(workflow):
    submit_tickets(workflow, "T-9")
    emails_before = len(workflow.emails())
    links = workflow.links(workflow.emails()[0])["T-9"]
    for path in links.values():
        assert workflow.client.get(path).status_code == 200
        token = path.rsplit("/", 1)[1]
        assert workflow.client.get(f"/api/manager/actions/{token}").json()["state"] == "ready"
    request = workflow.client.get("/api/approvals", params={"ticket_id": "T-9"}).json()[0]
    assert request["status"] == "pending" and request["employee_notifications"] == []
    assert len(workflow.emails()) == emails_before
