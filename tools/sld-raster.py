"""The raster half of the SLD reader (Phase 12.3): one page of a PDF, or a PNG / JPEG, as OCR words + shape primitives.

    python3 -I tools/sld-raster.py <file> [--page N] [--dpi 200] [--kind pdf|png|jpeg] [--lang eng] [--max-pixels N]

Prints one JSON object { width, height, dpi, words: [{ t, c, b }], primitives: [...] } in the page's DISPLAY frame (points, origin top-left, y down,
page rotation already applied by the renderer). Nothing is interpreted: words are what tesseract read (confidence 0..1), primitives are what OpenCV
found — straight segments (with stroke width), circles, filled dots. lib/sld/extract/classify.mjs reads them; a symbol is never named here.
"""
import sys, json, subprocess, tempfile, os, argparse, math
import cv2, numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("file"); ap.add_argument("--page", type=int, default=1); ap.add_argument("--dpi", type=int, default=200)
ap.add_argument("--kind", default="pdf"); ap.add_argument("--lang", default="eng"); ap.add_argument("--max-pixels", type=int, default=80_000_000)
a = ap.parse_args()

with tempfile.TemporaryDirectory() as d:
    if a.kind == "pdf":
        subprocess.run(["pdftoppm", "-gray", "-r", str(a.dpi), "-f", str(a.page), "-l", str(a.page), "-png", a.file, f"{d}/r"], check=True, capture_output=True)
        png = [f for f in os.listdir(d) if f.startswith("r") and f.endswith(".png")][0]
        path = f"{d}/{png}"
    else:
        path = a.file
    img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        print(json.dumps({"error": "unreadable image"})); sys.exit(2)
    H, W = img.shape
    if H * W > a.max_pixels:
        print(json.dumps({"error": "image too large", "pixels": H * W})); sys.exit(3)
    k = 72.0 / a.dpi
    # ── words (tesseract TSV) ──
    words = []
    try:
        out = subprocess.run(["tesseract", path, "-", "-l", a.lang, "--psm", "11", "tsv"], capture_output=True, text=True, timeout=120).stdout
        for ln in out.splitlines()[1:]:
            c = ln.split("\t")
            if len(c) >= 12 and c[0] == "5" and c[11].strip() and float(c[10]) >= 0:
                x, y, w, h = map(int, c[6:10])
                words.append({"t": c[11].strip(), "c": round(float(c[10]) / 100, 3), "b": [round(x * k, 2), round(y * k, 2), round((x + w) * k, 2), round((y + h) * k, 2)]})
    except Exception:
        pass
    # ── shapes ──
    bw = cv2.threshold(img, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    # text is not geometry: blank out the words (a letter inside a circle must not be read as a stroke)
    mask = bw.copy()
    clean = img.copy()
    for w_ in words:
        if w_["c"] < 0.6 or len(w_["t"]) < 2:        # a doubtful or one-letter reading may be a symbol: keep its ink
            continue
        x0, y0, x1, y1 = [int(v / k) for v in w_["b"]]
        cv2.rectangle(mask, (max(0, x0 - 1), max(0, y0 - 1)), (x1 + 1, y1 + 1), 0, -1)
        cv2.rectangle(clean, (max(0, x0 - 1), max(0, y0 - 1)), (x1 + 1, y1 + 1), 255, -1)
    prims = []
    # filled dots: small, compact, solid components
    n, lab, st, cen = cv2.connectedComponentsWithStats(mask, 8)
    dots = []
    for i in range(1, n):
        x, y, w, h, area = st[i]
        if 3 <= w <= 14 * a.dpi / 200 and 3 <= h <= 14 * a.dpi / 200 and abs(w - h) <= 2 and area >= 0.7 * w * h * math.pi / 4:
            dots.append((cen[i][0], cen[i][1], max(w, h) / 2))
            prims.append({"type": "dot", "cx": round(cen[i][0] * k, 2), "cy": round(cen[i][1] * k, 2), "r": round(max(w, h) / 2 * k, 2)})
    for (cx_, cy_, r_) in dots:
        cv2.circle(mask, (int(cx_), int(cy_)), int(r_) + 2, 0, -1)
    # circles
    blur = cv2.GaussianBlur(clean, (5, 5), 1.2)
    minr, maxr = int(3 * a.dpi / 72), int(60 * a.dpi / 72)
    cs = cv2.HoughCircles(blur, cv2.HOUGH_GRADIENT, dp=1, minDist=3, param1=120, param2=int(9 * a.dpi / 200) + 5, minRadius=minr, maxRadius=maxr)
    circles = []
    if cs is not None:
        ink = mask > 0
        th = np.linspace(0, 2 * np.pi, 96, endpoint=False)
        for cx_, cy_, r_ in cs[0]:
            # a Hough vote is not a drawn circle: keep it only when ink runs all the way round, at the best radius within +-3 px
            best = (0.0, float(r_))
            for rr in np.arange(r_ - 3, r_ + 3.1, 1.0):
                xs = (cx_ + rr * np.cos(th)).round().astype(int); ys = (cy_ + rr * np.sin(th)).round().astype(int)
                if xs.min() < 1 or ys.min() < 1 or xs.max() >= W - 1 or ys.max() >= H - 1: continue
                hit = np.zeros(len(th), bool)
                for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
                    hit |= ink[ys + dy, xs + dx]
                if hit.mean() > best[0]: best = (float(hit.mean()), float(rr))
            if best[0] >= 0.93:
                circles.append((float(cx_), float(cy_), best[1]))
    # merge duplicate circles (same centre, near radius)
    merged = []
    for c in sorted(circles, key=lambda c: -c[2]):
        if not any(math.hypot(c[0] - m[0], c[1] - m[1]) < 2.5 and abs(c[2] - m[2]) < 3 for m in merged):
            merged.append(c)
    for cx_, cy_, r_ in merged:
        r0 = int(r_ * 0.8)
        crop = clean[max(0, int(cy_) - r0):int(cy_) + r0 + 1, max(0, int(cx_) - r0):int(cx_) + r0 + 1]
        if crop.size and (crop < 128).sum() > 6 and a.kind == "pdf" or crop.size and (crop < 128).sum() > 6:
            big = cv2.copyMakeBorder(cv2.resize(crop, None, fx=4, fy=4, interpolation=cv2.INTER_CUBIC), 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=255)
            cv2.imwrite(f"{d}/inner.png", big)
            try:
                o = subprocess.run(["tesseract", f"{d}/inner.png", "-", "-l", a.lang, "--psm", "10", "-c", "tessedit_char_whitelist=MGAVWhk~", "tsv"], capture_output=True, text=True, timeout=30).stdout
                for ln in o.splitlines()[1:]:
                    c = ln.split("\t")
                    if len(c) >= 12 and c[0] == "5" and c[11].strip():
                        words.append({"t": c[11].strip(), "c": round(min(float(c[10]), 99) / 100, 3), "b": [round((cx_ - r_ * .5) * k, 2), round((cy_ - r_ * .5) * k, 2), round((cx_ + r_ * .5) * k, 2), round((cy_ + r_ * .5) * k, 2)], "inner": True})
            except Exception:
                pass
        prims.append({"type": "circle", "cx": round(cx_ * k, 2), "cy": round(cy_ * k, 2), "r": round(r_ * k, 2), "filled": False})
    # straight segments (circles blanked so their arcs are not read as lines)
    lines_mask = mask.copy()
    for cx_, cy_, r_ in merged:
        cv2.circle(lines_mask, (int(cx_), int(cy_)), int(r_) + 4, 0, 9)
    def skeleton(m):
        m = m.copy(); sk = np.zeros_like(m); el = cv2.getStructuringElement(cv2.MORPH_CROSS, (3, 3))
        for _ in range(60):
            op = cv2.morphologyEx(m, cv2.MORPH_OPEN, el); sk = cv2.bitwise_or(sk, cv2.subtract(m, op)); m = cv2.erode(m, el)
            if not m.any(): break
        return sk
    thin = skeleton(lines_mask)
    segs = cv2.HoughLinesP(thin, 1, np.pi / 180, threshold=max(8, int(10 * a.dpi / 200)), minLineLength=int(5 * a.dpi / 72), maxLineGap=max(2, int(2 * a.dpi / 72)))
    raw = [] if segs is None else [tuple(map(float, s)) for s in np.array(segs).reshape(-1, 4)]
    def ang(s): return math.atan2(s[3] - s[1], s[2] - s[0]) % math.pi
    def off(s, th): return -s[0] * math.sin(th) + s[1] * math.cos(th)
    def along(s, th): return sorted([s[0] * math.cos(th) + s[1] * math.sin(th), s[2] * math.cos(th) + s[3] * math.sin(th)])
    groups = []
    for s in sorted(raw, key=lambda s: -math.hypot(s[2] - s[0], s[3] - s[1])):
        th = ang(s)
        for g in groups:
            dth = abs(g["th"] - th); dth = min(dth, math.pi - dth)
            if dth < math.radians(3) and abs(off(s, g["th"]) - g["off"]) < 3 * a.dpi / 200 + 1:
                lo, hi = along(s, g["th"])
                if lo <= g["hi"] + 4 * a.dpi / 200 and hi >= g["lo"] - 4 * a.dpi / 200:
                    g["lo"], g["hi"] = min(g["lo"], lo), max(g["hi"], hi); break
        else:
            lo, hi = along(s, th); groups.append({"th": th, "off": off(s, th), "lo": lo, "hi": hi})
    for g in groups:
        th = g["th"]; c, s_ = math.cos(th), math.sin(th)
        p0 = (g["lo"] * c - g["off"] * s_, g["lo"] * s_ + g["off"] * c); p1 = (g["hi"] * c - g["off"] * s_, g["hi"] * s_ + g["off"] * c)
        # stroke width: run-length of the ORIGINAL ink across the segment's middle, perpendicular to it
        mx, my = (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2; nx, ny = -s_, c
        run = 0
        for sgn in (1, -1):
            for t in range(0 if sgn == 1 else 1, 25):
                x, y = int(round(mx + nx * t * sgn)), int(round(my + ny * t * sgn))
                if 0 <= x < W and 0 <= y < H and mask[y, x] > 0: run += 1
                else: break
        prims.append({"type": "line", "x0": round(p0[0] * k, 2), "y0": round(p0[1] * k, 2), "x1": round(p1[0] * k, 2), "y1": round(p1[1] * k, 2), "lw": round(max(run, 1) * k, 2)})
    print(json.dumps({"width": round(W * k, 2), "height": round(H * k, 2), "dpi": a.dpi, "words": words, "primitives": prims}))
