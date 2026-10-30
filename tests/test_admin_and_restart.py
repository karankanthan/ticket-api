import json
import os
import subprocess
import sys
from dataclasses import replace

import pytest

from app import config


@pytest.fixture
def admin_key(monkeypatch):
    monkeypatch.setattr(config, "settings", replace(config.settings, admin_api_key="test-admin-key"))
    return "test-admin-key"


def test_admin_api_needs_key_when_set(workflow, admin_key):
    assert workflow.client.get("/api/dashboard").status_code == 401
    assert workflow.client.get("/api/dashboard", headers={"X-Admin-Key": "wrong"}).status_code == 401
    assert workflow.client.get("/api/dashboard", headers={"X-Admin-Key": admin_key}).status_code == 200


def test_manager_links_and_existing_api_do_not_need_key(workflow, admin_key):
    assert workflow.client.get("/health").json() == {"status": "ok"}
    assert workflow.client.get("/approval-requests").status_code == 200
    assert workflow.client.get("/act/anything").status_code == 404


def test_detailed_health(workflow):
    body = workflow.client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["store_dir_writable"] is True
    assert body["email_backend"] == "file"


RESTART_CHECK = """
import json, sys
from fastapi.testclient import TestClient
from app.main import app
client = TestClient(app)
request = client.get('/api/approvals/' + sys.argv[1]).json()
batches = client.get('/api/control-center/batches').json()
print(json.dumps({'status': request['status'], 'history': [h['event'] for h in request['history']], 'batches': len(batches)}))
"""


def test_data_survives_a_fresh_process(workflow):
    workflow.submit("T-8", "T-1")
    links = workflow.links(workflow.emails()[0])
    workflow.client.post(links["T-8"]["approve"], data={"confirm": "yes"})
    request_id = workflow.client.get("/api/approvals", params={"ticket_id": "T-8"}).json()[0]["request_id"]

    env = {**os.environ, "SCHEDULER_ENABLED": "false"}
    output = subprocess.run(
        [sys.executable, "-c", RESTART_CHECK, request_id],
        capture_output=True, text=True, env=env, cwd=config.PROJECT_DIR, check=True,
    ).stdout
    restarted = json.loads(output.strip().splitlines()[-1])
    assert restarted == {"status": "approved", "history": ["created", "approve"], "batches": 1}
