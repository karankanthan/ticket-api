from datetime import datetime


def now():
    """Current local time with its UTC offset. Tests replace this to freeze time."""
    return datetime.now().astimezone()


def timestamp():
    return now().isoformat(timespec="seconds")
