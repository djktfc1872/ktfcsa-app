#!/usr/bin/env python3
"""
Turns Darren Young's pen pics PDF into data/player-bios.json.

Two things about the PDF worth knowing before touching this. The font maps
digits to a private range, so a year comes out of the text extractor as
characters in the U+3FB2 to U+3FBB block rather than as numbers, and every
figure would be nonsense without translating them back. And the bios are keyed
on shirt number rather than name, because the pen pics and the club's squad
sheet do not always agree on a name: number 18 is "William van Lier" on one and
"Will Van Lier" on the other.

    python3 scripts/import-pen-pics.py "~/Downloads/KETTERING TOWN 26_27 - Pen Pics.pdf"
"""

import json
import pathlib
import re
import sys

try:
    from pypdf import PdfReader
except ImportError:
    raise SystemExit("pypdf is needed: pip3 install pypdf")

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "player-bios.json"

CREDIT = "Darren Young"

# The font's digits live here, zero first.
DIGIT_BASE = 0x3FB2


def digits(text):
    """Put the numbers back. Without this every year and every count is junk."""
    return "".join(
        str(ord(c) - DIGIT_BASE) if DIGIT_BASE <= ord(c) <= DIGIT_BASE + 9 else c
        for c in text
    )


def read(path):
    reader = PdfReader(str(path))
    raw = "\n".join((page.extract_text() or "") for page in reader.pages)
    return digits(raw).replace("’", "'")


def players(raw):
    """Each entry is a shirt number, a name in capitals, then the pen pic."""
    found = {}
    chunks = re.split(r"\n(?=\d{1,2}\s*\n?[A-Z][A-Z' ]+\s*\n)", raw)
    for chunk in chunks:
        head = re.match(r"\s*(\d{1,2})\s*\n?\s*([A-Z][A-Z' ]*)\n\s*([A-Z][A-Z' ]*)\n(.*)", chunk, re.S)
        if not head:
            continue
        number, _, _, body = head.groups()
        bio = re.match(r"\s*(.+?)\s*\((\w[\w /]*)\)\s*-\s*(.*)", body, re.S)
        if not bio:
            continue
        name, position, text = bio.groups()
        found[int(number)] = {
            "name": name.strip(),
            "position": position.strip(),
            "bio": re.sub(r"\s+", " ", text).strip(),
        }
    return found


def manager(raw):
    """The staff pen pic at the end, if there is one."""
    m = re.search(r"MANAGER\n(.+?)\s*\((Manager)\)\s*-\s*(.+?)(?=\n\d|\Z)", raw, re.S)
    if not m:
        return None
    return {"name": m.group(1).strip(), "role": m.group(2), "bio": re.sub(r"\s+", " ", m.group(3)).strip()}


def main():
    source = pathlib.Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else None
    if not source or not source.exists():
        raise SystemExit("Point this at the pen pics PDF.")

    raw = read(source)
    found = players(raw)
    if not found:
        raise SystemExit("No pen pics found. The PDF's layout has probably changed.")

    squad_path = ROOT / "data" / "squad.json"
    squad = {}
    if squad_path.exists():
        squad = {p["number"]: p["name"] for p in json.loads(squad_path.read_text())["players"]}

    payload = {
        "credit": CREDIT,
        "source": source.name,
        "imported": __import__("datetime").date.today().isoformat(),
        "note": (
            "Player pen pics written by Darren Young. Keyed on shirt number, because the "
            "pen pics and the club's squad sheet do not always spell a name the same way."
        ),
        "manager": manager(raw),
        "players": {str(n): found[n] for n in sorted(found)},
    }
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")

    print(f"Wrote {OUT.relative_to(ROOT)}: {len(found)} pen pics, credited to {CREDIT}.")
    if payload["manager"]:
        print(f"  manager: {payload['manager']['name']}")
    for number, entry in sorted(found.items()):
        in_squad = squad.get(number)
        if in_squad and in_squad != entry["name"]:
            print(f"  note: {number} is '{in_squad}' in the squad and '{entry['name']}' here, keyed on the number")
        elif not in_squad:
            print(f"  note: {number} '{entry['name']}' is not in squad.json")
    missing = sorted(set(squad) - set(found))
    if missing:
        print(f"  no pen pic for: {', '.join(f'{n} {squad[n]}' for n in missing)}")


if __name__ == "__main__":
    main()
