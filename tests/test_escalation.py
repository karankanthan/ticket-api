from app.escalation import escalation_reasons


def test_normal_request_is_not_escalated():
    assert escalation_reasons("normal", None, False) == []


def test_urgent_ticket_is_escalated():
    assert escalation_reasons("urgent", None, False) == ["urgent ticket"]


def test_refund_of_exactly_200_is_not_escalated():
    assert escalation_reasons("normal", 200, False) == []


def test_refund_just_over_200_is_escalated():
    assert escalation_reasons("normal", 200.01, False) == ["refund over $200"]


def test_closing_team_account_is_escalated():
    assert escalation_reasons("low", None, True) == ["team account closing"]


def test_multiple_reasons_are_all_listed():
    reasons = escalation_reasons("urgent", 500, True)
    assert reasons == ["urgent ticket", "refund over $200", "team account closing"]