#!/usr/bin/env python3
"""Keep one figure on each shared Urania's Mirror card.

Polygons are in full-plate pixels. A plate that is already only its own
figure is left alone. Aquila and Taurus are redrawn as line art; the others
keep their existing strokes and lose whatever falls outside the polygon.
"""
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PLATES = Path("/tmp/atlas")
OUT = ROOT / "sky" / "data" / "art"

# Plate file for each figure that needs a tighter mask.
SOURCE = {
    "Cyg": "cyglyr.jpg",
    "Aql": "aql.jpg",
    "Tau": "taurus.jpg",
    "Leo": "leo.jpg",
    "And": "and.jpg",
    "Per": "per.jpg",
}

# One polygon around the constellation's own figure. Neighbors on the same
# card (the fox under the swan, Antinous, the lyre, Leo Minor, the triangle)
# stay outside it.
KEEP = {
    "Cyg": [
        (470, 1040), (560, 780), (720, 400), (940, 280), (1180, 250),
        (1400, 400), (1470, 560), (1340, 760), (1180, 900),
        (1380, 1035), (1220, 960), (1000, 840), (780, 980), (500, 1060),
    ],
    "Aql": [
        (640, 780), (900, 660), (1250, 620), (1580, 700), (1780, 980),
        (1720, 1500), (1500, 1560), (1280, 1360), (1080, 1280),
        (940, 1380), (800, 1320), (720, 1220), (680, 1040),
    ],
    "Tau": [
        (340, 40), (620, 240), (980, 40), (1760, 60), (1900, 420),
        (1840, 1080), (1500, 1200), (1120, 1240), (900, 960),
        (700, 780), (500, 640), (380, 480), (320, 160),
    ],
    "Leo": [
        (60, 1480), (180, 1280), (420, 1500), (780, 1420), (1080, 1120),
        (1500, 1040), (1860, 1280), (1880, 1680), (1600, 1960),
        (1100, 1880), (700, 2140), (360, 2480), (160, 2100), (80, 1720),
    ],
    "And": [
        (460, 1080), (720, 820), (1120, 760), (1560, 820), (1820, 1120),
        (1500, 1420), (1120, 1620), (860, 2060), (560, 2140),
        (380, 1760), (360, 1280),
    ],
    "Per": [
        (240, 760), (420, 380), (780, 300), (1100, 160), (1500, 120),
        (1760, 480), (1400, 460), (1180, 360), (1080, 700),
        (1100, 1120), (780, 1080), (520, 960), (280, 1220), (220, 900),
    ],
}

# Long straight strokes that belong to a neighbor and cross the keep region.
# angle is degrees, tol is degrees, min_len is plate pixels.
ERASE_ANGLES = {
    # Sagitta's shaft, a pair of rules at about 23 degrees.
    "Aql": [(23, 5, 320)],
}
# Printed names and the plate title, kept clear of the figure's strokes.
ERASE_BOXES = {
    "Tau": [(0, 0, 1920, 72), (1860, 0, 1920, 1350)],
    # Arrowhead and the name printed on Sagitta, above the eagle's wing.
    "Aql": [(980, 660, 1280, 900)],
}

LINE_ART = {"Aql", "Tau", "Cyg", "Leo", "And", "Per"}


def mapping(cid, index, verified):
    pairs = []
    for anchor in index[cid]["anchors"]:
        hip = anchor["hip"]
        if hip not in verified[cid]:
            continue
        px, py = verified[cid][hip]
        pairs.append((px, py, anchor["x"], anchor["y"]))
    plate = np.array([[p[0], p[1]] for p in pairs], float)
    shipped = np.array([[p[2], p[3]] for p in pairs], float)
    scales = []
    for i in range(len(plate)):
        for j in range(i + 1, len(plate)):
            dp = float(np.hypot(*(plate[i] - plate[j])))
            ds = float(np.hypot(*(shipped[i] - shipped[j])))
            if dp > 30:
                scales.append(ds / dp)
    scale = float(np.median(scales))
    origin = (plate - shipped / scale).mean(0)
    return scale, origin


def line_mask(gray):
    """Engraved strokes, not the flat wash inside a figure."""
    bg = cv2.GaussianBlur(gray, (0, 0), 7)
    darker = bg.astype(np.int16) - gray.astype(np.int16)
    strokes = ((darker > 18) & (gray < 210)).astype(np.uint8) * 255
    strokes = cv2.dilate(strokes, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(strokes, 8)
    for i in range(1, n):
        area = int(stats[i, cv2.CC_STAT_AREA])
        bw = int(stats[i, cv2.CC_STAT_WIDTH])
        bh = int(stats[i, cv2.CC_STAT_HEIGHT])
        # Specks, and the short wide runs that are printed names.
        word = area < 2200 and bw > bh * 1.7 and bh < 46
        if area < 40 or word:
            strokes[lab == i] = 0
    return strokes


def plate_mask(shape, polygon):
    mask = np.zeros(shape, np.uint8)
    cv2.fillPoly(mask, [np.array(polygon, np.int32)], 255)
    return mask


def to_shipped(mask, scale, origin, size):
    """Sample a full-plate mask into the shipped crop. shipped = (plate - origin) * scale."""
    ox, oy = float(origin[0]), float(origin[1])
    width, height = size
    warp = np.array([
        [scale, 0, -scale * ox],
        [0, scale, -scale * oy],
    ], np.float32)
    return cv2.warpAffine(mask, warp, (width, height), flags=cv2.INTER_LINEAR)


def main():
    import sys
    sys.path.insert(0, str(ROOT / "scripts"))
    import build_constellation_art as build
    verified = build.VERIFIED
    index = json.loads((OUT / "index.json").read_text())
    preview = PLATES / "audit"
    preview.mkdir(exist_ok=True)
    for cid, polygon in KEEP.items():
        scale, origin = mapping(cid, index, verified)
        web_path = OUT / index[cid]["file"]
        web = np.array(Image.open(web_path).convert("RGBA"))
        plate = cv2.imread(str(PLATES / SOURCE[cid]))
        gray = cv2.cvtColor(plate, cv2.COLOR_BGR2GRAY)
        keep = plate_mask(gray.shape, polygon)
        rim = 28
        keep[:rim, :] = 0
        keep[-rim:, :] = 0
        keep[:, :rim] = 0
        keep[:, -rim:] = 0
        for x0, y0, x1, y1 in ERASE_BOXES.get(cid, []):
            keep[y0:y1, x0:x1] = 0
        if cid in LINE_ART:
            ink = line_mask(gray)
            ink[keep == 0] = 0
            for ang, tol, min_len in ERASE_ANGLES.get(cid, []):
                found = cv2.HoughLinesP(ink, 1, np.pi / 180, 70, minLineLength=min_len, maxLineGap=16)
                if found is None:
                    continue
                wipe = np.zeros_like(ink)
                for x1, y1, x2, y2 in np.asarray(found).reshape(-1, 4):
                    deg = abs(np.degrees(np.arctan2(y2 - y1, x2 - x1))) % 180
                    delta = min(abs(deg - ang), 180 - abs(deg - ang))
                    if delta <= tol and np.hypot(x2 - x1, y2 - y1) >= min_len:
                        cv2.line(wipe, (int(x1), int(y1)), (int(x2), int(y2)), 255, 10)
                ink[wipe > 0] = 0
            for _hip, (x, y) in verified[cid].items():
                cv2.circle(ink, (int(x), int(y)), 20, 0, -1)
            shipped = to_shipped(ink, scale, origin, (web.shape[1], web.shape[0]))
            alpha = np.clip(shipped.astype(np.float32), 0, 255)
            bits = (alpha > 16).astype(np.uint8) * 255
            n, lab, stats, _ = cv2.connectedComponentsWithStats(bits, 8)
            for i in range(1, n):
                top = int(stats[i, cv2.CC_STAT_TOP])
                bh = int(stats[i, cv2.CC_STAT_HEIGHT])
                area = int(stats[i, cv2.CC_STAT_AREA])
                # The arrowhead sits above the eagle and is not part of the wing.
                stub = cid == "Aql" and top + bh < 100
                if area < 160 or stub:
                    alpha[lab == i] = 0
        else:
            shipped = to_shipped(keep, scale, origin, (web.shape[1], web.shape[0]))
            alpha = web[:, :, 3].astype(np.float32) * (shipped.astype(np.float32) / 255.0)
        alpha[alpha < 8] = 0
        out = web.copy()
        out[:, :, 3] = alpha.astype(np.uint8)
        Image.fromarray(out, "RGBA").save(web_path, "WEBP", quality=68, method=4)
        cand = preview / f"cand_{cid}.webp"
        Image.fromarray(out, "RGBA").save(cand, "WEBP", quality=68, method=4)
        show = np.zeros(out.shape[:2] + (3,), np.uint8)
        show[out[:, :, 3] > 16] = 255
        Image.fromarray(show).save(preview / f"new_{cid}.jpg", quality=88)
        print(cid, "bytes", cand.stat().st_size, "ink", int((out[:, :, 3] > 16).sum()))


if __name__ == "__main__":
    main()
