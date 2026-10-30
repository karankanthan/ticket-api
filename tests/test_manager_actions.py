from datetime import timedelta

from conftest import NOW

from app import tokens


def approval(workflow, request_id):
    return workflow.client.get(f"/api/approvals/{request_id}").json()


def setup_batch(workflow, *ticket_ids):
    batch = workflow.submit(*ticket_ids)
    links = workflow.links(workflow.emails()[-1])
    request_for = {
        r["ticket_id"]: r["request_id"]
        for r in workflow.client.get(f"/api/control-center/batches/{batch['batch_id']}").json()["requests"]
    }
    return batch, links, request_for


def confirm(workflow, path, note=""):
    return workflow.client.post(path, data={"confirm": "yes", "note": note})


def test_get_never_changes_anything(workflow):
    _, links, ids = setup_batch(workflow, "T-8")
    for path in links["T-8"].values():
        page = workflow.client.get(path)
        assert page.status_code == 200
        assert "<form method=\"post\">" in page.text
    assert approval(workflow, ids["T-8"])["status"] == "pending"


def test_pages_are_not_cached_or_leaked(workflow):
    _, links, _ = setup_batch(workflow, "T-8")
    page = workflow.client.get(links["T-8"]["approve"])
    assert page.headers["cache-control"] == "no-store"
    assert page.headers["referrer-policy"] == "no-referrer"
    assert "frame-ancestors 'none'" in page.headers["content-security-policy"]


def test_manager_approves(workflow):
    _, links, ids = setup_batch(workflow, "T-8", "T-1")
    response = confirm(workflow, links["T-8"]["approve"], "Fine")
    assert response.status_code == 200
    assert "Approved" in response.text

    request = approval(workflow, ids["T-8"])
    assert request["status"] == "approved"
    assert request["note"] == "Fine"
    assert request["history"][-1]["via"] == "email"
    assert approval(workflow, ids["T-1"])["status"] == "pending"


def test_manager_rejects(workflow):
    _, links, ids = setup_batch(workflow, "T-8")
    confirm(workflow, links["T-8"]["reject"], "Not eligible")
    request = approval(workflow, ids["T-8"])
    assert (request["status"], request["note"]) == ("rejected", "Not eligible")


def test_more_info_needs_a_note(workflow):
    _, links, ids = setup_batch(workflow, "T-8")
    response = confirm(workflow, links["T-8"]["need_more_info"], "  ")
    assert response.status_code == 400
    assert approval(workflow, ids["T-8"])["status"] == "pending"
    # the link was not used up by the failed attempt
    assert confirm(workflow, links["T-8"]["need_more_info"], "Which invoice?").status_code == 200
    assert approval(workflow, ids["T-8"])["status"] == "info_requested"


def test_post_without_confirmation_is_rejected(workflow):
    _, links, ids = setup_batch(workflow, "T-8")
    assert workflow.client.post(links["T-8"]["approve"], data={}).status_code == 400
    assert approval(workflow, ids["T-8"])["status"] == "pending"


def test_link_cannot_be_reused(workflow):
    _, links, _ = setup_batch(workflow, "T-8")
    confirm(workflow, links["T-8"]["approve"])
    again = confirm(workflow, links["T-8"]["approve"])
    assert again.status_code == 409
    assert "already been used" in again.text


def test_other_links_stop_working_after_a_decision(workflow):
    _, links, ids = setup_batch(workflow, "T-8")
    confirm(workflow, links["T-8"]["approve"])
    conflicting = confirm(workflow, links["T-8"]["reject"])
    assert conflicting.status_code == 409
    assert approval(workflow, ids["T-8"])["status"] == "approved"


def test_expired_link(workflow):
    _, links, ids = setup_batch(workflow, "T-8")
    workflow.set_time(NOW + timedelta(hours=72, minutes=1))
    assert workflow.client.get(links["T-8"]["approve"]).status_code == 410
    assert confirm(workflow, links["T-8"]["approve"]).status_code == 410
    assert approval(workflow, ids["T-8"])["status"] == "pending"


def test_unknown_or_tampered_link(workflow):
    _, links, _ = setup_batch(workflow, "T-8")
    assert workflow.client.get("/act/not-a-real-token").status_code == 404
    assert confirm(workflow, links["T-8"]["approve"][:-2] + "xx").status_code == 404


def test_decision_through_old_api_closes_email_links(workflow):
    _, links, ids = setup_batch(workflow, "T-8")
    workflow.client.post(f"/approval-requests/{ids['T-8']}/actions", json={"action": "reject"})
    response = confirm(workflow, links["T-8"]["approve"])
    assert response.status_code == 409
    assert approval(workflow, ids["T-8"])["status"] == "rejected"


def test_only_token_hashes_are_stored(workflow):
    _, links, _ = setup_batch(workflow, "T-8")
    stored = tokens.TOKENS.path.read_text(encoding="utf-8")
    for path in links["T-8"].values():
        raw = path.rsplit("/", 1)[1]
        assert raw not in stored
        assert tokens.hash_token(raw) in stored


def test_more_info_round_trip(workflow):
    _, links, ids = setup_batch(workflow, "T-8")
    confirm(workflow, links["T-8"]["need_more_info"], "Which invoice?")

    answered = workflow.client.post(f"/api/approvals/{ids['T-8']}/provide-info", json={"note": "Invoice 8841"})
    assert answered.status_code == 200
    assert "T-8" in workflow.queue_ids()

    workflow.submit("T-8")
    assert approval(workflow, ids["T-8"])["status"] == "pending"
    new_links = workflow.links(workflow.emails()[-1])
    confirm(workflow, new_links["T-8"]["approve"])

    request = approval(workflow, ids["T-8"])
    assert request["status"] == "approved"
    assert [h["event"] for h in request["history"]] == [
        "created", "need_more_info", "info_provided", "resubmitted", "approve",
    ]


def test_decision_shows_in_dashboard_and_history(workflow):
    _, links, ids = setup_batch(workflow, "T-8", "T-1")
    confirm(workflow, links["T-8"]["approve"])
    confirm(workflow, links["T-1"]["reject"], "No")

    dashboard = workflow.client.get("/api/dashboard").json()
    assert dashboard["approvals"]["by_status"]["approved"] == 1
    assert dashboard["approvals"]["by_status"]["rejected"] == 1
    history = workflow.client.get("/api/approvals", params={"status": "approved"}).json()
    assert [r["ticket_id"] for r in history] == ["T-8"]
    decisions = workflow.client.get("/api/activity", params={"event": "decision"}).json()
    assert len(decisions) == 2
