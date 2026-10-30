import pytest

from app import clock
from app.approvals import REQUESTS, apply_action, create_request
from app.store import PersistentDict


@pytest.fixture(autouse=True)
def clear_requests():
    REQUESTS.clear()


def reload_from_disk():
    return PersistentDict(REQUESTS.path)


def test_created_request_is_on_disk():
    request = create_request("TCK-1001", "urgent")
    assert reload_from_disk()[request["request_id"]]["status"] == "pending"


def test_decision_is_on_disk():
    request = create_request("TCK-1001", "normal")
    apply_action(request["request_id"], "reject")
    assert reload_from_disk()[request["request_id"]]["status"] == "rejected"


def test_ids_are_not_reused_after_restart():
    first = create_request("TCK-1001", "normal")
    restarted = reload_from_disk()
    assert restarted.next_id("REQ") != first["request_id"]


def test_history_records_each_step(monkeypatch):
    times = iter(["2026-10-30T09:00:00+05:30", "2026-10-30T10:00:00+05:30", "2026-10-30T11:00:00+05:30"])
    monkeypatch.setattr(clock, "timestamp", lambda: next(times))

    request = create_request("TCK-1001", "normal")
    apply_action(request["request_id"], "need_more_info", "Add invoice number", via="email")
    result = apply_action(request["request_id"], "approve", via="email")

    assert [(h["event"], h["status"], h["via"]) for h in result["history"]] == [
        ("created", "pending", "api"),
        ("need_more_info", "info_requested", "email"),
        ("approve", "approved", "email"),
    ]
    assert result["created_at"] == "2026-10-30T09:00:00+05:30"
    assert result["decided_at"] == "2026-10-30T11:00:00+05:30"


def test_info_request_is_not_a_final_decision():
    request = create_request("TCK-1001", "normal")
    result = apply_action(request["request_id"], "need_more_info", "Add invoice number")
    assert result["decided_at"] is None


def test_failed_action_does_not_add_history():
    request = create_request("TCK-1001", "normal")
    with pytest.raises(ValueError):
        apply_action(request["request_id"], "need_more_info", "  ")
    assert len(reload_from_disk()[request["request_id"]]["history"]) == 1
