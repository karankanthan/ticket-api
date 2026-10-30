from conftest import EXPECTED_RANKING, SECRET_CUSTOMER_EMAIL

from app import main, recommendations


def test_detection_queues_only_tickets_needing_approval(workflow):
    # T-5 is resolved, T-6 has only a team-account label and a $200 refund, T-9 has no rule.
    assert sorted(workflow.queue_ids()) == sorted(EXPECTED_RANKING)


def test_team_account_label_alone_does_not_trigger(workflow):
    assert "T-6" not in workflow.queue_ids()
    items = workflow.client.get("/api/control-center/queue").json()["items"]
    t7 = next(i for i in items if i["ticket_id"] == "T-7")
    assert t7["reasons"] == ["team account closing"]


def test_refund_must_be_over_200(workflow):
    items = {i["ticket_id"]: i for i in workflow.client.get("/api/control-center/queue").json()["items"]}
    assert items["T-2"]["reasons"] == ["refund over $200"]
    assert items["T-2"]["refund_amount"] == 320


def test_reanalysing_does_not_duplicate(workflow):
    before = workflow.queue_ids()
    summary = recommendations.analyse_tickets(main.TICKETS)
    assert summary["added"] == 0
    assert workflow.queue_ids() == before


def test_import_endpoint_reloads_and_analyses(workflow):
    response = workflow.client.post("/api/control-center/import")
    assert response.status_code == 200
    assert response.json()["imported"] == 11
    assert response.json()["analysis"]["added"] == 0


def test_failed_import_keeps_current_tickets(workflow, monkeypatch, tmp_path):
    monkeypatch.setattr(main, "DATA_PATH", str(tmp_path / "missing.csv"))
    response = workflow.client.post("/api/control-center/import")
    assert response.status_code == 400
    assert len(main.TICKETS) == 11


def test_ranking_order(workflow):
    assert workflow.queue_ids() == EXPECTED_RANKING


def test_refund_breaks_ties(workflow):
    ids = workflow.queue_ids()
    assert ids.index("T-11") < ids.index("T-10")


def test_priority_filter(workflow):
    assert workflow.queue_ids(priority="urgent,high") == ["T-8", "T-1", "T-2"]


def test_unknown_priority_filter_is_422(workflow):
    assert workflow.client.get("/api/control-center/queue", params={"priority": "p9"}).status_code == 422


def test_queue_shows_sla(workflow):
    items = {i["ticket_id"]: i for i in workflow.client.get("/api/control-center/queue").json()["items"]}
    assert items["T-8"]["sla"]["state"] == "breached"
    assert items["T-8"]["sla"]["remaining_hours"] == -5
    assert items["T-1"]["sla"]["state"] == "on_track"


def test_queue_does_not_expose_customer_data(workflow):
    body = workflow.client.get("/api/control-center/queue").text
    assert SECRET_CUSTOMER_EMAIL not in body
    assert "riya" not in body


def test_preview_top_n(workflow):
    body = workflow.client.post("/api/control-center/preview", json={"mode": "top", "count": 5}).json()
    assert [i["ticket_id"] for i in body["items"]] == EXPECTED_RANKING[:5]
    assert body["warnings"] == []


def test_preview_top_n_with_filter(workflow):
    body = workflow.client.post(
        "/api/control-center/preview", json={"mode": "top", "count": 10, "priorities": ["urgent"]}
    ).json()
    assert [i["ticket_id"] for i in body["items"]] == ["T-8", "T-1"]
    assert "Only 2" in body["warnings"][0]


def test_preview_custom_count_over_limit_is_422(workflow):
    assert workflow.client.post("/api/control-center/preview", json={"mode": "top", "count": 101}).status_code == 422


def test_preview_manual_selection_keeps_rank_order(workflow):
    ids = workflow.item_ids_for("T-3", "T-8")
    body = workflow.client.post("/api/control-center/preview", json={"mode": "manual", "item_ids": ids}).json()
    assert [i["ticket_id"] for i in body["items"]] == ["T-8", "T-3"]


def test_preview_manual_unknown_item_is_409(workflow):
    response = workflow.client.post("/api/control-center/preview", json={"mode": "manual", "item_ids": ["REC-999"]})
    assert response.status_code == 409


def test_submit_batch_sends_one_email(workflow):
    batch = workflow.submit("T-8", "T-1", "T-4", note="Please review today")

    assert batch["status"] == "saved_to_outbox"
    assert batch["emails"][0]["delivered"] is False
    assert batch["counts"]["pending"] == 3

    emails = workflow.emails()
    assert len(emails) == 1
    links = workflow.links(emails[0])
    assert sorted(links) == ["T-1", "T-4", "T-8"]
    assert len({path for t in links.values() for path in t.values()}) == 9
    assert "Please review today" in emails[0].get_body(preferencelist=("plain",)).get_content()


def test_email_has_no_customer_data(workflow):
    workflow.submit("T-8", "T-2")
    raw = next(workflow.outbox.glob("*.eml")).read_text(encoding="utf-8")
    assert SECRET_CUSTOMER_EMAIL not in raw
    assert "riya" not in raw and "vip" not in raw


def test_submitted_items_leave_the_queue(workflow):
    workflow.submit("T-8", "T-1")
    assert workflow.queue_ids() == EXPECTED_RANKING[2:]


def test_same_item_cannot_be_submitted_twice(workflow):
    ids = workflow.item_ids_for("T-8")
    assert workflow.client.post("/api/control-center/batches", json={"item_ids": ids}).status_code == 201
    second = workflow.client.post("/api/control-center/batches", json={"item_ids": ids})
    assert second.status_code == 409
    assert len(workflow.emails()) == 1


def test_batch_with_any_invalid_item_sends_nothing(workflow):
    ids = workflow.item_ids_for("T-8") + ["REC-999"]
    assert workflow.client.post("/api/control-center/batches", json={"item_ids": ids}).status_code == 409
    assert workflow.emails() == []
    assert "T-8" in workflow.queue_ids()


def test_ticket_with_open_request_cannot_be_queued_again(workflow):
    workflow.submit("T-8")
    response = workflow.client.post("/api/control-center/queue", json={"ticket_id": "T-8"})
    assert response.status_code == 409
    assert "open approval request" in response.json()["detail"]


def test_manual_request_for_any_ticket(workflow):
    resolved = workflow.client.post("/api/control-center/queue", json={"ticket_id": "T-5", "note": "Goodwill refund"})
    no_rule = workflow.client.post("/api/control-center/queue", json={"ticket_id": "T-9", "refund_amount": 75})
    assert resolved.status_code == 201
    assert resolved.json()["source"] == "manual"
    assert no_rule.json()["reasons"] == []
    assert no_rule.json()["refund_amount"] == 75


def test_manual_duplicate_is_409(workflow):
    assert workflow.client.post("/api/control-center/queue", json={"ticket_id": "T-8"}).status_code == 409


def test_manual_unknown_ticket_is_404(workflow):
    assert workflow.client.post("/api/control-center/queue", json={"ticket_id": "T-404"}).status_code == 404


def test_dismissed_ticket_is_not_recommended_again(workflow):
    item_id = workflow.item_ids_for("T-4")[0]
    assert workflow.client.post(f"/api/control-center/queue/{item_id}/dismiss", json={"reason": "handled by phone"}).status_code == 200
    recommendations.analyse_tickets(main.TICKETS)
    assert "T-4" not in workflow.queue_ids()


def test_ticket_with_legacy_request_is_not_recommended(workflow):
    from app import approvals

    approvals.REQUESTS.clear()
    recommendations.QUEUE.clear()
    approvals.create_request("T-8", "urgent")
    recommendations.analyse_tickets(main.TICKETS)
    assert "T-8" not in workflow.queue_ids()


def test_batch_history(workflow):
    workflow.submit("T-8")
    workflow.submit("T-1", "T-4")
    batches = workflow.client.get("/api/control-center/batches").json()
    assert [b["total"] for b in batches] == [2, 1]
    detail = workflow.client.get(f"/api/control-center/batches/{batches[0]['batch_id']}").json()
    assert [r["ticket_id"] for r in detail["requests"]] == ["T-1", "T-4"]


def test_dashboard_counts(workflow):
    workflow.submit("T-8", "T-1")
    body = workflow.client.get("/api/dashboard").json()
    assert body["tickets"]["total"] == 11
    assert body["approvals"]["by_status"]["pending"] == 2
    assert body["approvals"]["pending_emailed"] == 2
    assert body["queue"]["queued"] == 6
    assert body["batches"]["total"] == 1
    assert body["email"]["delivers_real_email"] is False
    assert body["ticket_sla"]["closed"]["unknown"] == 1  # T-5 has no resolved date


def test_activity_history(workflow):
    workflow.submit("T-8")
    events = [e["event"] for e in workflow.client.get("/api/activity").json()]
    assert "batch_submitted" in events
    assert "email_initial" in events
    assert "tickets_analysed" in events
