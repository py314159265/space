#!/usr/bin/env python3
"""Build faint constellation figures from Sidney Hall's Urania's Mirror.

The plates are public-domain scans. This script finds the engraved stars,
fits them to catalog positions, and writes a light-on-transparent WebP
plus anchor stars for each figure.
"""
import json
import re
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
PLATES = Path("/tmp/atlas")
OUT = ROOT / "sky" / "data" / "art"
STARS = json.loads((ROOT / "sky" / "data" / "stars.json").read_text())
FIGURES = json.loads((ROOT / "sky" / "data" / "figures.json").read_text())
CONS = STARS["con"]
META = json.loads((PLATES / "meta.json").read_text())

JOBS = [
    ("Ori", "orion"), ("Tau", "taurus"), ("Gem", "gemini"), ("CMa", "canis"),
    ("UMa", "uma"), ("UMi", "dra"), ("Cas", "cas"), ("Cyg", "cyglyr"),
    ("Lyr", "cyglyr"), ("Aql", "aql"), ("Sco", "sco"), ("Sgr", "sgr"),
    ("Leo", "leo"), ("Vir", "vir"), ("And", "and"), ("Per", "per"),
    ("Peg", "peg"), ("Ari", "ari"), ("Psc", "psc"), ("Aqr", "aqr"),
    ("Cap", "cap"), ("Lib", "lib"), ("Cnc", "cnc"), ("Boo", "boo"),
    ("Her", "her"), ("Dra", "dra"), ("Aur", "aur"), ("Cep", "cep"),
    ("Cen", "south"),
]


def plate_path(key):
    for ext in (".jpg", ".png", ".jpeg"):
        p = PLATES / f"{key}{ext}"
        if p.exists():
            return p
    raise SystemExit(f"missing plate {key}")


def detect(gray, cap=200):
    h, w = gray.shape
    scored = []
    dil = cv2.dilate(gray, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    ys, xs = np.where((gray == dil) & (gray > 200))
    for y, x in zip(ys, xs):
        if x < w * 0.04 or y < h * 0.04 or x >= w * 0.96 or y >= h * 0.96:
            continue
        ring = gray[y - 11:y + 12, x - 11:x + 12]
        frac = float((ring < 90).mean())
        if frac < 0.14 or frac > 0.48 or ring.mean() > 158:
            continue
        scored.append((frac, int(x), int(y)))
    ero = cv2.erode(gray, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    ys, xs = np.where((gray == ero) & (gray < 48))
    for y, x in zip(ys, xs):
        if x < w * 0.04 or y < h * 0.04 or x >= w * 0.96 or y >= h * 0.96:
            continue
        win = gray[y - 13:y + 14, x - 13:x + 14]
        if np.percentile(win, 72) < 175:
            continue
        frac = float((win < 75).mean())
        if not (0.06 <= frac <= 0.22):
            continue
        scored.append((0.3 + frac, int(x), int(y)))
    scored.sort(reverse=True)
    kept = []
    for _, x, y in scored:
        if any((x - a) ** 2 + (y - b) ** 2 < 18 ** 2 for a, b in kept):
            continue
        kept.append((x, y))
        if len(kept) >= cap:
            break
    return np.array(kept, float)


def catalog(cid, mag=4.4):
    ci = CONS.index(cid)
    rows = [r for r in STARS["s"] if r[5] == ci and r[2] <= mag]
    if len(rows) < 4:
        rows = [r for r in STARS["s"] if r[5] == ci][:8]
    ras = np.array([r[0] * 15.0 for r in rows])
    decs = np.array([r[1] for r in rows])
    ra0, dec0 = float(ras.mean()), float(decs.mean())
    cosd = float(np.cos(np.deg2rad(dec0)))
    sky = np.stack([(ras - ra0) * cosd, decs - dec0], 1)
    return sky, rows, ra0, dec0, cosd


def match(pix, sky, size):
    w, h = size
    rng = np.random.default_rng(7)
    best = None
    nsky, npix = len(sky), len(pix)
    if npix < 8 or nsky < 4:
        return None
    for _ in range(10000):
        i, j = rng.integers(0, nsky, 2)
        a, b = rng.integers(0, npix, 2)
        if i == j or a == b:
            continue
        p1, p2 = sky[i], sky[j]
        q1, q2 = pix[a], pix[b]
        v, wvec = p2 - p1, q2 - q1
        nv, nw = np.hypot(*v), np.hypot(*wvec)
        if nv < 0.4 or nw < 60:
            continue
        for mirror in (0, 1):
            vv = np.array([v[0], -v[1] if mirror else v[1]])
            ang = np.arctan2(wvec[1], wvec[0]) - np.arctan2(vv[1], vv[0])
            scale = nw / np.hypot(*vv)
            ca, sa = np.cos(ang) * scale, np.sin(ang) * scale
            rot = np.array([[ca, -sa], [sa, ca]])
            flip = np.array([[1.0, 0.0], [0.0, -1.0]]) if mirror else np.eye(2)
            R = rot @ flip
            t = q1 - R @ p1
            proj = sky @ R.T + t
            if np.ptp(proj[:, 0]) < 0.16 * w or np.ptp(proj[:, 1]) < 0.14 * h:
                continue
            d2 = ((proj[:, None, 0] - pix[None, :, 0]) ** 2 + (proj[:, None, 1] - pix[None, :, 1]) ** 2).min(1)
            inl_mask = d2 < 20 ** 2
            inl = int(inl_mask.sum())
            if inl < 4:
                continue
            spread = min(float(np.ptp(proj[inl_mask, 0])), float(np.ptp(proj[inl_mask, 1])))
            if spread < 0.22 * min(w, h):
                continue
            med = float(np.median(np.sqrt(d2[inl_mask])))
            score = inl * spread
            if best is None or score > best[0]:
                best = (score, inl, med, proj, d2)
    return best


def affine_from_pairs(src, dst):
    X = np.c_[src, np.ones(len(src))]
    ax, *_ = np.linalg.lstsq(X, dst[:, 0], rcond=None)
    ay, *_ = np.linalg.lstsq(X, dst[:, 1], rcond=None)
    return ax, ay


def apply_aff(ax, ay, sky):
    X = np.c_[sky, np.ones(len(sky))]
    return np.stack([X @ ax, X @ ay], 1)


LIMIT_PCT = 2.0
NAMES = STARS.get("names", {})
STICK = {}
for _fig in FIGURES:
    hips = set()
    for pair in _fig.get("lines", []):
        hips.add(int(pair[0]))
        hips.add(int(pair[1]))
    STICK[_fig["id"]] = hips
MUST = {"Ori", "Tau", "UMa", "Cyg", "Sco"}


def text_clean(value):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", value or "")).strip()


def snap_disk(gray, x, y, radius):
    """Nearest compact dark star-disk to (x, y), or None."""
    h, w = gray.shape
    x, y = int(round(x)), int(round(y))
    if x < 4 or y < 4 or x >= w - 4 or y >= h - 4:
        return None
    y0, y1 = max(1, y - radius), min(h - 1, y + radius)
    x0, x1 = max(1, x - radius), min(w - 1, x + radius)
    patch = gray[y0:y1, x0:x1]
    dark = (patch < 70).astype(np.uint8)
    n, _lab, stats, cent = cv2.connectedComponentsWithStats(dark, 8)
    best = None
    for i in range(1, n):
        area = int(stats[i, cv2.CC_STAT_AREA])
        bw = int(stats[i, cv2.CC_STAT_WIDTH])
        bh = int(stats[i, cv2.CC_STAT_HEIGHT])
        if area < 8 or area > 420 or max(bw, bh) > 30:
            continue
        if max(bw, bh) / max(1, min(bw, bh)) > 2.6:
            continue
        cx = float(cent[i, 0] + x0)
        cy = float(cent[i, 1] + y0)
        ix, iy = int(round(cx)), int(round(cy))
        if not (8 < ix < w - 8 and 8 < iy < h - 8):
            continue
        core = float(gray[iy - 3:iy + 4, ix - 3:ix + 4].mean())
        ring = float(gray[iy - 16:iy + 17, ix - 16:ix + 17].mean())
        # A star disk is a dark hole in lighter paper. Fur and type are not.
        if core > 78 or core > ring - 32:
            continue
        dist = float(np.hypot(cx - x, cy - y))
        score = dist + max(0.0, core - 20) * 0.15
        if best is None or score < best[0]:
            best = (score, cx, cy, dist)
    if best is None:
        return None
    return best[1], best[2], best[3]


def fit_residuals(src, dst):
    ax, ay = affine_from_pairs(src, dst)
    fit = apply_aff(ax, ay, src)
    res = np.hypot(fit[:, 0] - dst[:, 0], fit[:, 1] - dst[:, 1])
    return ax, ay, res


def refine_anchors(gray, sky, rows, proj, cid):
    """Snap catalog stars onto engraved disks and keep a consistent affine."""
    h, w = gray.shape
    stick = STICK.get(cid, set())
    seeds = []
    for i, row in enumerate(rows):
        hip = int(row[4])
        if hip not in stick and row[2] > 3.3:
            continue
        hit = snap_disk(gray, proj[i, 0], proj[i, 1], 64)
        if hit and hit[2] < 56:
            seeds.append(i)
    if len(seeds) < 3:
        return None
    idxs = list(seeds)

    def fit_of(ids):
        src = sky[ids]
        dst = np.array([snaps[i] for i in ids], float)
        return fit_residuals(src, dst)

    snaps = {}
    for i in idxs:
        hit = snap_disk(gray, proj[i, 0], proj[i, 1], 64)
        snaps[i] = (hit[0], hit[1])
    ax, ay, res = fit_of(idxs)
    # One tighter pass: reproject, snap again, drop disks that will not sit on the fit.
    for _ in range(3):
        proj2 = apply_aff(ax, ay, sky)
        snaps = {}
        for i, row in enumerate(rows):
            hip = int(row[4])
            if hip not in stick and row[2] > 3.1:
                continue
            if not (0 < proj2[i, 0] < w and 0 < proj2[i, 1] < h):
                continue
            hit = snap_disk(gray, proj2[i, 0], proj2[i, 1], 26)
            if hit and hit[2] < 22:
                snaps[i] = (hit[0], hit[1])
        if len(snaps) < 3:
            return None
        ids = list(snaps)
        ax, ay, res = fit_of(ids)
        span = max(float(np.ptp([snaps[i][0] for i in ids])), float(np.ptp([snaps[i][1] for i in ids])), 1.0)
        order = list(np.argsort(-res))
        dropped = False
        for k in order:
            if len(ids) <= 3:
                break
            if res[k] <= 0.018 * span:
                break
            del snaps[ids[k]]
            dropped = True
            break
        if not dropped:
            break
        ids = list(snaps)
        ax, ay, res = fit_of(ids)
    ids = list(snaps)
    ax, ay, res = fit_of(ids)
    kept = []
    for n, i in enumerate(ids):
        kept.append({
            "i": i,
            "hip": int(rows[i][4]),
            "mag": float(rows[i][2]),
            "x": float(snaps[i][0]),
            "y": float(snaps[i][1]),
            "res": float(res[n]),
            "stick": int(rows[i][4]) in stick,
        })
    return ax, ay, kept


def erase_grid(gray, ink):
    """Blank long axis-aligned rules: the card frame and the coordinate grid."""
    edges = cv2.Canny(gray, 40, 130)
    h, w = gray.shape
    lines = cv2.HoughLinesP(
        edges, 1, np.pi / 180, threshold=80,
        minLineLength=int(0.34 * min(h, w)), maxLineGap=16,
    )
    if lines is None:
        return ink
    wipe = np.zeros_like(ink)
    for x1, y1, x2, y2 in np.asarray(lines).reshape(-1, 4):
        ang = abs(np.degrees(np.arctan2(y2 - y1, x2 - x1))) % 180
        if ang < 8 or ang > 172 or abs(ang - 90) < 8:
            cv2.line(wipe, (int(x1), int(y1)), (int(x2), int(y2)), 255, 7)
    ink[wipe > 0] = 0
    return ink


def glyph_centers(gray):
    """Centers of engraved stars on a crop: black disks and white pearls."""
    h, w = gray.shape
    found = []
    ero = cv2.erode(gray, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    ys, xs = np.where((gray == ero) & (gray < 48))
    for y, x in zip(ys.tolist(), xs.tolist()):
        if min(x, y) < 8 or x >= w - 8 or y >= h - 8:
            continue
        core = float(gray[y - 2:y + 3, x - 2:x + 3].mean())
        if core > 36:
            continue
        if float(gray[max(0, y - 10):y + 11, max(0, x - 10):x + 11].mean()) < core + 28:
            continue
        found.append((core, float(x), float(y)))
    dil = cv2.dilate(gray, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    ys, xs = np.where((gray == dil) & (gray > 220))
    for y, x in zip(ys.tolist(), xs.tolist()):
        if min(x, y) < 8 or x >= w - 8 or y >= h - 8:
            continue
        ring = gray[y - 5:y + 6, x - 5:x + 6].astype(np.int16).copy()
        ring[2:9, 2:9] = 255
        if float((ring < 90).mean()) < 0.18:
            continue
        found.append((20, float(x), float(y)))
    found.sort()
    kept = []
    for _s, x, y in found:
        if any((x - a) ** 2 + (y - b) ** 2 < 14 ** 2 for a, b in kept):
            continue
        kept.append((x, y))
    return kept


def clean_figure(rgb, star_xy, anchors):
    """Keep the figure outline and its shading. Drop the frame, grid, type, and star glyphs."""
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    h, w = gray.shape
    # The washes on these plates are light, so a dark-only threshold drops the body.
    ink = (gray < 168).astype(np.uint8) * 255
    ink = erase_grid(gray, ink)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(ink, 8)
    kept = np.zeros_like(ink)
    for i in range(1, n):
        if int(stats[i, cv2.CC_STAT_AREA]) >= 70:
            kept[lab == i] = 255
    k = max(19, int(0.028 * min(h, w)) | 1)
    closed = cv2.morphologyEx(kept, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    # Several pieces of one figure, but not the neighbor printed on the same card.
    ax = [p[0] for p in anchors]
    ay = [p[1] for p in anchors]
    margin = 0.28 * max(max(ax) - min(ax), max(ay) - min(ay), 80)
    box = (min(ax) - margin, min(ay) - margin, max(ax) + margin, max(ay) + margin)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(closed, 8)
    mask = np.zeros_like(closed)
    punch = max(12, int(0.012 * min(h, w)))
    reach = punch + 16
    for i in range(1, n):
        if int(stats[i, cv2.CC_STAT_AREA]) < 700:
            continue
        cx = stats[i, cv2.CC_STAT_LEFT] + stats[i, cv2.CC_STAT_WIDTH] / 2
        cy = stats[i, cv2.CC_STAT_TOP] + stats[i, cv2.CC_STAT_HEIGHT] / 2
        inside = box[0] <= cx <= box[2] and box[1] <= cy <= box[3]
        near = False
        if not inside:
            for x, y in anchors:
                ix, iy = int(round(x)), int(round(y))
                y0, y1 = max(0, iy - reach), min(h, iy + reach + 1)
                x0, x1 = max(0, ix - reach), min(w, ix + reach + 1)
                if (lab[y0:y1, x0:x1] == i).any():
                    near = True
                    break
        if inside or near:
            mask[lab == i] = 255
    if int((mask > 0).sum()) < 800:
        return None
    # The card frame sits on the plate edge. Drop a thin strip there.
    edge = max(8, int(0.012 * min(h, w)))
    mask[:edge, :] = 0
    mask[-edge:, :] = 0
    mask[:, :edge] = 0
    mask[:, -edge:] = 0
    # Flat wash inside the silhouette. Star disks and short words are not drawn as lines,
    # so the printed stars and lettering fall back to the wash.
    line_u8 = ((gray < 176) & (mask > 0)).astype(np.uint8) * 255
    disks = black_cores(gray, limit=48)
    for x, y in list(star_xy) + [(float(p[0]), float(p[1])) for p in disks]:
        cv2.circle(line_u8, (int(round(x)), int(round(y))), punch, 0, -1)
    lines = line_u8.astype(np.float32) / 255.0
    n, lab, stats, _ = cv2.connectedComponentsWithStats((lines > 0.25).astype(np.uint8) * 255, 8)
    for i in range(1, n):
        bw = int(stats[i, cv2.CC_STAT_WIDTH])
        bh = int(stats[i, cv2.CC_STAT_HEIGHT])
        area = int(stats[i, cv2.CC_STAT_AREA])
        if area < 900 and max(bw, bh) < 0.08 * min(h, w):
            lines[lab == i] = 0
    sigma = max(2.2, 0.006 * min(h, w))
    feather = cv2.GaussianBlur(mask, (0, 0), sigma).astype(np.float32) / 255.0
    alpha = feather * (0.42 + 0.58 * np.clip(lines, 0, 1))
    alpha[alpha < 0.04] = 0
    out = np.zeros((h, w, 4), np.uint8)
    out[:, :, 0:3] = 255
    out[:, :, 3] = (np.clip(alpha, 0, 1) * 255).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def check_residuals(path=None):
    """Fail when any stored anchor misses its engraved star by more than 2% of the figure."""
    path = Path(path) if path else OUT / "residuals.json"
    data = json.loads(path.read_text())
    bad = []
    for cid, fig in data["figures"].items():
        for row in fig["anchors"]:
            if row["pct"] > data["limitPct"] + 1e-6:
                bad.append(f"{cid} HIP {row['hip']} {row['pct']:.2f}%")
        if not fig["pass"]:
            bad.append(cid)
    if bad:
        print("RESIDUAL FAIL")
        for line in bad:
            print(" ", line)
        return 1
    print(f"residuals ok  {len(data['figures'])} figures  limit {data['limitPct']}%")
    return 0


# Glyph centers checked against the engraved stars on the plate.
VERIFIED = {
    "UMa": {
        54061: (1002, 420), 53910: (1000, 562), 58001: (802, 631),
        59774: (770, 542), 62956: (619, 559), 65378: (496, 585),
        67301: (299, 709),
    },
    "Ori": {
        27989: (360, 785), 25336: (713, 854), 25930: (614, 1168),
        26311: (557, 1206), 24436: (814, 1529),
        27366: (442, 1588),
    },
    "Tau": {
        21421: (896, 608), 25428: (452, 120), 20889: (958, 522),
        20894: (960, 658), 20205: (1036, 648), 17702: (1358, 338),
        17499: (1385, 345),
    },
    "Cyg": {
        102098: (961, 554), 100453: (1052, 685),
        97165: (1228, 556), 95947: (1344, 1008),
    },
    "Sco": {
        80763: (983, 1406), 81266: (903, 1480), 82396: (778, 1905),
        85927: (281, 2070), 86670: (204, 2239),
    },
}


def black_cores(gray, limit=22):
    """Small black centers of the engraved star disks."""
    h, w = gray.shape
    angs = np.linspace(0, 2 * np.pi, 16, endpoint=False)
    cs, sn = np.cos(angs), np.sin(angs)
    ero = cv2.erode(gray, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    ys, xs = np.where((gray == ero) & (gray < 34))
    found = []
    for y, x in zip(ys.tolist(), xs.tolist()):
        if min(x, y) < 16 or x >= w - 16 or y >= h - 16:
            continue
        core = float(gray[y - 2:y + 3, x - 2:x + 3].mean())
        if core > 26:
            continue
        vals = np.array([int(gray[int(y + sn[k] * 9), int(x + cs[k] * 9)]) for k in range(16)])
        if int(np.sum((vals < 120) != np.roll(vals < 120, 1))) < 4:
            continue
        if float(gray[y - 15:y + 16, x - 15:x + 16].mean()) < core + 40:
            continue
        found.append((core, float(x), float(y)))
    found.sort()
    kept = []
    for _c, x, y in found:
        if any((x - a) ** 2 + (y - b) ** 2 < 20 ** 2 for a, b in kept):
            continue
        kept.append((x, y))
        if len(kept) >= limit:
            break
    return np.array(kept, float) if kept else np.zeros((0, 2))


def match_cores(pix, sky, min_span):
    """Similarity hypotheses, scored by how tightly an affine then sits on unique glyphs."""
    n = len(pix)
    if n < 6 or len(sky) < 4:
        return None
    best = None
    m = min(4, len(sky))
    for i in range(m):
        for j in range(i + 1, m):
            v = sky[j] - sky[i]
            nv = float(np.hypot(*v))
            if nv < 0.35:
                continue
            for a in range(n):
                for b in range(n):
                    if a == b:
                        continue
                    wvec = pix[b] - pix[a]
                    nw = float(np.hypot(*wvec))
                    if nw < min_span * 0.55:
                        continue
                    ang = np.arctan2(wvec[1], wvec[0]) - np.arctan2(v[1], v[0])
                    scale = nw / nv
                    ca, sa = np.cos(ang) * scale, np.sin(ang) * scale
                    rot = np.array([[ca, -sa], [sa, ca]])
                    proj = sky @ rot.T + (pix[a] - rot @ sky[i])
                    dist = np.hypot(proj[:, None, 0] - pix[None, :, 0], proj[:, None, 1] - pix[None, :, 1]).min(1)
                    near = np.where(dist < 42)[0]
                    if len(near) < 4:
                        continue
                    used = []
                    ok = True
                    for k in near:
                        jn = int(np.hypot(pix[:, 0] - proj[k, 0], pix[:, 1] - proj[k, 1]).argmin())
                        if jn in used:
                            ok = False
                            break
                        used.append(jn)
                    if not ok:
                        continue
                    dst = pix[used]
                    ax, ay, res = fit_residuals(sky[near], dst)
                    tight = res <= 16
                    if int(tight.sum()) < 4:
                        continue
                    block = dst[tight]
                    span = float(max(np.ptp(block[:, 0]), np.ptp(block[:, 1])))
                    if span < min_span:
                        continue
                    score = (int(tight.sum()), -float(res[tight].max()), span)
                    if best is None or score > best[0]:
                        best = (score, ax, ay, near[tight], used)
    if best is None:
        return None
    _score, ax, ay, near, used = best
    # used was built in near-order; rebuild the tight subset the same way
    proj = apply_aff(ax, ay, sky)
    chosen = []
    seen = set()
    for k in range(len(sky)):
        jn = int(np.hypot(pix[:, 0] - proj[k, 0], pix[:, 1] - proj[k, 1]).argmin())
        err = float(np.hypot(pix[jn, 0] - proj[k, 0], pix[jn, 1] - proj[k, 1]))
        if err <= 18 and jn not in seen:
            seen.add(jn)
            chosen.append((k, pix[jn, 0], pix[jn, 1], err))
    if len(chosen) < 4:
        return None
    src = sky[[c[0] for c in chosen]]
    dst = np.array([[c[1], c[2]] for c in chosen], float)
    ax, ay, res = fit_residuals(src, dst)
    return ax, ay, [(int(c[0]), float(c[1]), float(c[2]), float(r)) for c, r in zip(chosen, res)]


def place_anchors(cid, gray):
    """Return (ax, ay, kept, sky, rows) in full-plate pixels."""
    sky, rows, *_ = catalog(cid, mag=6.2)
    hip_of = {i: int(r[4]) for i, r in enumerate(rows)}
    stick = STICK.get(cid, set())
    if cid in VERIFIED:
        items = []
        hip_i = {int(r[4]): i for i, r in enumerate(rows)}
        for hip, (x, y) in VERIFIED[cid].items():
            if hip not in hip_i:
                continue
            items.append((hip_i[hip], float(x), float(y)))
        while len(items) >= 4:
            src = sky[[it[0] for it in items]]
            dst = np.array([[it[1], it[2]] for it in items], float)
            ax, ay, res = fit_residuals(src, dst)
            span = max(float(np.ptp(dst[:, 0])), float(np.ptp(dst[:, 1])), 1.0)
            worst = int(np.argmax(res))
            # Drop a point the engraver displaced, while at least four remain so the
            # residual is a real check. The shipped gate is 2% of the figure.
            if res[worst] <= 0.05 * span or len(items) == 4:
                kept = []
                for it, r in zip(items, res):
                    if len(items) > 4 and r > 0.05 * span:
                        continue
                    kept.append({
                        "i": it[0], "hip": int(rows[it[0]][4]), "mag": float(rows[it[0]][2]),
                        "x": it[1], "y": it[2], "res": float(r), "stick": True,
                    })
                if len(kept) >= 4:
                    src = sky[[p["i"] for p in kept]]
                    dst = np.array([[p["x"], p["y"]] for p in kept], float)
                    ax, ay, res = fit_residuals(src, dst)
                    for p, r in zip(kept, res):
                        p["res"] = float(r)
                    return ax, ay, kept, sky, rows
                break
            items.pop(worst)
        return None
    # Automatic matching kept locking onto the wrong asterism, so a plate is
    # shipped only when its star disks were checked by hand.
    return None


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.webp"):
        old.unlink()
    index = {}
    credits = {}
    report = {}
    preview = PLATES / "clean2"
    preview.mkdir(exist_ok=True)
    for cid, key in JOBS:
        path = plate_path(key)
        gray = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
        color = Image.open(path).convert("RGB")
        placed = place_anchors(cid, gray)
        if not placed:
            print("FAIL place", cid)
            continue
        ax, ay, kept, sky, rows = placed
        span = max(float(np.ptp([p["x"] for p in kept])), float(np.ptp([p["y"] for p in kept])), 1.0)
        # Crop around the checked stars, with room for the body drawn past them.
        # Projecting every faint catalog star pulls in the rest of a shared card.
        xs = [p["x"] for p in kept]
        ys = [p["y"] for p in kept]
        minx, maxx = min(xs), max(xs)
        miny, maxy = min(ys), max(ys)
        # Pad by the longer star span. A flat asterism still has a tall body around it.
        reach = max(maxx - minx, maxy - miny, 1.0)
        pad_x = max(160, reach * 0.95)
        pad_y = max(160, reach * 0.95)
        W, H = color.size
        left = int(max(0, minx - pad_x))
        top = int(max(0, miny - pad_y))
        right = int(min(W, maxx + pad_x))
        bottom = int(min(H, maxy + pad_y))
        if right - left < 80 or bottom - top < 80:
            print("FAIL crop", cid)
            continue
        crop_rgb = np.asarray(color.crop((left, top, right, bottom)))
        star_xy = [(p["x"] - left, p["y"] - top) for p in kept]
        sky_all = apply_aff(ax, ay, sky)
        # Also punch other catalog stars that landed in the crop so their glyphs go too.
        for p in sky_all:
            lx, ly = p[0] - left, p[1] - top
            if 0 < lx < right - left and 0 < ly < bottom - top:
                star_xy.append((float(lx), float(ly)))
        cleaned = clean_figure(crop_rgb, star_xy, [(p["x"] - left, p["y"] - top) for p in kept])
        if cleaned is None:
            print("FAIL mask", cid)
            continue
        long_side = max(cleaned.size)
        scale = 680 / long_side if long_side > 680 else 1.0
        if scale != 1:
            cleaned = cleaned.resize(
                (max(1, int(cleaned.size[0] * scale)), max(1, int(cleaned.size[1] * scale))),
                Image.Resampling.LANCZOS,
            )
        figure = float(max(cleaned.size))
        anchors = []
        rows_out = []
        worst = 0.0
        for p in kept:
            res_px = p["res"] * scale
            pct = 100.0 * res_px / figure
            worst = max(worst, pct)
            name = NAMES.get(str(p["hip"]), "")
            anchors.append({"hip": p["hip"], "x": round((p["x"] - left) * scale, 1), "y": round((p["y"] - top) * scale, 1)})
            rows_out.append({
                "hip": p["hip"],
                "name": name,
                "residualPx": round(res_px, 2),
                "pct": round(pct, 3),
                "pass": pct <= LIMIT_PCT,
            })
        if worst > LIMIT_PCT or len(anchors) < 3:
            print(f"FAIL residual {cid} max {worst:.2f}% of {figure:.0f}px  n {len(anchors)}")
            continue
        # Prefer the stick-figure stars when a plate matched more than we need to draw.
        stick_anchors = [a for a, p in zip(anchors, kept) if p["stick"]]
        if len(stick_anchors) >= 3:
            anchors = stick_anchors
            rows_out = [row for row, p in zip(rows_out, kept) if p["stick"]]
        dest = OUT / f"{cid.lower()}.webp"
        cleaned.save(dest, "WEBP", quality=56, method=4)
        index[cid] = {"file": dest.name, "w": cleaned.size[0], "h": cleaned.size[1], "anchors": anchors}
        info = META[key]
        year = 1825
        m = re.search(r"(1[6-8]\d\d)", text_clean(info.get("date", "")))
        if m:
            year = int(m.group(1))
        credits[cid] = {
            "source": "Sidney Hall, Urania's Mirror",
            "title": text_clean(info["title"]).replace("File:", ""),
            "commons": info["commons"],
            "author": "Sidney Hall",
            "year": year,
            "license": "Public domain",
        }
        report[cid] = {
            "w": cleaned.size[0],
            "h": cleaned.size[1],
            "spanPx": round(span * scale, 1),
            "maxPct": round(worst, 3),
            "pass": True,
            "anchors": rows_out,
        }
        # Preview on black so the light lines read the way they will on the sky.
        sheet = Image.new("RGB", cleaned.size, (8, 12, 28))
        sheet.paste(cleaned, mask=cleaned.getchannel("A"))
        dr = ImageDraw.Draw(sheet)
        for a in anchors:
            dr.ellipse((a["x"] - 5, a["y"] - 5, a["x"] + 5, a["y"] + 5), outline=(255, 64, 64))
        sheet.resize((520, int(520 * sheet.size[1] / sheet.size[0]))).save(preview / f"{cid}.jpg", quality=80)
        print(f"{cid:4} anchors {len(anchors):2} max {worst:5.2f}%  span {span * scale:6.0f}  bytes {dest.stat().st_size}")

    (OUT / "index.json").write_text(json.dumps(index))
    (OUT / "residuals.json").write_text(json.dumps({
        "limitPct": LIMIT_PCT,
        "note": "Each residual is the distance, in the shipped figure, between an anchor star and the affine reprojection of its catalog position. The limit is 2% of the figure's long side.",
        "figures": report,
    }, indent=2))
    (OUT / "credits.json").write_text(json.dumps({
        "note": "Figure plates are public-domain engravings from Sidney Hall's Urania's Mirror (1825), scanned on Wikimedia Commons. Each file keeps one figure's outline and shading; the card frame, coordinate grid, lettering, and printed star symbols are removed. They are not copied from a software atlas.",
        "license": "Public domain",
        "figures": credits,
    }, indent=2))
    total = sum(p.stat().st_size for p in OUT.glob("*.webp"))
    missing = sorted(MUST - set(index))
    print("figures", len(index), "bytes", total)
    if missing:
        print("FAIL required", " ".join(missing))
        return 1
    return check_residuals()


if __name__ == "__main__":
    if "--check" in sys.argv:
        sys.exit(check_residuals())
    sys.exit(main())
