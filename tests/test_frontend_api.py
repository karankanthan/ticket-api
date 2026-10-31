"""Backend endpoints added for the TicketFlow web app."""

from conftest import SECRET_CUSTOMER_EMAIL

from app import main, ticket_imports

EXPORT = """Case Number;Opened;State;Severity;Type;Agent;Requester Email;Refund;Title
C-1;2026-10-30 10:00;Open;P1;Billing;riya;{email};;Charged twice
C-2;2026-10-29 09:30;In Progress;P2 - High;Refunds;sam;{email};$450.00;Refund please
C-3;not a date;Open;P3;Shipping;tom;{email};;Late
C-4;2026-10-28 08:00;Solved;Low;Login;ken;{email};;Reset
C-2;2026-10-28 08:00;Open;P3;Login;ken;{email};;Duplicate id
""".format(email=SECRET_CUSTOMER_EMAIL)


def preview(workflow, **body):
    return workflow.client.post("/api/imports/preview", json={"filename": "export.csv", "content": EXPORT, **body})


def test_tickets_list_has_sla_and_approval_but_no_customer_email(workflow):
    body = workflow.client.get("/api/tickets").json()
    assert body["total"] == 11
    tickets = {t["ticket_id"]: t for t in body["tickets"]}
    assert tickets["T-8"]["approval"]["status"] == "queued"
    assert tickets["T-9"]["approval"]["status"] == "none"
    assert tickets["T-1"]["assigned_to"] == "riya"
    assert tickets["T-8"]["sla"]["state"] == "breached"
    assert SECRET_CUSTOMER_EMAIL not in workflow.client.get("/api/tickets").text


def test_ticket_status_follows_requests(workflow):
    workflow.submit("T-8")
    ticket = workflow.client.get("/api/tickets/T-8").json()
    assert ticket["approval"]["status"] == "pending"
    assert ticket["requests"][0]["batch_id"] == "BATCH-1"
    assert workflow.client.get("/api/tickets/T-404").status_code == 404


def test_import_preview_detects_columns_and_hides_emails(workflow):
    body = preview(workflow).json()
    assert body["delimiter"] == "semicolon"
    assert body["mapping"]["ticket_id"] == "Case Number"
    assert body["mapping"]["priority"] == "Severity"
    assert body["mapping"]["refund_amount"] == "Refund"
    assert body["excluded_sensitive_columns"] == ["Requester Email"]
    assert SECRET_CUSTOMER_EMAIL not in str(body)
    assert (body["valid_rows"], body["invalid_rows"]) == (3, 2)
    assert {e["field"] for e in body["errors"]} == {"created_at", "ticket_id"}
    first = body["normalized_sample"][0]
    assert (first["priority"], first["status"]) == ("urgent", "open")
    assert body["normalized_sample"][1]["refund_amount"] == "450"


def test_import_preview_with_missing_required_mapping(workflow):
    mapping = {**preview(workflow).json()["mapping"], "priority": None}
    body = preview(workflow, mapping=mapping).json()
    assert body["ready"] is False
    assert "Priority" in body["mapping_error"]


def test_import_refuses_invalid_rows_unless_skipped(workflow):
    mapping = preview(workflow).json()["mapping"]
    refused = workflow.client.post("/api/imports", json={"filename": "export.csv", "content": EXPORT, "mapping": mapping})
    assert refused.status_code == 422
    assert len(main.TICKETS) == 11  # current tickets kept

    done = workflow.client.post(
        "/api/imports", json={"filename": "export.csv", "content": EXPORT, "mapping": mapping, "skip_invalid": True, "acknowledge_removals": True}
    )
    assert done.status_code == 201
    assert done.json()["imported_rows"] == 3
    assert sorted(t["ticket_id"] for t in main.TICKETS) == ["C-1", "C-2", "C-4"]
    assert done.json()["analysis"]["added"] == 2  # C-1 urgent, C-2 refund over $200

    stored = (ticket_imports.IMPORT_DIR / done.json()["file"]).read_text(encoding="utf-8")
    assert SECRET_CUSTOMER_EMAIL not in stored

    history = workflow.client.get("/api/imports").json()
    assert [e["status"] for e in history["imports"]] == ["completed", "failed"]
    assert history["active_file"].endswith(done.json()["file"])


def test_import_withdraws_queue_items_for_tickets_no_longer_present(workflow):
    mapping = preview(workflow).json()["mapping"]
    workflow.client.post(
        "/api/imports", json={"filename": "export.csv", "content": EXPORT, "mapping": mapping, "skip_invalid": True, "acknowledge_removals": True}
    )
    assert sorted(workflow.queue_ids()) == ["C-1", "C-2"]


def test_import_of_garbage_keeps_tickets(workflow):
    response = workflow.client.post("/api/imports", json={"filename": "x.csv", "content": "  ", "mapping": {}})
    assert response.status_code == 422
    assert len(main.TICKETS) == 11


def test_day_first_dates(workflow):
    content = "id,created,status,priority\nA-1,25/10/2026 14:30,open,high\n"
    auto = workflow.client.post("/api/imports/preview", json={"content": content}).json()
    assert auto["invalid_rows"] == 1
    day_first = workflow.client.post("/api/imports/preview", json={"content": content, "date_format": "DD/MM/YYYY"}).json()
    assert day_first["normalized_sample"][0]["created_at"] == "2026-10-25 14:30"


def test_settings_never_expose_secrets(workflow, monkeypatch):
    from dataclasses import replace
    from app import config

    monkeypatch.setattr(config, "settings", replace(config.settings, admin_api_key="admin-secret-xyz", smtp_password="smtp-secret-xyz"))
    body = workflow.client.get("/api/settings", headers={"X-Admin-Key": "admin-secret-xyz"})
    assert body.status_code == 200
    assert "admin-secret-xyz" not in body.text and "smtp-secret-xyz" not in body.text
    assert body.json()["environment"]["admin_key_required"] is True
    assert body.json()["sla"]["ticket_sla_hours"]["low"] == 72


def test_batch_list_has_priority_breakdown(workflow):
    workflow.submit("T-8", "T-1", "T-2")
    batch = workflow.client.get("/api/control-center/batches").json()[0]
    assert batch["priorities"] == {"urgent": 2, "high": 1}


def manager_token(workflow, ticket="T-8", action="approve"):
    workflow.submit(ticket)
    return workflow.links(workflow.emails()[-1])[ticket][action].rsplit("/", 1)[1]


def test_manager_json_get_changes_nothing(workflow):
    token = manager_token(workflow)
    body = workflow.client.get(f"/api/manager/actions/{token}")
    assert body.status_code == 200
    assert body.headers["cache-control"] == "no-store"
    assert body.json()["state"] == "ready"
    assert body.json()["request"]["status"] == "pending"
    assert body.json()["request"]["priority"] == "urgent"


def test_manager_json_needs_confirmation_then_decides_once(workflow):
    token = manager_token(workflow)
    unconfirmed = workflow.client.post(f"/api/manager/actions/{token}", json={})
    assert (unconfirmed.status_code, unconfirmed.json()["state"]) == (400, "needs_confirmation")

    done = workflow.client.post(f"/api/manager/actions/{token}", json={"confirm": True, "note": "OK"})
    assert (done.status_code, done.json()["state"]) == (200, "done")
    assert done.json()["request"]["status"] == "approved"

    again = workflow.client.post(f"/api/manager/actions/{token}", json={"confirm": True})
    assert (again.status_code, again.json()["state"]) == (409, "used")


def test_manager_json_more_info_needs_note(workflow):
    token = manager_token(workflow, action="need_more_info")
    response = workflow.client.post(f"/api/manager/actions/{token}", json={"confirm": True, "note": " "})
    assert (response.status_code, response.json()["state"]) == (400, "invalid_note")


def test_manager_json_expired_and_invalid(workflow):
    from datetime import timedelta
    from conftest import NOW

    token = manager_token(workflow)
    workflow.set_time(NOW + timedelta(hours=73))
    assert workflow.client.get(f"/api/manager/actions/{token}").json()["state"] == "expired"
    assert workflow.client.get("/api/manager/actions/nope").status_code == 404


def test_manager_json_needs_no_admin_key(workflow, monkeypatch):
    from dataclasses import replace
    from app import config

    token = manager_token(workflow)
    monkeypatch.setattr(config, "settings", replace(config.settings, admin_api_key="k"))
    assert workflow.client.get(f"/api/manager/actions/{token}").status_code == 200
