import json

import pytest

from app import store
from app.store import PersistentDict, read_json, write_json_atomic


def test_write_then_read(tmp_path):
    path = tmp_path / "data.json"
    write_json_atomic(path, {"a": 1})
    assert read_json(path, None) == {"a": 1}


def test_missing_file_returns_default(tmp_path):
    assert read_json(tmp_path / "missing.json", {"empty": True}) == {"empty": True}


def test_corrupt_file_gives_clear_error(tmp_path):
    path = tmp_path / "data.json"
    path.write_text("{not json", encoding="utf-8")
    with pytest.raises(RuntimeError, match="not valid JSON"):
        read_json(path, None)


def test_failed_write_keeps_old_file_and_leaves_no_temp_file(tmp_path):
    path = tmp_path / "data.json"
    write_json_atomic(path, {"version": "old"})

    with pytest.raises(TypeError):
        write_json_atomic(path, {"bad": object()})

    assert read_json(path, None) == {"version": "old"}
    assert [p.name for p in tmp_path.iterdir()] == ["data.json"]


def test_replace_retries_when_file_is_briefly_locked(tmp_path, monkeypatch):
    path = tmp_path / "data.json"
    real_replace = store.os.replace
    calls = []

    def flaky_replace(src, dst):
        calls.append(src)
        if len(calls) == 1:
            raise PermissionError("locked by another program")
        real_replace(src, dst)

    monkeypatch.setattr(store.os, "replace", flaky_replace)
    monkeypatch.setattr(store.time, "sleep", lambda seconds: None)
    write_json_atomic(path, {"a": 1})

    assert len(calls) == 2
    assert read_json(path, None) == {"a": 1}


def test_persistent_dict_survives_reload(tmp_path):
    path = tmp_path / "items.json"
    items = PersistentDict(path)
    items["X-1"] = {"status": "pending"}

    reloaded = PersistentDict(path)
    assert reloaded == {"X-1": {"status": "pending"}}


def test_nested_change_is_saved_after_save(tmp_path):
    path = tmp_path / "items.json"
    items = PersistentDict(path)
    items["X-1"] = {"status": "pending"}
    items["X-1"]["status"] = "approved"
    items.save()

    assert PersistentDict(path)["X-1"]["status"] == "approved"


def test_ids_keep_counting_after_reload(tmp_path):
    path = tmp_path / "items.json"
    items = PersistentDict(path)
    assert items.next_id("REQ") == "REQ-1"
    items["REQ-1"] = {}

    assert PersistentDict(path).next_id("REQ") == "REQ-2"


def test_clear_empties_the_file(tmp_path):
    path = tmp_path / "items.json"
    items = PersistentDict(path)
    items["X-1"] = {}
    items.clear()

    assert json.loads(path.read_text(encoding="utf-8"))["items"] == {}


def test_unexpected_format_gives_clear_error(tmp_path):
    path = tmp_path / "items.json"
    path.write_text("[1, 2, 3]", encoding="utf-8")
    with pytest.raises(RuntimeError, match="unexpected format"):
        PersistentDict(path)
