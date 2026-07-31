#!/usr/bin/env python3
"""Collect a proper background note and an official website for every club.

The master spreadsheet gives one line per club, which reads a bit thin on the
club page. This pulls a fuller description from Wikipedia and the official
website and founding year from Wikidata, then writes data/clubs.json.

Sourcing it beats writing it from memory: everything here can be traced back
to a page, and it is refreshed by re-running the script rather than by hand.

    python3 scripts/fetch-club-info.py

The spreadsheet is still the authority on anything practical, prices, parking,
pubs and distances. This only adds background.
"""
import json
import pathlib
import re
import subprocess
import sys
import time
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "clubs.json"
UA = "KTFCSA-app/1.0 (supporters association club guide)"

# Wikipedia article titles. Set explicitly so a search never lands on the wrong
# club, which matters for names like Stamford and Leamington.
ARTICLES = {
    "kettering-town": "Kettering Town F.C.",
    "alvechurch": "Alvechurch F.C.",
    "anstey-nomads": "Anstey Nomads F.C.",
    "banbury-united": "Banbury United F.C.",
    "bishops-stortford": "Bishop's Stortford F.C.",
    "bromsgrove-sporting": "Bromsgrove Sporting F.C.",
    "bury-town": "Bury Town F.C.",
    "halesowen-town": "Halesowen Town F.C.",
    "hitchin-town": "Hitchin Town F.C.",
    "leamington": "Leamington F.C.",
    "leighton-town": "Leighton Town F.C.",
    "leiston": "Leiston F.C.",
    "needham-market": "Needham Market F.C.",
    "peterborough-sports": "Peterborough Sports F.C.",
    "racing-club-warwick": "Racing Club Warwick F.C.",
    "real-bedford": "Real Bedford F.C.",
    "redditch-united": "Redditch United F.C.",
    "rushall-olympic": "Rushall Olympic F.C.",
    "stamford": "Stamford A.F.C.",
    "stourbridge": "Stourbridge F.C.",
    "stratford-town": "Stratford Town F.C.",
    "worcester-city": "Worcester City F.C.",
}


# Wikidata's website field goes stale, and several entries pointed at Pitchero
# pages that now say "Club not live". Every address below was opened and its
# page title checked against the club name, because a dead link on a club page
# is worse than no link. Re-check these if a club moves site.
WEBSITE_OVERRIDES = {
    "anstey-nomads": "https://www.ansteynomads.com/",
    "bromsgrove-sporting": "https://www.bromsgrovesporting.co.uk/",
    "halesowen-town": "https://www.pitchero.com/clubs/halesowentownfc",
    "leighton-town": "https://www.leightontownfc.co.uk/",
    "peterborough-sports": "https://www.psfc.co.uk/",
    "racing-club-warwick": "https://www.rcwfc.co.uk/",
    "real-bedford": "https://www.realbedford.com/",
    "stratford-town": "https://stratfordtownfc.co.uk/",
    # Rushall Olympic: no working official site found, so the club page falls
    # back to its Wikipedia entry rather than linking somewhere broken.
    "rushall-olympic": None,
}


def get(url):
    r = subprocess.run(
        ["curl", "-sS", "-L", "--max-time", "30", "-A", UA, url],
        capture_output=True,
    )
    if r.returncode != 0 or not r.stdout:
        raise RuntimeError((r.stderr or b"empty").decode().strip()[:120])
    return json.loads(r.stdout)


def wiki_batch(titles):
    """One request for every article, rather than one request each.

    Asking twenty two times in a row earns a 429 from Wikipedia, and rightly
    so. The query API takes up to fifty titles at once and follows redirects,
    so this is a single polite call.
    """
    # The extracts API silently returns nothing past the twentieth page, so
    # ask in chunks rather than losing the tail of the list.
    query = {"pages": {}, "normalized": [], "redirects": []}
    for i in range(0, len(titles), 20):
        chunk = titles[i : i + 20]
        url = (
            "https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1"
            "&prop=extracts|pageprops&exintro=1&explaintext=1&exlimit=20"
            "&ppprop=wikibase_item"
            "&titles=" + urllib.parse.quote("|".join(chunk), safe="|")
        )
        part = get(url).get("query", {})
        query["pages"].update(part.get("pages") or {})
        query["normalized"] += part.get("normalized") or []
        query["redirects"] += part.get("redirects") or []
        time.sleep(1)  # one second between calls keeps Wikipedia happy

    # Redirects and normalisation mean the title asked for is not always the
    # title returned, so build a map back to what we requested.
    alias = {}
    for kind in ("normalized", "redirects"):
        for row in query.get(kind, []) or []:
            alias[row["to"]] = row["from"]

    pages = {}
    for page in (query.get("pages") or {}).values():
        title = page.get("title", "")
        asked = title
        while asked in alias:
            asked = alias[asked]
        pages[asked] = page
    return pages


def wikidata(qids):
    if not qids:
        return {}
    url = (
        "https://www.wikidata.org/w/api.php?action=wbgetentities&ids="
        + "|".join(qids)
        + "&props=claims&format=json"
    )
    return get(url).get("entities", {})


def claim(entity, prop):
    cl = entity.get("claims", {}).get(prop)
    if not cl:
        return None
    v = cl[0]["mainsnak"].get("datavalue", {}).get("value")
    if isinstance(v, dict):
        return v.get("time") or v.get("amount") or v.get("id")
    return v


# Lines that only repeat what the club page already shows above them.
BOILERPLATE = re.compile(
    r"(Football Club is an? .*football club (based|representing))"
    r"|(^(They|The club) (are|is) currently members)"
    r"|(^The club (currently )?plays? in the Southern)",
    re.IGNORECASE,
)


def tidy(text):
    """Drops the opening line that repeats the club name, but never everything.

    Stratford and Worcester have leads where every sentence looked like
    boilerplate, which left them with a blank club page, so keep the original
    whenever the filter would strip the lot.
    """
    text = re.sub(r"\s+", " ", text or "").strip()
    if not text:
        return ""
    parts = re.split(r"(?<=\.)\s+", text)
    keep = [p for p in parts if not BOILERPLATE.search(p)]
    out = " ".join(keep).strip()
    return out if len(out) > 40 else text


def main():
    clubs = {}
    lookups = {}

    pages = wiki_batch(list(ARTICLES.values()))

    for slug, title in ARTICLES.items():
        page = pages.get(title)
        if not page or "missing" in page:
            print(f"  {slug:22} no article found for {title!r}")
            continue
        lookups[slug] = (page.get("pageprops") or {}).get("wikibase_item")
        clubs[slug] = {
            "slug": slug,
            "wikipediaTitle": page.get("title"),
            "wikipedia": "https://en.wikipedia.org/wiki/"
            + urllib.parse.quote((page.get("title") or "").replace(" ", "_")),
            "summary": tidy(page.get("extract")),
            "founded": None,
            "website": None,
        }
        print(f"  {slug:22} {len(clubs[slug]['summary'] or ''):4} chars")

    ids = [q for q in lookups.values() if q]
    entities = {}
    for i in range(0, len(ids), 20):
        entities.update(wikidata(ids[i : i + 20]))

    for slug, qid in lookups.items():
        e = entities.get(qid or "")
        if not e:
            continue
        site = claim(e, "P856")
        founded = claim(e, "P571")
        if site:
            clubs[slug]["website"] = site
        if founded and isinstance(founded, str):
            m = re.match(r"\+(\d{4})", founded)
            if m:
                clubs[slug]["founded"] = int(m.group(1))

    for slug, url in WEBSITE_OVERRIDES.items():
        if slug in clubs:
            clubs[slug]["website"] = url

    payload = {
        "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "Wikipedia and Wikidata",
        "clubs": clubs,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    have_site = sum(1 for c in clubs.values() if c["website"])
    have_year = sum(1 for c in clubs.values() if c["founded"])
    print(f"\nWrote {OUT.relative_to(ROOT)}: {len(clubs)} clubs, "
          f"{have_site} websites, {have_year} founding years.")


if __name__ == "__main__":
    main()
