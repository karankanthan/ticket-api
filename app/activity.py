from . import clock
from .config import settings
from .store import PersistentDict

EVENTS = PersistentDict(settings.store_dir / "activity.json")


def record(event, message, **details):
    """Append an entry to the activity history. Details must not contain secrets or customer data."""
    with EVENTS.lock:
        event_id = EVENTS.next_id("EVT")
        entry = {
            "event_id": event_id,
            "event": event,
            "message": message,
            "details": details,
            "at": clock.timestamp(),
        }
        EVENTS[event_id] = entry
    return entry


def recent(limit=100, event=None):
    entries = list(EVENTS.values())
    if event:
        entries = [e for e in entries if e["event"] == event]
    entries.sort(key=lambda e: int(e["event_id"].split("-")[1]), reverse=True)
    return entries[:limit]
