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

# Labels a club might use, mapped to the field we hold. Leamington say "Over
# 60s" and never use the word concession at all.
LABELS = [
    ("adultPrice", r"adults?"),
    ("concessionPrice", r"concessions?|senior citizens?|over\s*60s?"),
]

# Pages we know about that nothing links to in a way a script can follow.
# Leamington's sits at /internal/admission-prices and the home page only offers
# "Buy Tickets", which goes to a JavaScript ticketing app with no prices in it.
PRICE_PAGES = {
    "leamington": "https://leamingtonfc.co.uk/internal/admission-prices",
    "leighton-town": "https://www.leightontownfc.co.uk/a/admission-prices-202627-season--68349.html",
}

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


def price_links(base, raw):
    """
    Pages the club itself links to about admission. Guessing fixed paths missed
    Leighton entirely, whose prices sit at an article URL like
    /a/admission-prices-202627-season--68349.html. Following the club's own
    links finds those without having to guess the shape.
    """
    found = []
    for href, text in re.findall(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', raw, re.S | re.I):
        label = re.sub(r"<[^>]+>", " ", text)
        if re.search(r"admission|ticket|price", href + " " + label, re.I):
            link = urljoin(base, href)
            if link.startswith("http") and link not in found:
                found.append(link)
    return found[:6]


def prices_on(url):
    """Prices a page states plainly, or an empty dict if it states none."""
    found = {}
    text = readable(fetch(url))

    # A club can list several sets on one page and reading top to bottom picks
    # the wrong one. Bishop's Stortford put a cheaper pre-season block first,
    # and Peterborough Sports list online prices above the gate prices, which
    # are three pounds dearer. This column means what you pay at the turnstile,
    # so jump to that heading where a page has one.
    for heading in (r"matchday prices", r"match day prices", r"gate prices", r"general admission"):
        found_at = re.search(heading, text, re.I)
        if found_at:
            text = text[found_at.start():]
            break
    for field, words in LABELS:
        # Clubs write these as "Adults £13", "Adult - £15", "Adult – £15",
        # "Concessions (60+) – £10" and "Concessions: £9.50". Allow a
        # qualifier in brackets, any kind of dash, and pence.
        m = re.search(
            rf"(?:{words})\s*(?:\([^)]*\))?\s*[:\-\u2013\u2014]?\s*£\s?(\d{{1,2}}(?:\.\d{{2}})?)(?!\d)",
            text, re.I,
        )
        if m:
            value = float(m.group(1))
            if value == int(value):
                value = int(value)
            # Season tickets share the same words, so anything above what a
            # gate realistically charges is one of those. Racing Club Warwick
            # reported a £30 concession this way.
            ceiling = 25 if field == "adultPrice" else 18
            if 2 <= value <= ceiling:
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
        candidates = []
        if team["id"] in PRICE_PAGES:
            candidates.append(PRICE_PAGES[team["id"]])
        candidates += [urljoin(base.rstrip("/") + "/", p) for p in PATHS]

        # Then whatever the club links to itself.
        try:
            candidates += price_links(base, fetch(base))
        except (urllib.error.URLError, urllib.error.HTTPError, OSError, ValueError):
            pass

        for url in candidates:
            try:
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
