import pytest
from fastapi.testclient import TestClient

from app.main import app, load_tickets

client = TestClient(app)


def test_summary_has_categories():
    body = client.get("/summary").json()

    assert body["total"] == 60
    assert "Billing" in body["by_category"]

    billing = body["by_category"]["Billing"]
    assert billing["ticket_count"] == 9
    assert billing["average_resolution_hours"] == 37.9



def test_first_page_has_ten_tickets():
    body = client.get("/tickets?page=1&size=10").json()
    assert len(body) == 10
    assert body[0]["ticket_id"] == "TCK-1001"

def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}

def test_unknown_ticket_is_404():
    assert client.get("/tickets/TCK-0000").status_code == 404

def test_missing_data_file_gives_clear_error():
    with pytest.raises(RuntimeError, match="Ticket data file not found"):
        load_tickets("does/not/exist.csv")

NEW_FORMAT_CSV = (
    "ticket_id,created_at,status,priority,category,refund_amount\n"
    "TCK-9001,2026-10-05 13:05,open,urgent,Billing,320\n"
)


def test_file_without_resolved_at_still_loads(tmp_path):
    path = tmp_path / "export.csv"
    path.write_text(NEW_FORMAT_CSV)
    tickets = load_tickets(path)

    assert tickets[0]["resolved_at"] == ""
    assert tickets[0]["resolved"] is None


def test_summary_gives_clear_error_without_resolved_at(
    tmp_path, monkeypatch
):
    path = tmp_path / "export.csv"
    path.write_text(NEW_FORMAT_CSV)

    monkeypatch.setattr("app.main.DATA_PATH", str(path))
    response = client.get("/summary")

    assert response.status_code == 503
    assert "resolved_at" in response.json()["detail"]
