"""CSV upload with column mapping, row-by-row validation, data-quality warnings and import history.

One validator is used for both the upload screen and files loaded directly at startup
(TICKETS_DATA_PATH), so every way into TicketFlow applies the same rules:

- Required: ticket ID, created date, a valid status and a valid priority. A row missing
  any of them is invalid. Nothing is invented: no IDs, dates, refunds or addresses.
- Optional values that are blank, placeholders (N/A, null...) or unusable are treated as
  unavailable and recorded as a warning; the ticket is kept.
- Additional columns are kept with the ticket under their original names. Customer
  contact columns are never imported.
- Rows are reported by their real line number in the file.

Customer email columns are recognised so they can be left out: they are never written
to the normalised file or shown in previews.
"""

import csv
import hashlib
import io
import json
import re
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path

from . import activity, clock
from .approvals import OPEN_STATUSES, REQUESTS
from .config import settings
from .store import PersistentDict

IMPORTS = PersistentDict(settings.store_dir / "imports.json")
IMPORT_DIR = settings.store_dir / "imports"
MAX_CONTENT_CHARS = 10_000_000
CSV_FORMAT = "%Y-%m-%d %H:%M"
ERROR_LIMIT = 200
# Created/resolved dates later than now by more than this are refused. The export's
# timestamps carry no time zone, so a few hours of difference are normal.
FUTURE_ALLOWANCE = timedelta(hours=12)

FIELDS = {
    "ticket_id": {"label": "Ticket ID", "required": True, "aliases": ["ticket_id", "id", "ticket", "ticket_number", "ticket_no", "case_id", "case_number", "issue_key", "key", "number"]},
    "created_at": {"label": "Created date", "required": True, "aliases": ["created_at", "created", "created_date", "date_created", "creation_date", "opened_at", "opened", "submitted_at", "created_time"]},
    "status": {"label": "Status", "required": True, "aliases": ["status", "state", "ticket_status"]},
    "priority": {"label": "Priority", "required": True, "aliases": ["priority", "severity", "urgency", "prio"]},
    "category": {"label": "Category", "required": False, "aliases": ["category", "type", "ticket_type", "topic", "issue_type"]},
    "resolved_at": {"label": "Resolved date", "required": False, "aliases": ["resolved_at", "resolved", "resolved_date", "closed_at", "solved_at", "resolution_date", "date_resolved"]},
    "assigned_to": {"label": "Assignee", "required": False, "aliases": ["assigned_to", "assignee", "agent", "owner", "assigned_agent", "assigned"]},
    "labels": {"label": "Labels / tags", "required": False, "aliases": ["labels", "tags", "label"]},
    "refund_amount": {"label": "Refund amount", "required": False, "aliases": ["refund_amount", "refund", "refund_value", "refund_usd"]},
    "team_account_closing": {"label": "Team account closing", "required": False, "aliases": ["team_account_closing", "account_closing", "closing_team_account", "team_account_closure"]},
    "subject": {"label": "Subject", "required": False, "aliases": ["subject", "title", "summary"]},
    "description": {"label": "Description", "required": False, "aliases": ["description", "body", "details", "message", "text"]},
    # The employee who raised the ticket, for decision notifications. Only explicit employee
    # column names are recognised; customer/requester columns are never used for this.
    "raised_by_email": {"label": "Raised by (employee email)", "required": False, "aliases": ["raised_by_email", "employee_email", "created_by_email", "submitted_by_email", "staff_email", "agent_email", "reporter_email"]},
}
SENSITIVE_ALIASES = {"customer_email", "email", "requester_email", "requester", "customer", "customer_name", "phone", "customer_phone", "contact_email"}
# Any column whose name contains one of these is treated as customer contact data.
SENSITIVE_WORDS = ("email", "phone", "mobile", "customer", "requester", "contact", "address")

PRIORITY_WORDS = {
    "urgent": "urgent", "critical": "urgent", "highest": "urgent", "blocker": "urgent", "emergency": "urgent",
    "high": "high", "major": "high",
    "normal": "normal", "medium": "normal", "moderate": "normal", "standard": "normal",
    "low": "low", "lowest": "low", "minor": "low", "trivial": "low",
}
PRIORITY_NUMBERS = {"1": "urgent", "2": "high", "3": "normal", "4": "low"}

# The four TicketFlow statuses. Spelling variants (case, spaces, hyphens, underscores) are accepted.
STATUS_TARGETS = ("open", "in_progress", "resolved", "closed")
STANDARD_STATUSES = {"open": "open", "in progress": "in_progress", "resolved": "resolved", "closed": "closed"}
# Other helpdesk statuses must be mapped visibly in the preview. These are only suggestions;
# "escalated" has none: the user must choose, and escalation is recorded separately.
STATUS_SUGGESTIONS = {
    "new": "open", "reopened": "open", "to do": "open", "todo": "open",
    "pending": "in_progress", "on hold": "in_progress", "waiting": "in_progress", "assigned": "in_progress", "working": "in_progress",
    "solved": "resolved", "done": "resolved", "fixed": "resolved",
    "cancelled": "closed", "canceled": "closed",
    "escalated": None,
}
ESCALATION_TOKENS = {"escalated", "esc", "escalation"}

PLACEHOLDERS = {"na", "n/a", "n.a.", "n.a", "#n/a", "null", "none", "nil", "undefined", "-", "--", "?", "unknown", "tbd"}
TRUE_WORDS = {"1", "true", "yes", "y"}
FALSE_WORDS = {"", "0", "false", "no", "n"}
DATE_FORMATS = {
    "auto": ["%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%Y/%m/%d %H:%M", "%Y/%m/%d %H:%M:%S", "%Y/%m/%d"],
    "DD/MM/YYYY": ["%d/%m/%Y %H:%M", "%d/%m/%Y %H:%M:%S", "%d/%m/%Y", "%d-%m-%Y %H:%M", "%d-%m-%Y", "%d.%m.%Y %H:%M", "%d.%m.%Y"],
    "MM/DD/YYYY": ["%m/%d/%Y %H:%M", "%m/%d/%Y %H:%M:%S", "%m/%d/%Y %I:%M %p", "%m/%d/%Y", "%m-%d-%Y %H:%M", "%m-%d-%Y"],
}
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Columns of the normalised file. The last five carry what the import learned about each ticket.
INTERNAL_COLUMNS = ["original_status", "escalated", "extra_fields", "data_warnings", "carried_over", "customer_fingerprints"]
OUTPUT_COLUMNS = [
    "ticket_id", "created_at", "resolved_at", "status", "priority", "category", "assigned_to",
    "labels", "refund_amount", "team_account_closing", "subject", "description", "raised_by_email",
] + INTERNAL_COLUMNS


class ImportFailed(Exception):
    def __init__(self, message, status_code=422, details=None):
        super().__init__(message)
        self.status_code = status_code
        self.details = details


def _key(header):
    return re.sub(r"[\s\-./]+", "_", (header or "").strip().lower()).strip("_")


def is_placeholder(value):
    return (value or "").strip().lower() in PLACEHOLDERS


def is_sensitive_header(header):
    key = _key(header)
    return key in SENSITIVE_ALIASES or any(word in key for word in SENSITIVE_WORDS)


def is_escalation_label(labels):
    """True when a whole label is escalated/esc/escalation. 'escape-room' does not count."""
    tokens = re.split(r"[;,|/\s]+", (labels or "").strip().lower())
    return any(token in ESCALATION_TOKENS for token in tokens)


def contact_fingerprint(value):
    """One-way fingerprint of a customer contact value, so a later check can refuse it without storing it."""
    return hashlib.sha256((value or "").strip().lower().encode("utf-8")).hexdigest()[:24]


def _now():
    return clock.now().replace(tzinfo=None)


# --- reading the file ------------------------------------------------------------------

def parse_csv(content):
    """Return (headers, records, delimiter, meta). meta[i] = {line, extra, missing} for records[i].

    `line` is the record's first line in the file, so blank lines and fields spanning
    several lines are counted correctly. `extra` are values beyond the header (never
    dropped silently); `missing` are header columns the row has no value for.
    """
    if not content or not content.strip():
        raise ImportFailed("The file is empty.")
    if len(content) > MAX_CONTENT_CHARS:
        raise ImportFailed("The file is larger than 10 MB.")
    content = content.lstrip("﻿")
    sample = content[:20000]
    try:
        delimiter = csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    except csv.Error:
        delimiter = ","
    reader = csv.reader(io.StringIO(content), delimiter=delimiter)
    rows = []
    previous_line = 0
    try:
        for row in reader:
            start = previous_line + 1
            previous_line = reader.line_num
            if any(cell.strip() for cell in row):
                rows.append((start, row))
    except csv.Error as error:
        raise ImportFailed(f"The file could not be read as CSV: {error}")
    if not rows:
        raise ImportFailed("The file has no rows.")
    headers = [h.strip() for h in rows[0][1]]
    if len(set(headers)) != len(headers):
        raise ImportFailed("The header row has duplicate column names.")
    if not any(headers):
        raise ImportFailed("The first row must contain column names.")
    records, meta = [], []
    for line, row in rows[1:]:
        extra = [value for value in row[len(headers):] if value.strip()]
        missing = headers[len(row):] if len(row) < len(headers) else []
        padded = row[: len(headers)] + [""] * (len(headers) - len(row))
        records.append(dict(zip(headers, padded)))
        meta.append({"line": line, "extra": extra, "missing": missing})
    return headers, records, delimiter, meta


def suggest_mapping(headers):
    by_key = {_key(h): h for h in headers}
    mapping = {}
    for field, meta in FIELDS.items():
        mapping[field] = next((by_key[a] for a in meta["aliases"] if a in by_key), None)
    return mapping


def sensitive_columns(headers, mapping):
    """Customer contact columns. An email column is only allowed through when mapped as the employee email."""
    employee = mapping.get("raised_by_email")
    return [h for h in headers if h != employee and is_sensitive_header(h)]


def column_groups(headers, mapping):
    """Every column is mapped, kept as an additional field, or not imported (with the reason)."""
    mapped = {column: field for field, column in mapping.items() if column}
    sensitive = set(sensitive_columns(headers, mapping))
    groups = []
    for header in headers:
        if header in mapped:
            groups.append({"column": header, "group": "mapped", "field": mapped[header], "label": FIELDS[mapped[header]]["label"]})
        elif header in sensitive:
            groups.append({"column": header, "group": "not_imported", "reason": "customer contact data"})
        elif not header:
            groups.append({"column": header, "group": "not_imported", "reason": "column has no name"})
        else:
            groups.append({"column": header, "group": "additional"})
    return groups


def additional_columns(headers, mapping):
    return [g["column"] for g in column_groups(headers, mapping) if g["group"] == "additional"]


# --- field parsers -----------------------------------------------------------------------

def _parse_date(value, date_format):
    value = (value or "").strip()
    if not value:
        return None
    for fmt in DATE_FORMATS[date_format]:
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            pass
    if date_format == "auto":
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            raise ValueError(f"'{value}' is not a recognised date")
        if parsed.tzinfo:
            parsed = parsed.astimezone().replace(tzinfo=None)
        return parsed
    raise ValueError(f"'{value}' does not match {date_format}")


def _priority(value):
    raw = (value or "").strip().lower()
    match = re.match(r"^p?\s*([1-4])\b", raw)
    if match:
        return PRIORITY_NUMBERS[match.group(1)]
    for word in re.split(r"[\s\-_:/()]+", raw):
        if word in PRIORITY_WORDS:
            return PRIORITY_WORDS[word]
    raise ValueError(f"'{value}' is not a recognised priority")


def status_key(value):
    return re.sub(r"\s+", " ", re.sub(r"[-_]", " ", (value or "").strip().lower())).strip()


def _money(value):
    """Exact amount as plain text ("1234567.89", "450"). Decimal keeps every digit; float did not."""
    raw = (value or "").strip().replace("$", "").replace(",", "")
    if not raw:
        return ""
    try:
        amount = Decimal(raw)
    except InvalidOperation:
        raise ValueError(f"'{value}' is not a valid amount")
    if not amount.is_finite():
        raise ValueError(f"'{value}' is not a valid amount")
    if amount < 0:
        raise ValueError("refund amount cannot be negative")
    if amount == 0:
        return "0"
    return format(amount.normalize(), "f")


def _flag(value):
    raw = (value or "").strip().lower()
    if raw in TRUE_WORDS:
        return "yes"
    if raw in FALSE_WORDS:
        return ""
    raise ValueError(f"'{value}' is not yes/no")


def _mask(address):
    if not address or "@" not in address:
        return address
    name, domain = address.split("@", 1)
    return f"{name[:1]}***@{domain}"


# --- validation --------------------------------------------------------------------------

def effective_status_map(status_map):
    """Suggestions, overridden by the user's explicit choices. A value of None/"" means 'do not import'."""
    chosen = dict(STATUS_SUGGESTIONS)
    for raw, target in (status_map or {}).items():
        chosen[status_key(raw)] = target if target in STATUS_TARGETS else None
    return chosen


def validate(headers, records, meta, mapping, date_format="auto", status_map=None, now=None):
    """Check every row. Returns a report dict; never raises for row problems."""
    if date_format not in DATE_FORMATS:
        raise ImportFailed(f"date_format must be one of {', '.join(DATE_FORMATS)}")
    unknown = [c for c in mapping.values() if c and c not in headers]
    if unknown:
        raise ImportFailed(f"Mapped columns not in the file: {', '.join(unknown)}")
    missing = [FIELDS[f]["label"] for f, meta_ in FIELDS.items() if meta_["required"] and not mapping.get(f)]
    if missing:
        raise ImportFailed(f"Map the required fields: {', '.join(missing)}.")

    now = now or _now()
    latest_allowed = now + FUTURE_ALLOWANCE
    status_choices = effective_status_map(status_map)
    extra_columns = additional_columns(headers, mapping)
    customer_columns = sensitive_columns(headers, mapping)

    valid, errors, row_warnings = [], [], []
    seen = {}
    status_counts = {}
    quality = {"valid": 0, "with_warnings": 0, "invalid": 0}
    surplus_rows = []

    for index, record in enumerate(records):
        info = meta[index] if meta else {"line": index + 2, "extra": [], "missing": []}
        line = info["line"]
        get = lambda field: (record.get(mapping[field], "") if mapping.get(field) else "").strip()
        errs, warns = [], []
        out = {}

        ticket_id = get("ticket_id")
        out["ticket_id"] = ticket_id
        if not ticket_id:
            errs.append(("ticket_id", "ticket ID is blank"))
        elif is_placeholder(ticket_id):
            errs.append(("ticket_id", f"'{ticket_id}' is a placeholder, not a ticket ID"))
        elif ticket_id.lower() in seen:
            errs.append(("ticket_id", f"duplicate ticket ID {ticket_id} (same as line {seen[ticket_id.lower()]}, ignoring upper/lower case)"))
        else:
            seen[ticket_id.lower()] = line

        if info["extra"]:
            values = ", ".join(f"'{v}'" for v in info["extra"])
            errs.append(("row", f"row has {len(info['extra'])} more value(s) than the header: {values}. Check for a missing or extra comma; the values were not imported."))
            surplus_rows.append({"line": line, "ticket_id": ticket_id, "values": info["extra"]})
        if info["missing"]:
            warns.append(f"Row has fewer values than the header; missing: {', '.join(info['missing'])}")

        # Priority (required)
        raw_priority = get("priority")
        if not raw_priority or is_placeholder(raw_priority):
            errs.append(("priority", "priority is blank"))
        else:
            try:
                out["priority"] = _priority(raw_priority)
            except ValueError as error:
                errs.append(("priority", str(error)))

        # Status (required). Non-standard values need a visible mapping.
        raw_status = get("status")
        key = status_key(raw_status)
        out["original_status"] = ""
        escalated = False
        if not raw_status or is_placeholder(raw_status):
            errs.append(("status", "status is blank"))
        elif key in STANDARD_STATUSES:
            out["status"] = STANDARD_STATUSES[key]
        else:
            entry = status_counts.setdefault(key, {"value": raw_status, "count": 0})
            entry["count"] += 1
            target = status_choices.get(key)
            if key == "escalated":
                escalated = True
            if target in STATUS_TARGETS:
                out["status"] = target
                out["original_status"] = raw_status
            else:
                errs.append(("status", f"status '{raw_status}' is not a TicketFlow status; choose how to map it in the preview"))

        labels = get("labels")
        labels = "" if is_placeholder(labels) else labels
        out["labels"] = labels
        out["escalated"] = "yes" if (escalated or is_escalation_label(labels)) else ""

        # Created date (required, not in the future)
        created = resolved = None
        raw_created = get("created_at")
        if not raw_created or is_placeholder(raw_created):
            errs.append(("created_at", "created date is blank"))
        else:
            try:
                created = _parse_date(raw_created, date_format)
                if created > latest_allowed:
                    errs.append(("created_at", f"created date {raw_created} is in the future"))
            except ValueError as error:
                errs.append(("created_at", str(error)))

        # Resolved date (optional)
        raw_resolved = get("resolved_at")
        if raw_resolved and not is_placeholder(raw_resolved):
            try:
                resolved = _parse_date(raw_resolved, date_format)
            except ValueError:
                warns.append(f"Resolved date '{raw_resolved}' is not a valid date; treated as unavailable")
            if resolved:
                if created and resolved < created:
                    errs.append(("resolved_at", "resolved date is before the created date"))
                elif resolved > latest_allowed:
                    errs.append(("resolved_at", f"resolved date {raw_resolved} is in the future"))
        status = out.get("status")
        if resolved and status in ("open", "in_progress"):
            warns.append("Resolved date on an unresolved ticket; ignored for SLA and reports")
        if not resolved and status in ("resolved", "closed") and mapping.get("resolved_at"):
            warns.append("Resolved date missing")

        # Optional values: unusable ones become unavailable with a warning, never a guess.
        out["refund_amount"] = ""
        if mapping.get("refund_amount"):
            raw = get("refund_amount")
            if is_placeholder(raw):
                warns.append(f"Refund amount unavailable ('{raw}')")
            elif raw:
                try:
                    out["refund_amount"] = _money(raw)
                except ValueError:
                    warns.append(f"Refund amount '{raw}' is not usable; treated as unavailable")
        out["team_account_closing"] = ""
        if mapping.get("team_account_closing"):
            raw = get("team_account_closing")
            if is_placeholder(raw):
                warns.append(f"Team account closing unavailable ('{raw}')")
            else:
                try:
                    out["team_account_closing"] = _flag(raw)
                except ValueError:
                    warns.append(f"Team account closing '{raw}' is not yes/no; treated as unavailable")
        for field, label in (("category", "Category missing"), ("assigned_to", "Assigned employee missing")):
            value = get(field)
            out[field] = "" if is_placeholder(value) else value
            if mapping.get(field) and not out[field]:
                warns.append(label)
        for field in ("subject", "description"):
            value = get(field)
            out[field] = "" if is_placeholder(value) else value

        employee = get("raised_by_email")
        out["raised_by_email"] = ""
        if employee and not is_placeholder(employee):
            customer_values = {(record.get(h) or "").strip().lower() for h in customer_columns}
            if not EMAIL_PATTERN.match(employee):
                warns.append("Employee email is not a valid address; dropped (no decision notice)")
            elif employee.lower() in customer_values:
                warns.append("Employee email equals a customer email; dropped so customers are never notified")
            else:
                out["raised_by_email"] = employee

        out["extra_fields"] = {
            column: record[column].strip()
            for column in extra_columns
            if record.get(column, "").strip() and not is_placeholder(record[column])
        }
        out["carried_over"] = ""
        out["customer_fingerprints"] = sorted(
            {contact_fingerprint(record.get(h)) for h in customer_columns if (record.get(h) or "").strip()}
        )

        if errs:
            quality["invalid"] += 1
            for field, message in errs:
                if len(errors) < ERROR_LIMIT:
                    errors.append({"row": line, "ticket_id": ticket_id, "field": field, "message": message})
            continue
        out["created_at"] = created.strftime(CSV_FORMAT)
        out["resolved_at"] = resolved.strftime(CSV_FORMAT) if resolved else ""
        out["data_warnings"] = warns
        quality["with_warnings" if warns else "valid"] += 1
        for message in warns:
            if len(row_warnings) < ERROR_LIMIT:
                row_warnings.append({"line": line, "ticket_id": ticket_id, "message": message})
        valid.append(out)

    warnings = []
    if mapping.get("resolved_at") is None:
        warnings.append("No resolved date column: SLA for resolved tickets will show as not available.")
    if mapping.get("refund_amount") is None:
        warnings.append("No refund column: the refund over $200 rule cannot be checked.")
    if mapping.get("team_account_closing") is None:
        warnings.append("No team account closing column: that rule can only be applied by manual requests.")
    if extra_columns:
        warnings.append(f"{len(extra_columns)} additional column(s) will be kept with each ticket: {', '.join(extra_columns)}.")

    status_values = [
        {
            "value": entry["value"],
            "key": key,
            "count": entry["count"],
            "suggestion": STATUS_SUGGESTIONS.get(key),
            "mapped_to": status_choices.get(key) if status_choices.get(key) in STATUS_TARGETS else None,
            "escalation": key == "escalated",
        }
        for key, entry in status_counts.items()
    ]
    return {
        "valid": valid,
        "errors": errors,
        "invalid_rows": quality["invalid"],
        "warnings": warnings,
        "row_warnings": row_warnings,
        "quality": quality,
        "status_values": status_values,
        "surplus_rows": surplus_rows,
    }


# --- what an import would change -----------------------------------------------------------

def removal_plan(new_ids, current_tickets):
    """Current tickets missing from the new file. Those with an open approval are carried over."""
    incoming = {i.lower() for i in new_ids}
    open_requests = {}
    for request in REQUESTS.values():
        if request["status"] in OPEN_STATUSES:
            open_requests[request["ticket_id"]] = request
    carried, removed = [], []
    for ticket in current_tickets or []:
        if ticket["ticket_id"].lower() in incoming:
            continue
        request = open_requests.get(ticket["ticket_id"])
        if request:
            carried.append({"ticket_id": ticket["ticket_id"], "request_id": request["request_id"], "status": request["status"]})
        else:
            removed.append(ticket["ticket_id"])
    return {"removed_count": len(removed), "removed": removed, "carried_over": carried}


def _carried_row(ticket, request_id):
    row = {column: ticket.get(column, "") or "" for column in OUTPUT_COLUMNS if column not in ("extra_fields", "data_warnings", "customer_fingerprints")}
    row["customer_fingerprints"] = list(ticket.get("customer_fingerprints") or [])
    row["extra_fields"] = dict(ticket.get("extra_fields") or {})
    note = f"Not in latest export (kept because approval {request_id} is still open)"
    row["data_warnings"] = [w for w in ticket.get("data_warnings") or [] if not w.startswith("Not in latest export")] + [note]
    row["carried_over"] = "yes"
    return row


def preview(filename, content, mapping=None, date_format="auto", status_map=None, current_tickets=None):
    headers, records, delimiter, meta = parse_csv(content)
    mapping = {f: (mapping or {}).get(f) for f in FIELDS} if mapping else suggest_mapping(headers)
    hidden = set(sensitive_columns(headers, mapping))
    result = {
        "filename": filename,
        "delimiter": {",": "comma", ";": "semicolon", "\t": "tab", "|": "pipe"}.get(delimiter, delimiter),
        "columns": headers,
        "column_groups": column_groups(headers, mapping),
        "row_count": len(records),
        "sample_rows": [
            {h: ("(hidden)" if h in hidden else _mask(r.get(h, "")) if h == mapping.get("raised_by_email") else r.get(h, "")) for h in headers}
            for r in records[:10]
        ],
        "mapping": mapping,
        "fields": [{"field": f, "label": m["label"], "required": m["required"]} for f, m in FIELDS.items()],
        "excluded_sensitive_columns": sorted(hidden),
        "date_formats": list(DATE_FORMATS),
        "date_format": date_format,
        "status_targets": list(STATUS_TARGETS),
    }
    try:
        report = validate(headers, records, meta, mapping, date_format, status_map)
    except ImportFailed as error:
        result.update(
            ready=False, mapping_error=str(error), valid_rows=0, invalid_rows=None, errors=[], warnings=[],
            row_warnings=[], quality=None, status_values=[], surplus_rows=[], normalized_sample=[], removals=None,
        )
        return result
    valid = report["valid"]
    result.update(
        ready=bool(valid),
        mapping_error=None,
        valid_rows=len(valid),
        invalid_rows=report["invalid_rows"],
        errors=report["errors"],
        errors_truncated=len(report["errors"]) >= ERROR_LIMIT,
        warnings=report["warnings"],
        row_warnings=report["row_warnings"],
        quality=report["quality"],
        status_values=report["status_values"],
        surplus_rows=report["surplus_rows"],
        normalized_sample=[{**row, "raised_by_email": _mask(row["raised_by_email"])} for row in valid[:10]],
        removals=removal_plan([r["ticket_id"] for r in valid], current_tickets) if current_tickets is not None else None,
    )
    return result


# --- saving -------------------------------------------------------------------------------

def _record(entry):
    with IMPORTS.lock:
        IMPORTS[entry["import_id"]] = entry
    return entry


def write_ticket_file(path, rows):
    """Write normalised rows (dict/list fields as JSON) atomically."""
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=OUTPUT_COLUMNS, lineterminator="\n", extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({
            **{column: row.get(column, "") or "" for column in OUTPUT_COLUMNS},
            "extra_fields": json.dumps(row.get("extra_fields") or {}, ensure_ascii=False),
            "data_warnings": json.dumps(row.get("data_warnings") or [], ensure_ascii=False),
            "customer_fingerprints": json.dumps(row.get("customer_fingerprints") or []),
        })
    path = Path(path)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(buffer.getvalue(), encoding="utf-8")
    tmp.replace(path)


def commit(filename, content, mapping, date_format, skip_invalid, use_ticket_file, status_map=None,
           manager_fields=None, acknowledge_removals=False, current_tickets=None):
    """Validate, write the normalised file and switch to it. Current tickets stay if anything fails."""
    with IMPORTS.lock:
        import_id = IMPORTS.next_id("IMP")
    entry = {
        "import_id": import_id,
        "filename": filename,
        "created_at": clock.timestamp(),
        "status": "failed",
        "total_rows": None,
        "valid_rows": None,
        "invalid_rows": None,
        "imported_rows": 0,
        "date_format": date_format,
        "mapping": mapping,
        "status_map": status_map or {},
        "manager_fields": [],
        "quality": None,
        "carried_over": [],
        "removed_count": 0,
        "error": None,
        "file": None,
        "analysis": None,
    }
    try:
        headers, records, _, meta = parse_csv(content)
        entry["total_rows"] = len(records)
        mapping = {f: (mapping or {}).get(f) for f in FIELDS}
        entry["mapping"] = mapping
        report = validate(headers, records, meta, mapping, date_format, status_map)
        valid = report["valid"]
        entry.update(valid_rows=len(valid), invalid_rows=report["invalid_rows"], quality=report["quality"])
        if not valid:
            raise ImportFailed("No valid rows to import.", details={"errors": report["errors"][:20]})
        if report["invalid_rows"] and not skip_invalid:
            raise ImportFailed(
                f"{report['invalid_rows']} row(s) have errors. Fix the file or choose to skip invalid rows.",
                details={"errors": report["errors"][:20]},
            )

        allowed = set(additional_columns(headers, mapping))
        chosen = [c for c in (manager_fields or []) if c in allowed and not is_sensitive_header(c)]
        entry["manager_fields"] = chosen

        plan = removal_plan([r["ticket_id"] for r in valid], current_tickets)
        if plan["removed_count"] and not acknowledge_removals:
            raise ImportFailed(
                f"{plan['removed_count']} current ticket(s) are not in this file and would be removed. Review the list and confirm to continue.",
                409,
                details={"removed": plan["removed"][:50], "removed_count": plan["removed_count"], "carried_over": plan["carried_over"]},
            )
        by_id = {t["ticket_id"]: t for t in current_tickets or []}
        carried_rows = [_carried_row(by_id[c["ticket_id"]], c["request_id"]) for c in plan["carried_over"]]
        entry["carried_over"] = [c["ticket_id"] for c in plan["carried_over"]]
        entry["removed_count"] = plan["removed_count"]

        IMPORT_DIR.mkdir(parents=True, exist_ok=True)
        path = IMPORT_DIR / f"{import_id}.csv"
        write_ticket_file(path, valid + carried_rows)
        entry["file"] = path.name
        entry["imported_rows"] = use_ticket_file(str(path))
        entry["status"] = "completed"
    except ImportFailed as error:
        entry["error"] = str(error)
        _record(entry)
        activity.record("import_failed", f"Import of {filename} failed: {error}", import_id=import_id)
        raise
    except Exception as error:
        entry["error"] = f"{type(error).__name__}: {error}"
        _record(entry)
        activity.record("import_failed", f"Import of {filename} failed: {entry['error']}", import_id=import_id)
        raise ImportFailed(f"Import failed; the previous tickets are still in use. {entry['error']}", 400)

    _record(entry)
    parts = [f"Imported {entry['imported_rows']} tickets from {filename}"]
    if entry["invalid_rows"]:
        parts.append(f"{entry['invalid_rows']} invalid rows skipped")
    if report["quality"]["with_warnings"]:
        parts.append(f"{report['quality']['with_warnings']} with data-quality warnings")
    if entry["carried_over"]:
        parts.append(f"{len(entry['carried_over'])} kept because their approval is still open: {', '.join(entry['carried_over'])}")
    if entry["removed_count"]:
        parts.append(f"{entry['removed_count']} previous tickets not in the file were removed")
    activity.record("csv_imported", "; ".join(parts), import_id=import_id)
    return entry


# --- loading a ticket file (startup, after import, direct TICKETS_DATA_PATH) -----------------

def load_ticket_file(path):
    """Read a ticket CSV with the same rules as an upload. Returns (rows, report).

    Normalised files written by an import are read as they are. Any other file is
    validated like an upload (status suggestions applied); invalid rows are skipped and
    listed in the report with their line numbers, never silently.
    """
    content = Path(path).read_text(encoding="utf-8-sig")
    headers, records, _, meta = parse_csv(content)
    report = {"file": str(path), "total_rows": len(records), "loaded": 0, "skipped": 0, "reasons": []}

    if "extra_fields" in headers and "data_warnings" in headers:
        rows = []
        for info, record in zip(meta, records):
            try:
                row = {column: record.get(column, "") for column in OUTPUT_COLUMNS}
                row["extra_fields"] = json.loads(record.get("extra_fields") or "{}")
                row["data_warnings"] = json.loads(record.get("data_warnings") or "[]")
                row["customer_fingerprints"] = json.loads(record.get("customer_fingerprints") or "[]")
                if not row["ticket_id"] or not row["status"] or not row["priority"]:
                    raise ValueError("required value is blank")
                datetime.strptime(row["created_at"], CSV_FORMAT)
                if row["resolved_at"]:
                    datetime.strptime(row["resolved_at"], CSV_FORMAT)
                rows.append(row)
            except (ValueError, TypeError) as error:
                report["reasons"].append({"line": info["line"], "ticket_id": record.get("ticket_id", ""), "field": "row", "message": str(error)})
    else:
        mapping = suggest_mapping(headers)
        result = validate(headers, records, meta, mapping, "auto")
        rows = result["valid"]
        report["reasons"] = result["errors"]
    report["loaded"] = len(rows)
    report["skipped"] = report["total_rows"] - len(rows)
    return rows, report


def set_analysis(import_id, analysis):
    with IMPORTS.lock:
        IMPORTS[import_id]["analysis"] = analysis
        IMPORTS.save()


def active_file():
    """Path of the most recent successful import, if its file still exists."""
    entry = active_import()
    return str(IMPORT_DIR / entry["file"]) if entry else None


def active_import():
    completed = [e for e in IMPORTS.values() if e["status"] == "completed" and e.get("file")]
    completed.sort(key=lambda e: int(e["import_id"].split("-")[1]))
    for entry in reversed(completed):
        if (IMPORT_DIR / entry["file"]).is_file():
            return entry
    return None


def active_manager_fields():
    """Additional columns the Helpdesk Head chose to show to the manager in the active import."""
    entry = active_import()
    return [c for c in (entry or {}).get("manager_fields", []) if not is_sensitive_header(c)]


def history():
    entries = list(IMPORTS.values())
    entries.sort(key=lambda e: int(e["import_id"].split("-")[1]), reverse=True)
    return entries
