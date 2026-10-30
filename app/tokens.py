"""Single-use, expiring links for manager decisions.

Only a SHA-256 hash of each token is stored, so the JSON files alone cannot be used
to act on a request. Using any link for a request revokes every other link for it.
"""

import hashlib
import secrets
from datetime import timedelta

from . import clock, config
from .config import settings
from .sla import parse_iso
from .store import PersistentDict

TOKEN_ACTIONS = ("approve", "reject", "need_more_info")

TOKENS = PersistentDict(settings.store_dir / "tokens.json")


class TokenError(Exception):
    def __init__(self, reason, message, record=None):
        super().__init__(message)
        self.reason = reason
        self.record = record


def hash_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def action_url(token):
    return f"{config.settings.public_base_url}/act/{token}"


def issue_links(request_id, batch_id):
    """Create fresh links for a request. Returns ({action: url}, [token hashes], expires_at).

    Older links stay valid until the new email is confirmed, then call activate();
    if the email fails, call discard() so the unsent links never work.
    """
    now = clock.now()
    expires = now + timedelta(hours=config.settings.action_link_ttl_hours)
    links = {}
    hashes = []
    with TOKENS.lock:
        for action in TOKEN_ACTIONS:
            token = secrets.token_urlsafe(32)
            hashes.append(hash_token(token))
            TOKENS.put(hashes[-1], {
                "request_id": request_id,
                "batch_id": batch_id,
                "action": action,
                "created_at": now.isoformat(timespec="seconds"),
                "expires_at": expires.isoformat(timespec="seconds"),
                "used_at": None,
                "revoked_at": None,
                "revoked_reason": None,
            })
            links[action] = action_url(token)
        TOKENS.save()
    return links, hashes, expires.isoformat(timespec="minutes")


def activate(request_id, new_hashes):
    """The new email went out: older links for this request stop working."""
    revoke_for_request(request_id, "replaced by a newer email", keep=set(new_hashes))


def discard(new_hashes):
    """The email failed: the links in it must never work."""
    now = clock.timestamp()
    with TOKENS.lock:
        for token_hash in new_hashes:
            record = TOKENS.get(token_hash)
            if record and not record["used_at"]:
                record["revoked_at"] = now
                record["revoked_reason"] = "email was not sent"
        TOKENS.save()


def revoke_for_request(request_id, reason, save=True, keep=()):
    now = clock.timestamp()
    with TOKENS.lock:
        for token_hash, record in TOKENS.items():
            if token_hash in keep:
                continue
            if record["request_id"] == request_id and not record["used_at"] and not record["revoked_at"]:
                record["revoked_at"] = now
                record["revoked_reason"] = reason
        if save:
            TOKENS.save()


def check(token):
    """Return (token_hash, record) for a usable token, or raise TokenError."""
    if not token or len(token) > 200:
        raise TokenError("invalid", "This link is not valid.")
    token_hash = hash_token(token)
    record = TOKENS.get(token_hash)
    if record is None:
        raise TokenError("invalid", "This link is not valid.")
    if record["used_at"]:
        raise TokenError("used", "This link has already been used.", record)
    if record["revoked_at"]:
        raise TokenError("revoked", f"This link is no longer active ({record['revoked_reason']}).", record)
    expires = parse_iso(record["expires_at"])
    if expires is None or clock.now() >= expires:
        raise TokenError("expired", "This link has expired.", record)
    return token_hash, record


def mark_used(token_hash):
    """Mark one link used and revoke the request's other links."""
    with TOKENS.lock:
        record = TOKENS[token_hash]
        record["used_at"] = clock.timestamp()
        revoke_for_request(record["request_id"], "another link for this request was used", save=False)
        TOKENS.save()
