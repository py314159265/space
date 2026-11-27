#!/usr/bin/env python3
"""Build faint constellation figures from Sidney Hall's Urania's Mirror.

The plates are public-domain scans. This script finds the engraved stars,
fits them to catalog positions, and writes a light-on-transparent WebP
plus anchor stars for each figure.
"""
import json
import re
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

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


def ink(image):
    arr = np.asarray(image.convert("RGB"), np.float32)
    lum = 0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]
    paper = 112
    dark = np.clip((paper - lum) / (paper - 18), 0, 1)
    dark[lum > paper] = 0
    alpha = (np.clip(dark, 0, 1) ** 0.85 * 255).astype(np.uint8)
    alpha[alpha < 22] = 0
    mask = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(0.45))
    q = (np.asarray(mask).astype(np.int16) // 18) * 18
    mask = Image.fromarray(q.astype(np.uint8), "L")
    white = Image.new("L", mask.size, 255)
    return Image.merge("RGBA", (white, white, white, mask))


def text_clean(value):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", value or "")).strip()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    index = {}
    credits = {}
    qa = PLATES / "qa"
    qa.mkdir(exist_ok=True)
    for cid, key in JOBS:
        path = plate_path(key)
        gray = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
        color = Image.open(path).convert("RGB")
        pix = detect(gray)
        sky, rows, *_ = catalog(cid)
        found = match(pix, sky, gray.shape[::-1])
        if not found or found[1] < max(4, int(0.28 * len(sky))):
            print(f"FAIL {cid} det {len(pix)} cat {len(sky)} found {None if not found else found[1]}")
            continue
        _, inl, med, proj, d2 = found
        near = d2 < 20 ** 2
        spread = min(float(np.ptp(proj[near, 0])), float(np.ptp(proj[near, 1])))
        if spread < 0.22 * min(gray.shape):
            print(f"FAIL span {cid} inliers {int(near.sum())} box {np.ptp(proj[near,0]):.0f}x{np.ptp(proj[near,1]):.0f}")
            continue
        nn = ((proj[:, None, 0] - pix[None, :, 0]) ** 2 + (proj[:, None, 1] - pix[None, :, 1]) ** 2).argmin(1)
        snapped = pix[nn]
        # Spread the anchors across the inlier box instead of clustering on the brightest.
        idxs = np.where(near)[0]
        chosen_i = []
        box_x0, box_x1 = proj[near, 0].min(), proj[near, 0].max()
        box_y0, box_y1 = proj[near, 1].min(), proj[near, 1].max()
        corners = [(box_x0, box_y0), (box_x1, box_y0), (box_x0, box_y1), (box_x1, box_y1),
                   ((box_x0 + box_x1) / 2, (box_y0 + box_y1) / 2)]
        for cx, cy in corners:
            left = [i for i in idxs if i not in chosen_i]
            if not left:
                break
            best_i = min(left, key=lambda i: (proj[i, 0] - cx) ** 2 + (proj[i, 1] - cy) ** 2)
            chosen_i.append(int(best_i))
        chosen = []
        for i in chosen_i:
            x, y = snapped[i]
            hip = rows[i][4]
            if any(abs(x - a[0]) < 24 and abs(y - a[1]) < 24 for a in chosen):
                continue
            chosen.append((float(x), float(y), int(hip)))
        if len(chosen) < 3:
            print("FAIL anchors", cid, "inliers", int(near.sum()))
            continue
        vis = proj[near]
        minx, maxx = float(vis[:, 0].min()), float(vis[:, 0].max())
        miny, maxy = float(vis[:, 1].min()), float(vis[:, 1].max())
        pad_x = max(48, (maxx - minx) * 0.42)
        pad_y = max(48, (maxy - miny) * 0.42)
        W, H = color.size
        l = int(max(0, minx - pad_x))
        t = int(max(0, miny - pad_y))
        r = int(min(W, maxx + pad_x))
        b = int(min(H, maxy + pad_y))
        if r - l < 80 or b - t < 80:
            print("FAIL crop", cid)
            continue
        crop = ink(color.crop((l, t, r, b)))
        long_side = max(crop.size)
        scale = 680 / long_side if long_side > 680 else 1
        if scale != 1:
            crop = crop.resize((int(crop.size[0] * scale), int(crop.size[1] * scale)), Image.Resampling.LANCZOS)
        anchors = []
        for x, y, hip in chosen:
            anchors.append({
                "hip": int(hip),
                "x": round((x - l) * scale, 1),
                "y": round((y - t) * scale, 1),
            })
        dest = OUT / f"{cid.lower()}.webp"
        crop.save(dest, "WEBP", quality=54, method=4)
        index[cid] = {"file": dest.name, "w": crop.size[0], "h": crop.size[1], "anchors": anchors}
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
        qa_im = color.copy()
        dr = ImageDraw.Draw(qa_im)
        for i, p in enumerate(proj):
            col = (220, 0, 0) if near[i] else (0, 90, 220)
            dr.ellipse((p[0] - 7, p[1] - 7, p[0] + 7, p[1] + 7), outline=col, width=2)
        qa_im.resize((760, int(760 * qa_im.size[1] / qa_im.size[0]))).save(qa / f"{cid}.jpg", quality=72)
        print(f"{cid:4} inliers {int(near.sum()):2}/{len(rows):2} med {med:4.1f} anchors {len(anchors)} bytes {dest.stat().st_size}")

    (OUT / "index.json").write_text(json.dumps(index))
    (OUT / "credits.json").write_text(json.dumps({
        "note": "Figure plates are public-domain engravings from Sidney Hall's Urania's Mirror (1825), scanned on Wikimedia Commons. Each file is cropped to one figure and turned into light lines on a clear ground. They are not copied from a software atlas.",
        "license": "Public domain",
        "figures": credits,
    }, indent=2))
    total = sum(p.stat().st_size for p in OUT.glob("*.webp"))
    print("figures", len(index), "bytes", total)


if __name__ == "__main__":
    main()
