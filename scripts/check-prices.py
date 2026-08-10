#!/usr/bin/env python3
"""
Checks published admission prices against the ones the app shows.

Most clubs at this level do not publish prices anywhere a script can read: of
the twenty one in the division, two do. That is not a reason to skip it. Both
of those two turned out to be wrong in our data when this was first run, which
is exactly the kind of drift nobody notices until a supporter is short at the
turnstile.

Writes data/price-check.json. Run locally with:  python3 scripts/check-prices.py
"""

import html
import json
import pathlib
import re
import ssl
import urllib.error
import urllib.request
from datetime import date, timezone, datetime
from urllib.parse import urljoin

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "price-check.json"

UA = "Mozilla/5.0 (KTFCSA supporters app; checking published admission prices)"
PATHS = ["tickets", "admission", "admission-prices", "ticket-prices", "matchday", ""]

# Labels a club might use, mapped to the field we hold.
LABELS = [
    ("adultPrice", r"adults?"),
    ("concessionPrice", r"concessions?|senior citizens?"),
]

CTX = ssl.create_default_context()

# Several club sites serve an incomplete certificate chain, which Python
# rejects even though a browser accepts it. Verifying first and only falling
# back keeps the check honest where it can be. Nothing is ever sent to these
# sites, we only read pages anyone can open, so the fallback costs us nothing.
LOOSE = ssl.create_default_context()
LOOSE.check_hostname = False
LOOSE.verify_mode = ssl.CERT_NONE


def teams():
    src = (ROOT / "assets" / "js" / "data.js").read_text()
    return json.loads(re.search(r"export const TEAMS = (\[.*?\]);", src, re.S).group(1))


def websites():
    path = ROOT / "data" / "clubs.json"
    if not path.exists():
        return {}
    clubs = json.loads(path.read_text()).get("clubs", {})
    return {k: v.get("website") for k, v in clubs.items() if v.get("website")}


def fetch(url):
    req = urllib.request.Request(url, headers={"user-agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=10, context=CTX) as r:
            return r.read().decode("utf8", "ignore")
    except urllib.error.URLError as err:
        if not isinstance(err.reason, ssl.SSLError):
            raise
        with urllib.request.urlopen(req, timeout=10, context=LOOSE) as r:
            return r.read().decode("utf8", "ignore")


def readable(raw):
    text = html.unescape(re.sub(r"<[^>]+>", " ", raw))
    return re.sub(r"\s+", " ", text)


def prices_on(url):
    """Prices a page states plainly, or an empty dict if it states none."""
    found = {}
    text = readable(fetch(url))
    for field, words in LABELS:
        m = re.search(rf"(?:{words})\s*[:\-]?\s*£\s?(\d{{1,2}})(?!\d)", text, re.I)
        if m:
            value = int(m.group(1))
            # Season tickets share the same words. A matchday price at this
            # level is single figures or low teens, never fifty pounds.
            if 2 <= value <= 30:
                found[field] = value
    return found


def main():
    sites = websites()
    checked, drift, unreadable = [], [], []

    for team in teams():
        base = sites.get(team["id"])
        if not base:
            unreadable.append(team["id"])
            continue

        seen = {}
        source = None
        for path in PATHS:
            try:
                url = urljoin(base.rstrip("/") + "/", path)
                seen = prices_on(url)
            except (urllib.error.URLError, urllib.error.HTTPError, OSError, ValueError):
                continue
            if seen:
                source = url
                break

        if not seen:
            unreadable.append(team["id"])
            continue

        row = {"club": team["id"], "name": team["name"], "source": source, "found": seen}
        differences = {
            field: {"site": value, "ours": team.get(field)}
            for field, value in seen.items()
            if team.get(field) != value
        }
        if differences:
            row["differences"] = differences
            drift.append(row)
        checked.append(row)

    payload = {
        "checked": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "note": (
            "Only a couple of clubs publish admission prices where a script can read "
            "them. Everything in unreadable is unknown, not confirmed correct."
        ),
        "readable": checked,
        "drift": drift,
        "unreadable": sorted(unreadable),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")

    print(f"Readable: {len(checked)} of {len(teams())}. Unreadable: {len(unreadable)}.")
    for row in drift:
        for field, d in row["differences"].items():
            print(f"  DRIFT {row['name']}: {field} site £{d['site']}, ours £{d['ours']}")
    if not drift:
        print("  No drift against the prices we publish.")


if __name__ == "__main__":
    main()
