#!/usr/bin/env python3
"""Generate assets/js/data.js straight from the master spreadsheet.

Run this again whenever the master xlsx changes:
    python3 scripts/gen-teams.py "/path/to/KTFCSA App Base MASTER Data.xlsx"

Values are copied verbatim. Numbers stored as numbers, text left as text.
"""
import datetime
import json
import pathlib
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
SRC = sys.argv[1] if len(sys.argv) > 1 else str(
    pathlib.Path.home() / "Downloads" / "KTFCSA App Base MASTER Data.xlsx"
)
OUT = pathlib.Path(__file__).resolve().parent.parent / "assets" / "js" / "data.js"


def read_rows(path):
    z = zipfile.ZipFile(path)
    shared = []
    root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    for si in root.findall(NS + "si"):
        shared.append("".join(t.text or "" for t in si.iter(NS + "t")))
    sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    rows = []
    for row in sheet.iter(NS + "row"):
        cells = {}
        for c in row.findall(NS + "c"):
            col = re.match(r"[A-Z]+", c.get("r")).group()
            v = c.find(NS + "v")
            if v is None:
                inline = c.find(NS + "is")
                val = "".join(x.text or "" for x in inline.iter(NS + "t")) if inline is not None else ""
            elif c.get("t") == "s":
                val = shared[int(v.text)]
            else:
                val = v.text or ""
            if val != "":
                cells[col] = val
        if cells:
            rows.append(cells)
    return rows


def as_date(v):
    try:
        return (datetime.date(1899, 12, 30) + datetime.timedelta(days=float(v))).isoformat()
    except (TypeError, ValueError):
        return v or ""


def as_time(v):
    try:
        mins = round(float(v) * 24 * 60)
        return "%02d:%02d" % (mins // 60, mins % 60)
    except (TypeError, ValueError):
        return v or ""


def as_num(v):
    """Return an int/float when the cell is numeric, otherwise the original text."""
    if v in (None, ""):
        return None
    try:
        f = float(v)
        return int(f) if f == int(f) else f
    except (TypeError, ValueError):
        return v


def slug(name):
    s = name.lower().replace("'", "").replace("&", "and")
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


# Corrections to the master spreadsheet, applied on every regenerate.
#
# The spreadsheet stays the source of truth. These are cases where a value was
# checked against the Post Office database or OpenStreetMap and found to be
# wrong, so the app does not keep reintroducing the error. Fix the spreadsheet
# and the entry here can go.
# Ground locations, checked one at a time.
#
# The coordinates in the spreadsheet were approximate and several were wrong
# enough to matter: Leiston pointed at 36 Charles Adams Close, a private house,
# and Alvechurch was three kilometres out. These come from the football pitch
# or stadium that OpenStreetMap has for each club, confirmed by reverse
# geocoding onto the right street. Three grounds are not in OpenStreetMap at
# all, so they use their postcode centroid, which is at least on the right road
# and never somebody's garden.
# True where the coordinate was confirmed to sit on a football pitch or
# stadium in OpenStreetMap. Directions use the coordinate for these, because it
# lands on the pitch itself. The three that are false are not mapped as grounds
# anywhere, so they fall back to the postcode, which reaches the right street.
GROUND_VERIFIED = {
    "leamington": False,
    "needham-market": False,
    "worcester-city": False,
}

GROUND_LOCATIONS = {
    "alvechurch": (52.344853, -1.956302),  # osm: Alvechurch FC
    "anstey-nomads": (52.675751, -1.18028),  # osm: Anstey Nomads FC
    "banbury-united": (52.056795, -1.325824),  # osm: Spencer Stadium
    "bishops-stortford": (51.872726, 0.191966),  # osm: Woodside Park
    "bromsgrove-sporting": (52.339631, -2.05642),  # osm: Bromsgrove Sporting F.C.
    "bury-town": (52.248897, 0.721095),  # osm: Bury Town Football Club (Ram Meadow)
    "halesowen-town": (52.453882, -2.057641),  # osm: The Grove
    "hitchin-town": (51.954562, -0.28416),  # osm: Hitchin Town Football Club
    "leamington": (52.255908, -1.52781),  # postcode: ground not in OpenStreetMap
    "leighton-town": (51.912889, -0.659649),  # osm: Leighton Town Football Club
    "leiston": (52.204388, 1.571449),  # osm: Leiston Football Club
    "needham-market": (52.152637, 1.054708),  # postcode: ground not in OpenStreetMap
    "peterborough-sports": (52.593801, -0.254297),  # osm: Peterborough Sports FC
    "racing-club-warwick": (52.275459, -1.601626),  # osm: unnamed soccer pitch
    "real-bedford": (52.127799, -0.415085),  # osm: Real Bedford Pitch
    "redditch-united": (52.307313, -1.952688),  # osm: unnamed soccer pitch
    "rushall-olympic": (52.600864, -1.952292),  # osm: unnamed soccer pitch
    "stamford": (52.665553, -0.46893),  # osm: Borderville
    "stourbridge": (52.462455, -2.151193),  # osm: unnamed soccer pitch
    "stratford-town": (52.19414, -1.67637),  # osm: Stratford Town Football Club
    "worcester-city": (52.22158, -2.220699),  # postcode: ground not in OpenStreetMap
}

CORRECTIONS = {
    "bury-town": {
        # Checked against burytownfc.com on 11 August 2026, which lists Adults
        # £13, Concessions £9, Under 16s £4, Under 10s free. The sheet had £12,
        # £8 and £5.
        "adultPrice": 13,
        "concessionPrice": 9,
        "youthPrice": 4,
        "childPrice": "Free",
        "youthRange": "10-15",
        "childRange": "Under 10",
        "priceChecked": "2026-08-11",
        "priceSource": "Bury Town official website",
    },
    "peterborough-sports": {
        # Checked against the club's admission prices page on 11 August 2026:
        # adult £15 on the day, concession £13. The sheet had £14 and £10.
        "adultPrice": 15,
        "concessionPrice": 13,
        "priceChecked": "2026-08-11",
        "priceSource": "Peterborough Sports official website",
    },
    "racing-club-warwick": {
        # CV34 4EJ is not a real postcode. The pub name was right: the Rose &
        # Crown is on Market Place, 570 m from Townsend Meadow.
        "pubPostcode": "CV34 4SH",
    },
    "stourbridge": {
        # DY8 1JR is not a real postcode, and was on both the car park and the
        # pub. Parking is at the ground itself, so it takes the ground's own
        # postcode. The Chequers Inn is at 95 High Street, Oldswinford, 560 m
        # from the ground.
        "carParkPostcode": "DY8 4HN",
        "pubPostcode": "DY8 1EQ",
    },
    "worcester-city": {
        # WR3 72N is not a postcode at all, and was on both the car park and
        # the pub. Parking is at the ground. The Mug House is on Claines Lane,
        # 600 m away, and the name in the sheet was right.
        "carParkPostcode": "WR3 7PS",
        "pubPostcode": "WR3 7RN",
    },
    "real-bedford": {
        # MK41 9AL is a real postcode but it is in Putnoe, over three
        # kilometres from the ground. MK44 3LW lands 480 m from the
        # coordinates already in the sheet, which were right all along, and
        # next door to the MK44 3SB car park.
        "postcode": "MK44 3LW",
    },
    "stratford-town": {
        # CV37 9NQ is in Stratford Hathaway, three and a half kilometres from
        # the ground. Stratford Town play on Knights Lane in Tiddington, which
        # OpenStreetMap names, and CV37 7BY is the nearest postcode to it.
        "postcode": "CV37 7BY",
    },
    "rushall-olympic": {
        # WS4 1SJ is not a real postcode, and the coordinates sat in West
        # Northamptonshire, about 15 miles from Kettering rather than 66.
        # The club is at Dales Lane, Rushall, confirmed at 124 m from the
        # WS4 1LJ centroid, which the sheet already uses for the car park.
        "postcode": "WS4 1LJ",
        "lat": 52.6011,
        "lng": -1.9525,
    },
}


def apply_corrections(team):
    fix = CORRECTIONS.get(team["id"])
    if fix:
        team.update(fix)
    here = GROUND_LOCATIONS.get(team["id"])
    if here:
        team["lat"], team["lng"] = here
    team["groundVerified"] = GROUND_VERIFIED.get(team["id"], True)
    return team


rows = read_rows(SRC)
header = rows[0]
teams = []

for cells in rows[1:]:
    if "A" not in cells:
        continue
    r = {header.get(k, k): v for k, v in cells.items()}
    coords = (r.get("Coordinates (Lat, Long)") or "").split(",")
    lat = float(coords[0].strip()) if len(coords) == 2 else None
    lng = float(coords[1].strip()) if len(coords) == 2 else None
    teams.append({
        "id": slug(r["Team Name"]),
        "name": r["Team Name"],
        "nickname": r.get("Team Nickname", ""),
        "stadium": r.get("Ground Name", ""),
        "postcode": r.get("Postcode", ""),
        "capacity": as_num(r.get("Ground Capacity")),
        "lat": lat,
        "lng": lng,
        "distanceMiles": as_num(r.get("Miles from Latimer Park")),
        "homeDate": as_date(r.get("Fixture Date (Home)")),
        "homeKickoff": as_time(r.get("Kick-off (Home)")),
        "awayDate": as_date(r.get("Fixture Date (Away)")),
        "awayKickoff": as_time(r.get("Kick-off (Away)")),
        "adultPrice": as_num(r.get("Adult Price")),
        "concessionPrice": as_num(r.get("Concession Price")),
        "youthPrice": as_num(r.get("Youth Price")),
        "youthRange": r.get("Youth Range", ""),
        "childPrice": as_num(r.get("Child Price")),
        "childRange": r.get("Child Range", ""),
        "ticketNotes": r.get("Ticket Notes", ""),
        "carPark": r.get("Nearest Car Park", ""),
        "carParkPostcode": r.get("Car Park Postcode", ""),
        "parkingHourly": r.get("Average Hourly Parking Cost", ""),
        "parkingDaily": r.get("Estimated Daily Parking Rate", ""),
        "pub": r.get("Nearby Pub", ""),
        "pubPostcode": r.get("Pub Postcode", ""),
        "fact": r.get("Factoid about Opposition", ""),
    })

teams = [apply_corrections(t) for t in teams]
teams.sort(key=lambda t: t["name"])
body = ",\n".join("  " + json.dumps(t, ensure_ascii=False) for t in teams)

OUT.write_text(
    "/* Generated by scripts/gen-teams.py from the master spreadsheet. Do not edit by hand. */\n"
    "export const KTFC = {\n"
    '  name: "Kettering Town",\n'
    '  ground: "Latimer Park",\n'
    '  street: "Polwell Lane, Burton Latimer",\n'
    '  town: "Kettering",\n'
    '  postcode: "NN15 5PS",\n'
    "  lat: 52.366747,\n"
    "  lng: -0.690147,\n"
    "  /* Confirmed from the club's own ticketing, 2026/27. */\n"
    "  adultPrice: 15,\n"
    '  adultRange: "18\\u201360",\n'
    "  concessionPrice: 10,\n"
    '  concessionRange: "60+ or NUS card",\n'
    "  youthPrice: 5,\n"
    '  youthRange: "11\\u201318, secondary school age",\n'
    "  childPrice: 2,\n"
    '  childRange: "Under 11",\n'
    "};\n\n"
    "export const TEAMS = [\n" + body + "\n];\n",
    encoding="utf-8",
)
print("Wrote %s (%d clubs)" % (OUT, len(teams)))
