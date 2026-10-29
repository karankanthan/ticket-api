import pytest

from app.approvals import REQUESTS, apply_action, create_request


@pytest.fixture(autouse=True)
def clear_requests():
    REQUESTS.clear()


def test_new_request_is_pending():
    request = create_request("TCK-1001", "normal")
    assert request["status"] == "pending"
    assert request["escalated"] is False


def test_urgent_request_is_escalated():
    request = create_request("TCK-1001", "urgent")
    assert request["escalated"] is True
    assert request["escalation_reasons"] == ["urgent ticket"]


def test_approve():
    request = create_request("TCK-1001", "normal")
    assert apply_action(request["request_id"], "approve")["status"] == "approved"


def test_reject():
    request = create_request("TCK-1001", "normal")
    assert apply_action(request["request_id"], "reject")["status"] == "rejected"


def test_need_more_info_saves_note():
    request = create_request("TCK-1001", "normal")
    result = apply_action(request["request_id"], "need_more_info", "Add invoice number")
    assert result["status"] == "info_requested"
    assert result["note"] == "Add invoice number"


def test_need_more_info_without_note_fails():
    request = create_request("TCK-1001", "normal")
    with pytest.raises(ValueError):
        apply_action(request["request_id"], "need_more_info")


def test_can_approve_after_info_requested():
    request = create_request("TCK-1001", "normal")
    apply_action(request["request_id"], "need_more_info", "Add invoice number")
    assert apply_action(request["request_id"], "approve")["status"] == "approved"


def test_decided_request_cannot_change():
    request = create_request("TCK-1001", "normal")
    apply_action(request["request_id"], "approve")
    with pytest.raises(ValueError):
        apply_action(request["request_id"], "reject")


def test_unknown_action_fails():
    request = create_request("TCK-1001", "normal")
    with pytest.raises(ValueError):
        apply_action(request["request_id"], "delete")


def test_unknown_request_fails():
    with pytest.raises(LookupError):
        apply_action("REQ-999", "approve")


def test_request_saves_ticket_details():
    ticket = {"ticket_id": "TCK-1001", "category": "Billing", "priority": "urgent"}
    request = create_request("TCK-1001", "urgent", ticket=ticket)
    assert request["ticket"] == ticket