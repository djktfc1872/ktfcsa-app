#!/usr/bin/env python3
"""Download the club crests once and tidy them up.

The Southern League serves crests straight from whatever a club sent in: some
are PNGs with transparency, some are opaque, one is a GIF, and a few are 900KB
for an image shown at 30 pixels. This pulls them all in, knocks out any solid
background, trims the empty border, scales them down and writes them into
assets/crests/.

Run it after a club changes its badge, or when a new club comes up:

    python3 scripts/fetch-crests.py

It needs Pillow (pip install Pillow) and only ever runs on a person's machine,
never in CI, so the scheduled job stays dependency free.
"""
import json
import pathlib
import re
import subprocess
import sys

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "crests"
LEAGUE = ROOT / "data" / "league.json"
SIZE = 256           # plenty for a crest shown at 30-60 CSS pixels
WHITE_CUTOFF = 238   # anything lighter than this at the edge counts as background
FUZZ = 26            # how far a neighbouring pixel may drift and still be background


def slugify(name):
    s = name.lower().replace("'", "").replace("&", "and")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def fetch(url):
    """Uses curl so this works on machines where Python has no CA bundle."""
    r = subprocess.run(
        ["curl", "-sS", "-L", "--max-time", "30", "-A", "KTFCSA-app/1.0", url],
        capture_output=True,
    )
    if r.returncode != 0 or not r.stdout:
        raise RuntimeError((r.stderr or b"empty response").decode().strip()[:120])
    return r.stdout


def strip_background(img):
    """Flood fill inwards from the edges, clearing anything near-white.

    Working from the edges rather than replacing every white pixel means white
    inside the badge itself, lettering and so on, is left alone.
    """
    img = img.convert("RGBA")
    w, h = img.size
    px = img.load()

    def is_background(p):
        r, g, b, a = p
        return a < 20 or (r >= WHITE_CUTOFF and g >= WHITE_CUTOFF and b >= WHITE_CUTOFF)

    # Only bother if the border actually is background-coloured.
    edge = [px[x, 0] for x in range(w)] + [px[x, h - 1] for x in range(w)]
    edge += [px[0, y] for y in range(h)] + [px[w - 1, y] for y in range(h)]
    if sum(1 for p in edge if is_background(p)) < len(edge) * 0.9:
        return img, False

    seen = bytearray(w * h)
    stack = [(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)]
    stack += [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)]
    cleared = 0

    while stack:
        x, y = stack.pop()
        if not (0 <= x < w and 0 <= y < h):
            continue
        i = y * w + x
        if seen[i]:
            continue
        seen[i] = 1
        r, g, b, a = px[x, y]
        if a < 20:
            cleared += 1
        elif r >= WHITE_CUTOFF - FUZZ and g >= WHITE_CUTOFF - FUZZ and b >= WHITE_CUTOFF - FUZZ:
            px[x, y] = (r, g, b, 0)
            cleared += 1
        else:
            continue
        stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]

    return img, cleared > 0


def tidy(data, slug):
    from io import BytesIO

    # Genuine vector badges are already transparent and tiny. Pass them
    # through rather than rasterising and losing the crispness.
    head = data[:200].lstrip()
    if head.startswith(b"<svg") or head.startswith(b"<?xml"):
        path = OUT / f"{slug}.svg"
        path.write_bytes(data)
        return path, False

    img = Image.open(BytesIO(data))
    if getattr(img, "is_animated", False):
        img.seek(0)
    img, changed = strip_background(img)

    box = img.getbbox()
    if box:
        img = img.crop(box)

    img.thumbnail((SIZE, SIZE), Image.LANCZOS)

    # Square canvas so every crest lines up in a list.
    side = max(img.size)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2))

    path = OUT / f"{slug}.png"
    canvas.save(path, "PNG", optimize=True)
    return path, changed


def main():
    if not LEAGUE.exists():
        sys.exit("Run scripts/fetch-league.mjs first, so there is a club list to work from.")

    league = json.loads(LEAGUE.read_text())
    OUT.mkdir(parents=True, exist_ok=True)

    print(f"{'club':26} {'source':>9}  {'saved':>7}  background")
    for row in league.get("table", []):
        url = row.get("crest")
        if not url:
            continue
        slug = slugify(row.get("slug") or row["name"])
        try:
            data = fetch(url)
            path, changed = tidy(data, slug)
        except Exception as exc:  # a single bad badge must not stop the rest
            print(f"{slug:26} failed: {exc}")
            continue
        print(
            f"{slug:26} {len(data) / 1024:8.0f}K  {path.stat().st_size / 1024:6.0f}K"
            f"  {'stripped' if changed else 'already clear'}"
        )

    print(f"\nWrote {len(list(OUT.glob('*.png')))} crests to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
