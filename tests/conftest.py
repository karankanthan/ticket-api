import atexit
import os
import shutil
import tempfile

os.environ.setdefault("TICKETS_DATA_PATH", "data/tickets_sample.csv")

# Keep test runs away from the real data/store folder.
_store_dir = tempfile.mkdtemp(prefix="ticket-api-test-store-")
os.environ["APP_STORE_DIR"] = _store_dir
os.environ["APP_ENV"] = "local"
atexit.register(shutil.rmtree, _store_dir, ignore_errors=True)
os.environ["SCHEDULER_ENABLED"] = "false"
os.environ["EMAIL_BACKEND"] = "file"
os.environ["EMAIL_OUTBOX_DIR"] = os.path.join(_store_dir, "outbox")
os.environ["PUBLIC_BASE_URL"] = "http://testserver"
# Blank, not removed: python-dotenv only skips variables that already exist, so removing
# them would let a developer's .env (manager email, SMTP App Password) leak into tests.
for _name in ("ADMIN_API_KEY", "MANAGER_EMAIL", "MANAGER_NAME", "EMAIL_FROM", "FROM_EMAIL", "SMTP_HOST", "SMTP_USERNAME", "SMTP_PASSWORD"):
    os.environ[_name] = ""
os.environ["SMTP_PORT"] = "587"
os.environ["SMTP_SECURITY"] = "starttls"


import email
import email.policy
import re
from datetime import datetime
from pathlib import Path

import pytest

NOW = datetime(2026, 10, 30, 12, 0).astimezone()
SECRET_CUSTOMER_EMAIL = "customer.private@example.com"

# Helpdesk-export format. Times are relative to NOW (2026-10-30 12:00).
WORKFLOW_CSV = f"""ticket_id,created_at,status,priority,category,assigned_to,customer_email,labels,refund_amount,team_account_closing
T-1,2026-10-30 10:00,open,urgent,Billing,riya,{SECRET_CUSTOMER_EMAIL},,,
T-2,2026-10-29 12:00,open,high,Refunds,sam,{SECRET_CUSTOMER_EMAIL},vip,320,
T-3,2026-10-30 06:00,in_progress,normal,Refunds,tom,{SECRET_CUSTOMER_EMAIL},,480,
T-4,2026-10-20 12:00,open,low,Refunds,ken,{SECRET_CUSTOMER_EMAIL},,900,
T-5,2026-10-30 09:00,resolved,urgent,Billing,zoe,{SECRET_CUSTOMER_EMAIL},,,
T-6,2026-10-30 09:00,open,normal,Account,lia,{SECRET_CUSTOMER_EMAIL},team-account,200,
T-7,2026-10-30 00:00,open,normal,Account,lia,{SECRET_CUSTOMER_EMAIL},,,yes
T-8,2026-10-30 03:00,open,urgent,Technical,riya,{SECRET_CUSTOMER_EMAIL},,,
T-9,2026-10-30 09:00,open,normal,Shipping,sam,{SECRET_CUSTOMER_EMAIL},,45,
T-10,2026-10-30 08:00,open,normal,Refunds,tom,{SECRET_CUSTOMER_EMAIL},,250,
T-11,2026-10-30 08:00,open,normal,Refunds,tom,{SECRET_CUSTOMER_EMAIL},,600,
"""
EXPECTED_RANKING = ["T-8", "T-1", "T-4", "T-2", "T-7", "T-3", "T-11", "T-10"]


class Workflow:
    def __init__(self, client, clock_state, outbox):
        self.client = client
        self.clock_state = clock_state
        self.outbox = outbox

    def set_time(self, when):
        self.clock_state["now"] = when

    def queue_ids(self, **params):
        return [i["ticket_id"] for i in self.client.get("/api/control-center/queue", params=params).json()["items"]]

    def item_ids_for(self, *ticket_ids):
        items = self.client.get("/api/control-center/queue").json()["items"]
        by_ticket = {i["ticket_id"]: i["item_id"] for i in items}
        return [by_ticket[t] for t in ticket_ids]

    def submit(self, *ticket_ids, note=None):
        response = self.client.post(
            "/api/control-center/batches",
            json={"item_ids": self.item_ids_for(*ticket_ids), "note": note},
        )
        assert response.status_code == 201, response.text
        return response.json()

    def emails(self):
        files = sorted(Path(self.outbox).glob("*.eml"))
        return [email.message_from_bytes(f.read_bytes(), policy=email.policy.default) for f in files]

    def links(self, message):
        """{ticket_id: {action: path}} from the plain-text part of an email."""
        text = message.get_body(preferencelist=("plain",)).get_content()
        found = {}
        for block in text.split("\n\n"):
            head = re.match(r"(T-\d+) - ", block)
            if not head:
                continue
            urls = dict(re.findall(r"^  (Approve|Reject|Request more information): http://testserver(\S+)$", block, re.M))
            found[head.group(1)] = {
                "approve": urls["Approve"],
                "reject": urls["Reject"],
                "need_more_info": urls["Request more information"],
            }
        return found


@pytest.fixture
def workflow(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from app import activity, approvals, batches, clock, config, email_service, main, recommendations, ticket_imports, tokens
    from dataclasses import replace

    for store in (approvals.REQUESTS, recommendations.QUEUE, batches.BATCHES, tokens.TOKENS, activity.EVENTS, ticket_imports.IMPORTS, email_service.DELIVERY_LOG):
        store.clear()

    outbox = tmp_path / "outbox"
    monkeypatch.setattr(config, "settings", replace(config.settings, email_outbox_dir=outbox))

    state = {"now": NOW}
    monkeypatch.setattr(clock, "now", lambda: state["now"])

    csv_path = tmp_path / "export.csv"
    csv_path.write_text(WORKFLOW_CSV, encoding="utf-8")
    monkeypatch.setattr(main, "TICKETS", main.load_tickets(csv_path))
    monkeypatch.setattr(main, "DATA_PATH", str(csv_path))
    recommendations.analyse_tickets(main.TICKETS)

    yield Workflow(TestClient(main.app), state, outbox)

    for store in (approvals.REQUESTS, recommendations.QUEUE, batches.BATCHES, tokens.TOKENS, activity.EVENTS, ticket_imports.IMPORTS, email_service.DELIVERY_LOG):
        store.clear()


@pytest.fixture(autouse=True)
def employee_notifications_inline(monkeypatch):
    """Send decision notices synchronously in tests, so nothing runs after a test ends."""
    from app import notifications

    monkeypatch.setattr(notifications, "RUN_IN_BACKGROUND", False)
