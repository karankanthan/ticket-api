import atexit
import os
import shutil
import tempfile

os.environ.setdefault("TICKETS_DATA_PATH", "data/tickets_sample.csv")

# Keep test runs away from the real data/store folder.
_store_dir = tempfile.mkdtemp(prefix="ticket-api-test-store-")
os.environ["APP_STORE_DIR"] = _store_dir
os.environ["APP_ENV"] = "local"
os.environ.pop("ADMIN_API_KEY", None)
atexit.register(shutil.rmtree, _store_dir, ignore_errors=True)
