import pytest
from fastapi.testclient import TestClient

from app.approvals import REQUESTS
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def clear_requests():
    REQUESTS.clear()


def create(body):
    return client.post("/approval-requests", json=body)


def act(request_id, body):
    return client.post(f"/approval-requests/{request_id}/actions", json=body)


def test_create_request_for_urgent_ticket():
    response = create({"ticket_id": "TCK-1001"})
    assert response.status_code == 201
    assert response.json()["status"] == "pending"
    assert response.json()["escalation_reasons"] == ["urgent ticket"]


def test_create_request_with_large_refund():
    body = create({"ticket_id": "TCK-1003", "refund_amount": 250}).json()
    assert body["escalation_reasons"] == ["refund over $200"]


def test_unknown_ticket_is_404():
    assert create({"ticket_id": "TCK-0000"}).status_code == 404


def test_negative_refund_is_422():
    assert create({"ticket_id": "TCK-1003", "refund_amount": -5}).status_code == 422


def test_approve_through_api():
    request_id = create({"ticket_id": "TCK-1003"}).json()["request_id"]
    response = act(request_id, {"action": "approve"})
    assert response.status_code == 200
    assert response.json()["status"] == "approved"


def test_need_more_info_without_note_is_400():
    request_id = create({"ticket_id": "TCK-1003"}).json()["request_id"]
    assert act(request_id, {"action": "need_more_info"}).status_code == 400


def test_action_on_unknown_request_is_404():
    assert act("REQ-999", {"action": "approve"}).status_code == 404


def test_list_shows_created_requests():
    create({"ticket_id": "TCK-1001"})
    create({"ticket_id": "TCK-1003"})
    assert len(client.get("/approval-requests").json()) == 2