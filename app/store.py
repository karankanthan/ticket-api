import json
import os
import tempfile
import threading
import time
from pathlib import Path

FORMAT_VERSION = 1
REPLACE_ATTEMPTS = 5


def write_json_atomic(path, data):
    """Write JSON so the file is either the old version or the new one, never half-written."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    fd, tmp_name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())

        # On Windows, antivirus or indexing can briefly lock the target file.
        for attempt in range(REPLACE_ATTEMPTS):
            try:
                os.replace(tmp_name, path)
                return
            except PermissionError:
                if attempt == REPLACE_ATTEMPTS - 1:
                    raise
                time.sleep(0.05 * (attempt + 1))
    except BaseException:
        if os.path.exists(tmp_name):
            os.remove(tmp_name)
        raise


def read_json(path, default):
    path = Path(path)
    if not path.is_file():
        return default
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as error:
        raise RuntimeError(
            f"Stored data file is not valid JSON: {path} ({error}). "
            "Restore it from a backup or move it aside to start empty."
        )


class PersistentDict(dict):
    """A dict saved to a JSON file on every change.

    Top-level changes (set, delete, clear) save automatically. After changing a
    nested value, such as request["status"], call save().
    """

    def __init__(self, path):
        super().__init__()
        self.path = Path(path)
        self.lock = threading.RLock()
        self.counter = 0
        self._load()

    def _load(self):
        data = read_json(self.path, None)
        if data is None:
            return
        if not isinstance(data, dict) or not isinstance(data.get("items"), dict):
            raise RuntimeError(f"Stored data file has an unexpected format: {self.path}")
        super().update(data["items"])
        self.counter = int(data.get("counter", 0))

    def save(self):
        with self.lock:
            write_json_atomic(
                self.path,
                {"version": FORMAT_VERSION, "counter": self.counter, "items": dict(self)},
            )

    def next_id(self, prefix):
        with self.lock:
            self.counter += 1
            return f"{prefix}-{self.counter}"

    def __setitem__(self, key, value):
        with self.lock:
            super().__setitem__(key, value)
            self.save()

    def __delitem__(self, key):
        with self.lock:
            super().__delitem__(key)
            self.save()

    def pop(self, key, *default):
        with self.lock:
            value = super().pop(key, *default)
            self.save()
            return value

    def update(self, *args, **kwargs):
        with self.lock:
            super().update(*args, **kwargs)
            self.save()

    def setdefault(self, key, default=None):
        with self.lock:
            value = super().setdefault(key, default)
            self.save()
            return value

    def clear(self):
        with self.lock:
            super().clear()
            self.counter = 0
            self.save()
