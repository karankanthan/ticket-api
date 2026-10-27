
import csv
from collections import defaultdict
from datetime import datetime
from pathlib import Path
import sys

DATE_FORMAT = "%Y-%m-%d %H:%M"


def parse_date(value):
    return datetime.strptime(value.strip(), DATE_FORMAT)


def summarize_tickets(csv_path):
    counts = defaultdict(int)
    total_hours = defaultdict(float)
    resolved_counts = defaultdict(int)

    with open(csv_path, newline="", encoding="utf-8-sig") as file:
        reader = csv.DictReader(file)

        required = {"category", "created_at", "resolved_at"}
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise ValueError(f"CSV must contain columns: {', '.join(sorted(required))}")

        for row in reader:
            #category = (row.get("category") or "").strip() or "Unknown"
            category = (row.get("category") or "").strip().title() or "Unknown"
            counts[category] += 1

            created = (row.get("created_at") or "").strip()
            resolved = (row.get("resolved_at") or "").strip()

            if not created or not resolved:
                continue

            try:
                start = parse_date(created)
                end = parse_date(resolved)
            except ValueError:
                continue

            hours = (end - start).total_seconds() / 3600
            if hours < 0:
                continue

            total_hours[category] += hours
            resolved_counts[category] += 1

    return {
        category: {
            "ticket_count": counts[category],
            "average_resolution_hours": (
                round(total_hours[category] / resolved_counts[category], 2)
                if resolved_counts[category]
                else None
            ),
        }
        for category in sorted(counts)
    }


def main():
    csv_path = (
        Path(sys.argv[1])
        if len(sys.argv) > 1
        else Path(__file__).with_name("tickets.csv")
    )

    try:
        summary = summarize_tickets(csv_path)
    except (OSError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        sys.exit(1)

    print("Ticket summary:")
    for category, result in summary.items():
        average = result["average_resolution_hours"]
        average_text = f"{average:.2f} hours" if average is not None else "N/A"
        print(
            f"{category}: {result['ticket_count']} tickets, "
            f"average resolution time: {average_text}"
        )


if __name__ == "__main__":
    main()
