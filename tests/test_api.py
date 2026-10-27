from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_summary_has_categories():
    body = client.get("/summary").json()
    assert body["total"] > 0
    assert "Billing" in body["by_category"]


def test_first_page_has_ten_tickets():
    body = client.get("/tickets?page=1&size=10").json()
    assert len(body) == 10
    assert body[0]["ticket_id"] == "TCK-1001"

def test_unknown_ticket_is_404():
    assert client.get("/tickets/TCK-0000").status_code == 404


def test_summary_has_categories():
    body = client.get("/summary").json()

    assert body["total"] > 0
    assert "Billing" in body["by_category"]

    billing = body["by_category"]["Billing"]
    assert "ticket_count" in billing
    assert "average_resolution_hours" in billing
    assert billing["ticket_count"] > 0
