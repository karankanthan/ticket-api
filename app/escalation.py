REFUND_THRESHOLD = 200


def escalation_reasons(priority, refund_amount, team_account_closing):
    reasons = []

    if priority == "urgent":
        reasons.append("urgent ticket")

    if refund_amount is not None and refund_amount > REFUND_THRESHOLD:
        reasons.append("refund over $200")

    if team_account_closing:
        reasons.append("team account closing")

    return reasons