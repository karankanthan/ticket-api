"""Edge cases and security checks from the pre-commit verification round."""

import threading
from dataclasses import replace

import pytest
from conftest import SECRET_CUSTOMER_EMAIL

from app import config, main, recommendations, ticket_imports


def preview(workflow, content, **body):
    return workflow.client.post("/api/imports/preview", json={"filename": "t.csv", "content": content, **body})


def commit(workflow, content, **body):
    mapping = preview(workflow, content).json()["mapping"]
    return workflow.client.post(
        "/api/imports", json={"filename": "t.csv", "content": content, "mapping": mapping, "skip_invalid": True, "acknowledge_removals": True, **body}
    )


# --- CSV import -------------------------------------------------------------

def test_blank_ticket_id_is_reported(workflow):
    body = preview(workflow, "id,created,status,priority\n,2026-10-30 10:00,open,P1\nA-2,2026-10-30 10:00,open,P2\n").json()
    assert (body["valid_rows"], body["invalid_rows"]) == (1, 1)
    assert body["errors"][0] == {"row": 2, "ticket_id": "", "field": "ticket_id", "message": "ticket ID is blank"}


def test_missing_optional_columns_still_import(workflow):
    body = preview(workflow, "id,created,status,priority\nA-1,2026-10-30 10:00,open,P1\n").json()
    assert body["valid_rows"] == 1 and body["invalid_rows"] == 0
    assert body["normalized_sample"][0]["category"] == ""
    assert body["normalized_sample"][0]["refund_amount"] == ""


@pytest.mark.parametrize("raw,expected", [
    ("P1", "urgent"), ("P2", "high"), ("P3", "normal"), ("P4", "low"),
    ("p1", "urgent"), ("1", "urgent"), ("4", "low"), ("P2 - High", "high"),
    ("Urgent", "urgent"), ("Critical", "urgent"), ("High", "high"), ("Medium", "normal"),
    ("Normal", "normal"), ("Low", "low"),
])
def test_priority_normalisation(workflow, raw, expected):
    body = preview(workflow, f"id,created,status,priority\nA-1,2026-10-30 10:00,open,{raw}\n").json()
    assert body["normalized_sample"][0]["priority"] == expected


@pytest.mark.parametrize("raw", ["P5", "P0", "whenever", ""])
def test_unknown_priority_is_invalid(workflow, raw):
    body = preview(workflow, f"id,created,status,priority\nA-1,2026-10-30 10:00,open,{raw}\n").json()
    assert body["invalid_rows"] == 1
    assert body["errors"][0]["field"] == "priority"


@pytest.mark.parametrize("raw,stored", [("12345.67", "12345.67"), ("$1,234,567.89", "1234567.89"), ("450.00", "450"), ("200", "200"), ("0.5", "0.5")])
def test_refund_amount_keeps_its_exact_value(workflow, raw, stored):
    body = preview(workflow, f'id,created,status,priority,refund\nA-1,2026-10-30 10:00,open,P3,"{raw}"\n').json()
    assert body["normalized_sample"][0]["refund_amount"] == stored


@pytest.mark.parametrize("raw", ["inf", "nan", "-inf", "abc", "-5"])
def test_unusable_refund_amount_is_unavailable_with_a_warning(workflow, raw):
    # Approved rule D6: an unusable optional value never becomes a refund and never costs the ticket.
    body = preview(workflow, f"id,created,status,priority,refund\nA-1,2026-10-30 10:00,open,P3,{raw}\n").json()
    assert body["invalid_rows"] == 0 and body["valid_rows"] == 1
    assert body["normalized_sample"][0]["refund_amount"] == ""  # unavailable: not 0, not inf
    assert body["quality"] == {"valid": 0, "with_warnings": 1, "invalid": 0}
    assert body["row_warnings"] == [{"line": 2, "ticket_id": "A-1", "message": f"Refund amount '{raw}' is not usable; treated as unavailable"}]


@pytest.mark.parametrize("raw", ["inf", "nan", "-3", "abc", ""])
def test_unusable_refund_in_source_csv_is_ignored(raw):
    from app.serializers import parse_refund

    assert parse_refund({"refund_amount": raw}) is None


def test_refund_threshold_through_import(workflow):
    content = (
        "id,created,status,priority,refund\n"
        "R-200,2026-10-30 10:00,open,P3,200\n"
        "R-200.00,2026-10-30 10:00,open,P3,$200.00\n"
        "R-200.01,2026-10-30 10:00,open,P3,200.01\n"
        "R-201,2026-10-30 10:00,open,P3,201\n"
    )
    assert commit(workflow, content).status_code == 201
    assert sorted(workflow.queue_ids()) == ["R-200.01", "R-201"]


def test_header_only_file_cannot_be_imported(workflow):
    response = commit(workflow, "id,created,status,priority\n")
    assert response.status_code == 422
    assert len(main.TICKETS) == 11


def test_non_csv_content_gives_mapping_error_not_crash(workflow):
    body = preview(workflow, "\x89PNG\r\n\x1a\n binary-looking text").json()
    assert body["ready"] is False
    assert body["mapping_error"]


def test_mapping_to_unknown_column_is_rejected(workflow):
    mapping = {"ticket_id": "Nope", "created_at": "created", "status": "status", "priority": "priority"}
    body = preview(workflow, "id,created,status,priority\nA-1,2026-10-30 10:00,open,P1\n", mapping=mapping).json()
    assert "not in the file" in body["mapping_error"]


def test_same_file_imported_twice_creates_no_duplicates(workflow):
    content = "id,created,status,priority\nA-1,2026-10-30 10:00,open,P1\nA-2,2026-10-30 10:00,open,P2\n"
    assert commit(workflow, content).status_code == 201
    second = commit(workflow, content)
    assert second.status_code == 201
    assert second.json()["analysis"]["added"] == 0
    assert workflow.queue_ids() == ["A-1"]
    assert [e["status"] for e in workflow.client.get("/api/imports").json()["imports"]] == ["completed", "completed"]


# --- Selection and batches --------------------------------------------------

def test_top_20_with_fewer_eligible_warns(workflow):
    body = workflow.client.post("/api/control-center/preview", json={"mode": "top", "count": 20}).json()
    assert body["selected_count"] == 8
    assert body["warnings"] == ["Only 8 eligible tickets are in the queue; 20 were requested."]


def test_custom_count(workflow):
    body = workflow.client.post("/api/control-center/preview", json={"mode": "top", "count": 3}).json()
    assert [i["ticket_id"] for i in body["items"]] == ["T-8", "T-1", "T-4"]


@pytest.mark.parametrize("count", [0, -1, 101])
def test_invalid_batch_size(workflow, count):
    assert workflow.client.post("/api/control-center/preview", json={"mode": "top", "count": count}).status_code == 422


def test_empty_batch_is_rejected(workflow):
    assert workflow.client.post("/api/control-center/batches", json={"item_ids": []}).status_code == 422
    assert workflow.client.post("/api/control-center/batches", json={}).status_code == 422
    assert workflow.emails() == []


def test_too_many_items_in_one_batch(workflow, monkeypatch):
    monkeypatch.setattr(config, "settings", replace(config.settings, max_batch_size=2))
    ids = workflow.item_ids_for("T-8", "T-1", "T-4")
    response = workflow.client.post("/api/control-center/batches", json={"item_ids": ids})
    assert response.status_code == 422
    assert workflow.emails() == []


def test_pending_ticket_is_excluded_from_next_top_n(workflow):
    workflow.submit("T-8", "T-1")
    body = workflow.client.post("/api/control-center/preview", json={"mode": "top", "count": 5}).json()
    assert "T-8" not in [i["ticket_id"] for i in body["items"]]
    assert "T-1" not in [i["ticket_id"] for i in body["items"]]


# --- API validation and auth ------------------------------------------------

def test_malformed_and_missing_bodies(workflow):
    c = workflow.client
    assert c.post("/api/control-center/preview", content=b"{not json", headers={"Content-Type": "application/json"}).status_code == 422
    assert c.post("/api/control-center/preview", json={"mode": "everything"}).status_code == 422
    assert c.post("/api/control-center/queue", json={}).status_code == 422
    assert c.post("/api/control-center/queue", json={"ticket_id": "T-9", "refund_amount": -1}).status_code == 422
    assert c.post("/api/imports", json={"content": "x"}).status_code == 422
    assert c.post("/api/approvals/REQ-1/provide-info", json={"note": ""}).status_code == 422
    assert c.get("/api/control-center/batches/BATCH-999").status_code == 404


def test_production_mode_rejects_missing_or_wrong_key(workflow, monkeypatch):
    monkeypatch.setattr(config, "settings", replace(config.settings, app_env="production", admin_api_key="prod-key"))
    c = workflow.client
    for path in ("/api/dashboard", "/api/tickets", "/api/settings", "/api/imports", "/api/activity"):
        assert c.get(path).status_code == 401
        assert c.get(path, headers={"X-Admin-Key": "wrong"}).status_code == 401
        assert c.get(path, headers={"X-Admin-Key": "prod-key"}).status_code == 200
    assert c.post("/api/control-center/batches", json={"item_ids": ["REC-1"]}).status_code == 401
    assert workflow.emails() == []


# --- Manager actions --------------------------------------------------------

def test_concurrent_conflicting_clicks_record_one_decision(workflow):
    workflow.submit("T-8")
    links = workflow.links(workflow.emails()[-1])["T-8"]
    results = []

    def click(path):
        results.append(workflow.client.post(path, data={"confirm": "yes", "note": "x"}).status_code)

    threads = [threading.Thread(target=click, args=(links[action],)) for action in ("approve", "reject", "approve", "reject")]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert sorted(results) == [200, 409, 409, 409]
    request = workflow.client.get("/api/approvals", params={"ticket_id": "T-8"}).json()[0]
    decisions = [h for h in request["history"] if h["event"] in ("approve", "reject")]
    assert len(decisions) == 1


def test_missing_manager_email_with_file_backend_is_labelled(workflow):
    batch = workflow.submit("T-8")
    raw = next(workflow.outbox.glob("*.eml")).read_text(encoding="utf-8")
    assert "manager-email-not-configured@localhost" in raw
    assert batch["emails"][0]["delivered"] is False
    status = workflow.client.get("/api/email/status").json()
    assert "MANAGER_EMAIL is not set." in status["warnings"]


# --- Privacy ----------------------------------------------------------------

def test_no_customer_email_anywhere_after_full_workflow(workflow):
    workflow.submit("T-8", "T-2")
    links = workflow.links(workflow.emails()[0])
    workflow.client.post(links["T-8"]["approve"], data={"confirm": "yes"})
    token = links["T-2"]["reject"].rsplit("/", 1)[1]
    paths = [
        "/api/dashboard", "/api/tickets", "/api/tickets/T-8", "/api/control-center/queue",
        "/api/control-center/batches", "/api/control-center/batches/BATCH-1", "/api/approvals",
        "/api/activity", "/api/settings", "/api/email/status", "/api/imports", "/approval-requests",
        f"/api/manager/actions/{token}", f"/act/{token}", "/tickets?page=1&size=100",
    ]
    for path in paths:
        assert SECRET_CUSTOMER_EMAIL not in workflow.client.get(path).text, path
    for eml in workflow.outbox.glob("*.eml"):
        assert SECRET_CUSTOMER_EMAIL not in eml.read_text(encoding="utf-8")
    for store in (ticket_imports.IMPORTS, recommendations.QUEUE):
        assert SECRET_CUSTOMER_EMAIL not in store.path.read_text(encoding="utf-8") if store.path.exists() else True
