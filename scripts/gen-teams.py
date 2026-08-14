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
    "anstey-nomads": {
        # From the club's own account, 13 August 2026: Adults £10,
        # Concessions £6, Under 18s £3, and junior members in free with a
        # membership pass. The sheet had £7 concessions and £5 youth.
        "adultPrice": 10,
        "concessionPrice": 6,
        "youthPrice": 3,
        "youthRange": "Under 18",
        "ticketNotes": "Junior members get in free with a membership pass.",
        "priceChecked": "2026-08-13",
        "priceSource": "Anstey Nomads, via the club's own posts",
    },
    "bromsgrove-sporting": {
        # Checked 13 August 2026. Their page leads with season tickets; the
        # gate prices are underneath. At the gate: Adult £14, Concessions £11,
        # Teens £8, Junior £4, under fives free. A pound less online. The sheet
        # had £12 and £9.
        "adultPrice": 14,
        "concessionPrice": 11,
        "youthPrice": 8,
        "youthRange": "13-17",
        "childPrice": 4,
        "childRange": "5-12 (under 5s free)",
        "ticketNotes": ("A pound off every band bought online. Cash or card at the turnstile. "
                        "Teens and juniors must be with an adult, and a carer comes in free."),
        "priceChecked": "2026-08-13",
        "priceSource": "Bromsgrove Sporting official website",
    },
    "stamford": {
        "adultPrice": 13,
        "concessionPrice": 9,
        "youthPrice": 5,
        "youthRange": '12-17',
        "childPrice": 'Free',
        "childRange": '11 and under, with a paying adult',
        "ticketNotes": 'Concessions cover over 60s, Blue Light card holders and students.',
        "priceChecked": '2026-08-13',
        "priceSource": 'Stamford AFC official website',
    },
    "leiston": {
        "adultPrice": 13,
        "concessionPrice": 10,
        "youthPrice": 3,
        "youthRange": 'Under 16',
        "childPrice": 'Free',
        "childRange": 'Under 5',
        "ticketNotes": 'Students with ID pay £8. Under 5s go in free.',
        "priceChecked": '2026-08-13',
        "priceSource": 'Leiston official website',
    },
    "redditch-united": {
        "adultPrice": 14,
        "concessionPrice": 10,
        "youthPrice": 10,
        "youthRange": '14-18',
        "childPrice": 'Free',
        "childRange": '13 and under',
        "parkingHourly": '£3',
        "parkingDaily": '£3',
        "ticketNotes": 'Concessions cover 65s and over, 14 to 18 year olds and students. Parking is £3 a vehicle.',
        "priceChecked": '2026-08-13',
        "priceSource": 'Redditch United official website',
    },
    "halesowen-town": {
        "adultPrice": 14,
        "concessionPrice": 11,
        "youthPrice": 7,
        "youthRange": '13-17',
        "childPrice": 4,
        "childRange": 'Under 12',
        "ticketNotes": 'Students under 21 pay £11 with a valid card. Teenagers need an adult or a Yeltz membership card.',
        "priceChecked": '2026-08-13',
        "priceSource": 'Halesowen Town official website',
    },
    "needham-market": {
        "adultPrice": 14,
        "concessionPrice": 9,
        "youthPrice": 5,
        "youthRange": '12-16',
        "childPrice": 'Free',
        "childRange": 'Under 12, accompanied',
        "ticketNotes": 'Students with valid ID pay £9.',
        "priceChecked": '2026-08-13',
        "priceSource": 'Needham Market ticketing',
    },
    "banbury-united": {
        "adultPrice": 15,
        "concessionPrice": 13,
        "youthPrice": 8,
        "youthRange": 'Under 18',
        "childPrice": 'Free',
        "childRange": 'Under 11',
        "ticketNotes": "Away fans' general admission on the day. A pound less booked in advance: £14 adult, £12 concession, £7 under 18.",
        "priceChecked": '2026-08-13',
        "priceSource": 'Banbury United ticketing',
    },
    "alvechurch": {
        "adultPrice": 12,
        "concessionPrice": 10,
        "youthPrice": 7,
        "youthRange": '13-17',
        "childPrice": 'Free',
        "childRange": 'Under 13, with a paying adult',
        "ticketNotes": 'Two pounds off every band bought online. The club has not published 2026/27 prices, so these are its 2024/25 ones.',
        "priceChecked": '2026-08-13',
        "priceSeason": '2024/25',
        "priceSource": 'Alvechurch official website',
    },
    "hitchin-town": {
        # Checked 13 August 2026. Hitchin charge a premium at the gate: £17
        # adult and £12 concession on the day, against £15 and £10 bought
        # online. The sheet had £14 and £10. This column is what you pay at the
        # turnstile, so it takes the dearer set.
        "adultPrice": 17,
        "concessionPrice": 12,
        "youthPrice": 6,
        "youthRange": "13-19",
        "childPrice": 4,
        "childRange": "Under 13, with an adult",
        "ticketNotes": ("Two pounds cheaper on every band bought online before the game. "
                        "Concessions are 60+ or students 20+ with ID, and a carer comes in free."),
        "priceChecked": "2026-08-13",
        "priceSource": "Hitchin Town official website",
    },
    "leamington": {
        # Checked against the club's own admission prices page for 2026/27 on
        # 12 August 2026. Adults £16, Over 60s £12, Students £9, Under 18s £6,
        # Under 12s free, all three pounds less bought online in advance. The
        # sheet had £14 and £10, and parking at £8 to £10 when it is a fiver.
        "adultPrice": 16,
        "concessionPrice": 12,
        "youthPrice": 6,
        "youthRange": "12-17",
        "childPrice": "Free",
        "childRange": "Under 12",
        "parkingHourly": "£5",
        "parkingDaily": "£5 on the day, £3 in advance",
        "ticketNotes": ("Every price is £1 less bought online before match day. Students £9, "
                        "and serving Armed Forces get half price with military ID at the turnstile."),
        "priceChecked": "2026-08-12",
        "priceSource": "Leamington official website",
    },
    "leighton-town": {
        # Checked against the club's own admission prices page for 2026/27 on
        # 10 August 2026: Adults £13, Concession £8, 12-17 £4, Under 12 free.
        # The sheet had £10 and £7, so a supporter turning up with a tenner
        # would have been three pounds short.
        "adultPrice": 13,
        "concessionPrice": 8,
        "priceChecked": "2026-08-10",
        "priceSource": "Leighton Town official website",
    },
    "bishops-stortford": {
        # Checked 10 August 2026. Adult and concession were already right. The
        # youth band is 8 rather than 6. Note the club's page also lists a
        # cheaper pre-season block, which is not what a supporter pays now.
        "youthPrice": 8,
        "priceChecked": "2026-08-10",
        "priceSource": "Bishop's Stortford official website",
    },
    "peterborough-sports": {
        # The club publishes two sets and an earlier pass here mixed them: the
        # online adult price with the matchday concession. These are the gate
        # prices, which is what this column means. Buying online before the
        # Friday saves three pounds on an adult.
        # Checked 10 August 2026: gate Adult £18, Concession £13, U18 £10,
        # U13 £5, U3 free. Online Adult £15, Concession £10, U18 £7, U13 £3.
        "adultPrice": 18,
        "concessionPrice": 13,
        "youthPrice": 10,
        "youthRange": "13-17",
        "childPrice": 5,
        "childRange": "Under 13",
        "ticketNotes": "Cash and card on the gate. Buying online before Friday 23:45 saves £3 on an adult.",
        "priceChecked": "2026-08-10",
        "priceSource": "Peterborough Sports official website",
    },
    "racing-club-warwick": {
        # CV34 4EJ is not a real postcode. The pub name was right: the Rose &
        # Crown is on Market Place, 570 m from Townsend Meadow.
        "pubPostcode": "CV34 4SH",
        "adultPrice": 8,
        "concessionPrice": 5,
        "youthPrice": 'Free',
        "youthRange": 'Under 16',
        "childPrice": 'Free',
        "childRange": 'Under 16',
        "ticketNotes": "Students with ID and under 16s go in free. These are the club's 2025/26 prices, the most recent published.",
        "priceChecked": '2026-08-13',
        "priceSeason": '2025/26',
        "priceSource": 'Racing Club Warwick',
    },
    "stourbridge": {
        # DY8 1JR is not a real postcode, and was on both the car park and the
        # pub. Parking is at the ground itself, so it takes the ground's own
        # postcode. The Chequers Inn is at 95 High Street, Oldswinford, 560 m
        # from the ground.
        "carParkPostcode": "DY8 4HN",
        "pubPostcode": "DY8 1EQ",
        "adultPrice": 14,
        "concessionPrice": 11,
        "youthPrice": 8,
        "youthRange": '13-17',
        "childPrice": 6,
        "childRange": '6-12',
        "ticketNotes": 'Prices at the ticket office on the afternoon, a pound less bought in advance. Tickets for 13 to 17 year olds must be bought online, none are sold at the ground. From 1.15pm entry is via the Church End turnstiles.',
        "priceChecked": '2026-08-13',
        "priceSource": 'Stourbridge official website',
    },
    "worcester-city": {
        # WR3 72N is not a postcode at all, and was on both the car park and
        # the pub. Parking is at the ground. The Mug House is on Claines Lane,
        # 600 m away, and the name in the sheet was right.
        "carParkPostcode": "WR3 7PS",
        "pubPostcode": "WR3 7RN",
        # Checked 10 August 2026 against the club's published gate prices:
        # Adults £14, Concessions £9.50 (66+ or student), Youths £5 (12-17),
        # Juniors £3 (under 12 with an adult). Every band was out, and under
        # 12s are not free here.
        "adultPrice": 14,
        "concessionPrice": 9.5,
        "youthPrice": 5,
        "childPrice": 3,
        "childRange": "Under 12, with an adult",
        "priceChecked": "2026-08-10",
        "priceSource": "Worcester City official website",
    },
    "real-bedford": {
        # MK41 9AL is a real postcode but it is in Putnoe, over three
        # kilometres from the ground. MK44 3LW lands 480 m from the
        # coordinates already in the sheet, which were right all along, and
        # next door to the MK44 3SB car park.
        "postcode": "MK44 3LW",
        # Away section prices, which is what a Kettering supporter pays.
        # Checked 13 August 2026: on the day Adult £14, Concession 60+ £9,
        # Youth 13-17 £6, Child under 12 £3, each two pounds less in advance.
        # The sheet had £10 and £7.
        "adultPrice": 14,
        "concessionPrice": 9,
        "youthPrice": 6,
        "youthRange": "13-17",
        "childPrice": 3,
        "childRange": "Under 12",
        "ticketNotes": ("Away section prices. Two pounds off each band booked in advance: "
                        "£12 adult, £7 concession, £4 youth, £2 child."),
        "priceChecked": "2026-08-13",
        "priceSource": "Real Bedford ticketing",
    },
    "stratford-town": {
        # CV37 9NQ is in Stratford Hathaway, three and a half kilometres from
        # the ground. Stratford Town play on Knights Lane in Tiddington, which
        # OpenStreetMap names, and CV37 7BY is the nearest postcode to it.
        "postcode": "CV37 7BY",
        "adultPrice": 14,
        "concessionPrice": 10,
        "youthPrice": 5,
        "youthRange": '12-17',
        "childPrice": 'Free',
        "childRange": 'Under 12, with a paying adult',
        "ticketNotes": 'Concessions are over 65s and full time students, ID may be asked for. Junior Bards ticket holders go in free.',
        "priceChecked": '2026-08-13',
        "priceSource": 'Stratford Town official website',
    },
    "rushall-olympic": {
        # WS4 1SJ is not a real postcode, and the coordinates sat in West
        # Northamptonshire, about 15 miles from Kettering rather than 66.
        # The club is at Dales Lane, Rushall, confirmed at 124 m from the
        # WS4 1LJ centroid, which the sheet already uses for the car park.
        "postcode": "WS4 1LJ",
        "lat": 52.6011,
        "lng": -1.9525,
        # Checked 13 August 2026 against the club's stadium page, which is
        # where they keep the prices. Adults £14, concessions £10, U18s £6,
        # U12s £2, each 50p less in advance. Parking £3. The sheet had £13.
        "adultPrice": 14,
        "concessionPrice": 10,
        "youthPrice": 6,
        "youthRange": "Under 18",
        "childPrice": 2,
        "childRange": "Under 12",
        "parkingHourly": "£3",
        "parkingDaily": "£3",
        "ticketNotes": ("Fifty pence off each band bought in advance. Concessions cover over 60s, "
                        "students with NUS, emergency services, NHS and forces with a Blue Light card."),
        "priceChecked": "2026-08-13",
        "priceSource": "Rushall Olympic official website",
    },
}


# A repeated club id in any of the tables above is legal Python and silently
# keeps only the last one, which is how a set of corrected Worcester City
# prices vanished without a word. Fail loudly instead.
def _no_duplicate_ids():
    source = pathlib.Path(__file__).read_text()
    for table in ("CORRECTIONS", "GROUND_LOCATIONS", "GROUND_VERIFIED"):
        start = source.index(f"{table} = {{")
        body = source[start : source.index("\n}\n", start)]
        ids = re.findall(r'^\s{4}"([a-z0-9-]+)":', body, re.M)
        clashes = {i for i in ids if ids.count(i) > 1}
        if clashes:
            raise SystemExit(f"{table} lists {', '.join(sorted(clashes))} more than once.")


_no_duplicate_ids()


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
