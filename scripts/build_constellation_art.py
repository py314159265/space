#!/usr/bin/env python3
"""Original constellation silhouettes, anchored to catalog stars.

These drawings are made for this site. They are not traced from a
published atlas.
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
STARS = ROOT / "sky" / "data" / "stars.json"
OUT = ROOT / "sky" / "data" / "art"
SIZE = 420


def load_stars():
    data = json.loads(STARS.read_text())
    by_hip = {}
    for row in data["s"]:
        by_hip[row[4]] = {"ra": row[0], "dec": row[1], "mag": row[2]}
    return by_hip


class Fig:
    def __init__(self, by_hip, hips):
        pts = []
        for hip in hips:
            if hip not in by_hip:
                raise SystemExit(f"missing HIP {hip}")
            s = by_hip[hip]
            pts.append((hip, s["ra"] * 15.0, s["dec"]))
        ra0 = sum(p[1] for p in pts) / len(pts)
        dec0 = sum(p[2] for p in pts) / len(pts)
        cosd = max(0.2, abs(__import__("math").cos(dec0 * 3.14159265 / 180)))
        self.raw = {}
        xs, ys = [], []
        for hip, ra, dec in pts:
            east = (ra - ra0) * cosd
            north = dec - dec0
            self.raw[hip] = (east, north)
            xs.append(east)
            ys.append(north)
        pad = 0.55
        self.minx = min(xs) - (max(xs) - min(xs) + 1) * pad
        self.maxx = max(xs) + (max(xs) - min(xs) + 1) * pad
        self.miny = min(ys) - (max(ys) - min(ys) + 1) * pad
        self.maxy = max(ys) + (max(ys) - min(ys) + 1) * pad
        self.span = max(self.maxx - self.minx, self.maxy - self.miny, 1)
        self.scale = (SIZE - 8) / self.span
        self.ox = (SIZE - (self.maxx - self.minx) * self.scale) / 2 - self.minx * self.scale
        self.oy = (SIZE - (self.maxy - self.miny) * self.scale) / 2 + self.maxy * self.scale
        self.mask = Image.new("L", (SIZE, SIZE), 0)
        self.draw = ImageDraw.Draw(self.mask)
        self.anchors = []
        for hip, (east, north) in self.raw.items():
            x, y = self.p(east, north)
            self.anchors.append({"hip": hip, "x": round(x, 1), "y": round(y, 1)})

    def p(self, east, north):
        return (east * self.scale + self.ox, self.oy - north * self.scale)

    def at(self, hip):
        east, north = self.raw[hip]
        return east, north

    def blend(self, a, b, t):
        return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)

    def ell(self, center, rx, ry, rot=0):
        cx, cy = self.p(*center)
        rx *= self.scale
        ry *= self.scale
        box = [cx - rx, cy - ry, cx + rx, cy + ry]
        self.draw.ellipse(box, fill=210)

    def poly(self, points):
        self.draw.polygon([self.p(*q) for q in points], fill=200)

    def stroke(self, a, b, width):
        self.draw.line([self.p(*a), self.p(*b)], fill=200, width=max(2, int(width * self.scale)))

    def save(self, path):
        soft = self.mask.filter(ImageFilter.GaussianBlur(radius=1.6))
        white = Image.new("L", (SIZE, SIZE), 255)
        img = Image.merge("RGBA", (white, white, white, soft))
        img.save(path, "WEBP", quality=68, method=6)


def person(fig, head, feet, shoulder=None, club=None, shield=None):
    body = fig.blend(head, feet, 0.45)
    fig.ell(body, abs(head[0] - feet[0]) * 0.28 + 1.2, abs(head[1] - feet[1]) * 0.42 + 1.4)
    fig.ell(fig.blend(head, feet, -0.12), 1.1, 1.3)
    if shoulder and club:
        fig.stroke(shoulder, club, 0.7)
        fig.ell(club, 0.8, 0.8)
    if shoulder and shield:
        fig.ell(shield, 1.6, 2.2)


BY = None


def S(hip):
    return BY.raw[hip]


def build():
    global BY
    by_hip = load_stars()
    specs = {
        "Ori": [27989, 25336, 24436, 27366, 26727, 26311, 25930],
        "Tau": [21421, 25428, 20889, 17702, 17499],
        "Gem": [37826, 36850, 32349] if False else [37826, 36850, 31681, 30343, 34693],
        "CMa": [32349, 33579, 34444, 30324, 30122],
        "UMa": [54061, 53910, 58001, 59774, 62956, 65378, 67301],
        "UMi": [11767, 72607, 75097, 77055, 79822],
        "Cas": [3179, 746, 4427, 6686, 8886],
        "Cyg": [102098, 100453, 95947, 97165, 102488],
        "Lyr": [91262, 91926, 92420, 93194],
        "Aql": [97649, 97278, 95501, 98036],
        "Sco": [80763, 81266, 82396, 86228, 85927],
        "Sgr": [88635, 90185, 92041, 93506, 92855],
        "Leo": [49669, 50583, 57632, 54879, 48455],
        "Vir": [65474, 66249, 61941, 68520],
        "And": [677, 5447, 9640],
        "Per": [15863, 14576, 17358, 18532],
        "Peg": [113963, 113881, 1067, 107315],
        "Ari": [9884, 8903, 8832],
        "Psc": [9487, 118268, 113889],
        "Aqr": [106278, 109074, 110395, 110960],
        "Cap": [100345, 100064, 102485, 106985],
        "Lib": [72622, 74785, 76333, 73714],
        "Cnc": [42911, 40526, 44066, 43103],
        "Boo": [69673, 72105, 74666, 71075],
        "Her": [84345, 80816, 81693, 80170],
        "Dra": [85670, 87833, 87585, 75458, 80331],
        "Aur": [24608, 28360, 28380, 23416],
        "Cep": [105199, 106032, 112724, 116727],
        "Cru": [60718, 62434, 59747, 61084],
        "Cen": [71683, 68702, 61932],
    }
    # Drop hips missing from the bright subset.
    clean = {}
    for cid, hips in specs.items():
        keep = [h for h in hips if h in by_hip]
        if len(keep) < 3:
            print("skip", cid, "only", keep)
            continue
        clean[cid] = keep

    OUT.mkdir(parents=True, exist_ok=True)
    index = {}
    drawers = {
        "Ori": draw_ori, "Tau": draw_tau, "Gem": draw_gem, "CMa": draw_dog,
        "UMa": draw_bear, "UMi": draw_bear, "Cas": draw_queen, "Cyg": draw_swan,
        "Lyr": draw_lyre, "Aql": draw_eagle, "Sco": draw_scorpion, "Sgr": draw_archer,
        "Leo": draw_lion, "Vir": draw_person, "And": draw_person, "Per": draw_hero,
        "Peg": draw_horse, "Ari": draw_ram, "Psc": draw_fish, "Aqr": draw_bearer,
        "Cap": draw_goat, "Lib": draw_scales, "Cnc": draw_crab, "Boo": draw_person,
        "Her": draw_hero, "Dra": draw_serpent, "Aur": draw_person, "Cep": draw_king,
        "Cru": draw_cross, "Cen": draw_centaur,
    }
    for cid, hips in clean.items():
        fig = Fig(by_hip, hips)
        BY = fig
        drawers[cid](fig)
        path = OUT / f"{cid.lower()}.webp"
        fig.save(path)
        index[cid] = {"file": path.name, "w": SIZE, "h": SIZE, "anchors": fig.anchors}
        print(cid, path.stat().st_size)
    (OUT / "index.json").write_text(json.dumps(index))
    credits = {
        "note": "Silhouettes drawn for this site and dedicated to the public domain. They are not copied from a printed atlas.",
        "license": "CC0-1.0",
        "figures": {cid: {"source": "Original drawing", "author": "Nightglass", "year": 2026, "license": "CC0-1.0"} for cid in index},
    }
    (OUT / "credits.json").write_text(json.dumps(credits, indent=2))
    print("total", sum(p.stat().st_size for p in OUT.glob("*.webp")))


def draw_ori(f):
    bet, bel, rig, sai = f.at(27989), f.at(25336), f.at(24436), f.at(27366)
    shoulders = f.blend(bet, bel, 0.5)
    feet = f.blend(rig, sai, 0.5)
    person(f, shoulders, feet, bet, f.blend(bet, shoulders, -1.3), f.blend(bel, shoulders, -0.8))
    f.ell(f.blend(bet, rig, 0.55), 1.3, 2.2)


def draw_tau(f):
    face = f.at(21421)
    horn = f.at(25428)
    f.ell(face, 3.2, 2.4)
    f.stroke(face, horn, 0.9)
    f.ell(horn, 1.1, 0.7)
    if 20889 in f.raw:
        f.stroke(face, f.at(20889), 0.7)
    f.ell(f.blend(face, horn, -0.4), 1.4, 1.0)


def draw_gem(f):
    a, b = f.at(37826), f.at(36850)
    person(f, a, f.blend(a, b, 1.8), a, f.blend(a, b, -0.6), None)
    person(f, b, f.blend(b, a, 1.8), b, None, f.blend(b, a, -0.5))


def draw_dog(f):
    nose, hip = f.at(32349), f.at(33579)
    f.ell(f.blend(nose, hip, 0.45), 3.5, 2.0)
    f.ell(nose, 1.5, 1.2)
    f.stroke(hip, f.blend(hip, nose, -0.7), 0.6)


def draw_bear(f):
    hips = list(f.raw.values())
    north = max(hips, key=lambda p: p[1])
    south = min(hips, key=lambda p: p[1])
    f.ell(f.blend(north, south, 0.4), 4.5, 2.4)
    f.ell(north, 1.8, 1.5)
    f.stroke(south, f.blend(south, north, -0.35), 0.5)


def draw_queen(f):
    pts = list(f.raw.values())
    c = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    f.ell(c, 4, 2.2)
    f.ell((c[0], c[1] + 2.5), 1.3, 1.4)


def draw_swan(f):
    body = f.at(100453) if 100453 in f.raw else list(f.raw.values())[0]
    tail = f.at(102098) if 102098 in f.raw else body
    wing = f.at(97165) if 97165 in f.raw else body
    f.ell(body, 2.2, 1.4)
    f.stroke(body, tail, 0.8)
    f.stroke(body, wing, 0.7)
    f.ell(tail, 0.9, 0.6)


def draw_lyre(f):
    pts = list(f.raw.values())
    c = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    f.ell(c, 2.2, 3.0)
    f.stroke((c[0] - 1.5, c[1] + 2), (c[0] + 1.5, c[1] + 2), 0.4)


def draw_eagle(f):
    body = f.at(97649)
    wing = f.at(97278) if 97278 in f.raw else body
    f.ell(body, 1.6, 2.4)
    f.stroke(body, wing, 0.8)
    f.ell(f.blend(body, wing, 1.3), 0.8, 0.6)


def draw_scorpion(f):
    pts = sorted(f.raw.values(), key=lambda p: p[0])
    for a, b in zip(pts, pts[1:]):
        f.stroke(a, b, 0.9)
    f.ell(pts[0], 1.4, 1.0)
    f.ell(pts[-1], 0.8, 0.8)


def draw_archer(f):
    pts = list(f.raw.values())
    c = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    f.ell(c, 3.2, 2.6)
    f.ell((c[0], c[1] + 2.2), 1.2, 1.3)
    f.stroke((c[0] - 2, c[1] + 1), (c[0] + 2.4, c[1] + 2.4), 0.45)


def draw_lion(f):
    head = f.at(49669)
    hip = f.at(57632) if 57632 in f.raw else f.at(50583)
    f.ell(f.blend(head, hip, 0.4), 4.2, 2.2)
    f.ell(head, 1.8, 1.5)
    f.stroke(hip, f.blend(hip, head, -0.4), 0.6)


def draw_person(f):
    pts = list(f.raw.values())
    north = max(pts, key=lambda p: p[1])
    south = min(pts, key=lambda p: p[1])
    person(f, north, south)


def draw_hero(f):
    pts = list(f.raw.values())
    north = max(pts, key=lambda p: p[1])
    south = min(pts, key=lambda p: p[1])
    person(f, north, south, north, f.blend(north, south, -0.8), None)


def draw_horse(f):
    pts = list(f.raw.values())
    c = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    f.ell(c, 4.0, 2.6)
    east = max(pts, key=lambda p: p[0])
    f.ell(east, 1.6, 1.3)
    f.stroke(c, f.blend(c, east, 1.5), 0.5)


def draw_ram(f):
    pts = list(f.raw.values())
    c = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    f.ell(c, 2.4, 1.6)
    f.stroke((c[0] - 1, c[1] + 1), (c[0] - 2.4, c[1] + 2.2), 0.45)
    f.stroke((c[0] + 1, c[1] + 1), (c[0] + 2.4, c[1] + 2.2), 0.45)


def draw_fish(f):
    pts = list(f.raw.values())
    for p in pts:
        f.ell(p, 1.8, 0.9)
    if len(pts) >= 2:
        f.stroke(pts[0], pts[-1], 0.35)


def draw_bearer(f):
    pts = list(f.raw.values())
    north = max(pts, key=lambda p: p[1])
    south = min(pts, key=lambda p: p[1])
    person(f, north, south)
    f.stroke(south, f.blend(south, north, -0.5), 0.4)


def draw_goat(f):
    pts = list(f.raw.values())
    c = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    f.ell(c, 2.8, 1.7)
    f.stroke((c[0] - 0.6, c[1] + 1.2), (c[0] - 1.8, c[1] + 2.6), 0.4)
    f.stroke((c[0] + 0.6, c[1] + 1.2), (c[0] + 1.8, c[1] + 2.6), 0.4)


def draw_scales(f):
    pts = list(f.raw.values())
    top = max(pts, key=lambda p: p[1])
    f.stroke((top[0] - 2.5, top[1]), (top[0] + 2.5, top[1]), 0.35)
    f.ell((top[0] - 2.2, top[1] - 1.4), 1.1, 0.7)
    f.ell((top[0] + 2.2, top[1] - 1.4), 1.1, 0.7)
    f.stroke(top, (top[0], top[1] - 1.6), 0.3)


def draw_crab(f):
    pts = list(f.raw.values())
    c = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    f.ell(c, 2.2, 1.5)
    f.stroke((c[0] - 1.5, c[1] + 0.8), (c[0] - 3, c[1] + 2), 0.4)
    f.stroke((c[0] + 1.5, c[1] + 0.8), (c[0] + 3, c[1] + 2), 0.4)


def draw_serpent(f):
    pts = sorted(f.raw.values(), key=lambda p: p[0])
    for a, b in zip(pts, pts[1:]):
        f.stroke(a, b, 1.1)
    f.ell(pts[-1], 1.2, 0.9)


def draw_king(f):
    pts = list(f.raw.values())
    c = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    f.poly([(c[0] - 2, c[1] - 2), (c[0] + 2, c[1] - 2), (c[0] + 2.6, c[1] + 2), (c[0] - 2.6, c[1] + 2)])
    f.ell((c[0], c[1] + 2.6), 1.1, 1.2)


def draw_cross(f):
    pts = list(f.raw.values())
    c = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    north = max(pts, key=lambda p: p[1])
    south = min(pts, key=lambda p: p[1])
    east = max(pts, key=lambda p: p[0])
    west = min(pts, key=lambda p: p[0])
    f.stroke(north, south, 0.9)
    f.stroke(east, west, 0.9)
    f.ell(c, 0.7, 0.7)


def draw_centaur(f):
    pts = list(f.raw.values())
    c = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    f.ell(c, 3.4, 2.0)
    f.ell((c[0] + 1.5, c[1] + 2.2), 1.2, 1.4)


if __name__ == "__main__":
    build()
