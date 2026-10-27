
from pathlib import Path
import re

KB_DIR = Path(__file__).resolve().parent.parent / "kb"

ARTICLE_KEYWORDS = {
    "KB-001": {
        "password", "login", "log in", "sign in",
        "reset email", "locked account", "acceder", "cuenta",
        "correo", "contraseña",
    },
    "KB-002": {
        "refund", "money back", "purchase",
        "14 days", "partial refund",
    },
    "KB-003": {
        "invoice", "billing", "payment", "payment method",
        "credit card", "debit card", "charge",
        "paypal", "bitcoin", "accepted payment",
    },
    "KB-004": {
        "shipping", "shipped", "tracking",
        "delivery", "package", "order arrived",
    },
    "KB-005": {
        "crash", "crashing", "freezing",
        "frozen", "app problem", "technical",
    },
    "KB-006": {
        "close account", "account closure",
        "export data", "delete account",
    },
}


def retrieve_articles(subject: str, text: str) -> list[dict]:
    """Return relevant help articles for a ticket."""
    ticket = f"{subject} {text}".lower()
    matches = []

    for article_id, keywords in ARTICLE_KEYWORDS.items():
        score = sum(
            1 for keyword in keywords
            if re.search(
                rf"(?<!\w){re.escape(keyword)}(?!\w)",
                ticket,
            )
        )

        if score == 0:
            continue

        article_path = next(
            KB_DIR.glob(f"{article_id}-*.md"),
            None,
        )

        if article_path is None:
            continue

        matches.append({
            "id": article_id,
            "content": article_path.read_text(encoding="utf-8"),
            "score": score,
        })

    matches.sort(key=lambda article: article["score"], reverse=True)

    # Send only the two best matches to the AI.
    return matches[:2]
