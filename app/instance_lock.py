"""Only one running backend may use a data folder.

The JSON store keeps data in memory and writes whole files, so two servers on the same
folder overwrite each other's changes (this happened with two copies on port 8000: one
running old code undid the other's queue updates and dropped activity entries).
The lock is held by an open file handle, so the operating system releases it if the
process dies.
"""

import os
from pathlib import Path

if os.name == "nt":
    import msvcrt
else:
    import fcntl

LOCK_NAME = ".backend.lock"


class StoreInUse(RuntimeError):
    pass


class InstanceLock:
    def __init__(self, store_dir):
        self.path = Path(store_dir) / LOCK_NAME
        self.handle = None

    def acquire(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle = open(self.path, "a+")
        try:
            if os.name == "nt":
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            handle.close()
            raise StoreInUse(
                f"Another TicketFlow backend is already running with the data folder {self.path.parent}. "
                "Stop it first (two servers on one folder overwrite each other's data)."
            )
        handle.seek(0)
        handle.truncate()
        handle.write(f"pid {os.getpid()}\n")
        handle.flush()
        self.handle = handle
        return self

    def release(self):
        if self.handle is None:
            return
        try:
            if os.name == "nt":
                self.handle.seek(0)
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass
        self.handle.close()
        self.handle = None
