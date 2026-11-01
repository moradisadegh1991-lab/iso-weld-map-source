"""What an isometric sheet prints at each weld marker — read without a model.

    python3 -I tools/iso-read.py <sheet.pdf|.png|.jpg> [--page 1] [--dpi 200] [--debug out.png]

Prints one JSON object: { "orientation", "meta": {drawingNo, sheet, rev},
"lineData": {...}, "bom": [...], "cutLengths": [...], "weldDots": [[x, y]], "socketEnds": [[x, y]],
"marks": [ {no, shape, outline, label, box, at, weldAt?, weldDot?} ], "tags": [...],
"rejected": [...] }. `weldAt` is where the marker's leader meets the pipe and
`weldDots` the weld dots drawn on the pipe (weld_points;
docs/epc-llm/10-weld-points.md), both fractions of the page as rendered. `meta` is
the title block (read_title; any part not read for certain is null),
`lineData` the line data printed in it (read_line_data) and `bom` the bill of
material beside the drawing (read_bom), each as the sheet prints it; `box`
is in the upright page's pixels, `at` the marker's centre as fractions of
the page as rendered (before it was turned upright). The
same `marks` a model's `welds` pass
reports (lib/register/weld-marks.mjs), and nothing more: shop or field, the
joint type and the register are decided there, by the project's declared
symbol convention and the sheet's BOM.

How a marker is found, all of it plain image processing (OpenCV) and a
local OCR engine (tesseract), no network, no model:

  1. The page is turned upright: of the four turns, the one in which the
     most frames hold a weld number.
  2. Every enclosed white region (a hole in the ink) of marker size is a
     candidate frame. A frame is a thin closed stroke around it — a square
     (four corners, square aspect, filling its box) or a circle (round:
     nearest over farthest outline point from the centre above 0.9, which
     the spool mark's hexagon, about 0.84, is not).
  3. Table cells are square holes too: a candidate inside a stack of at
     least three long horizontal rules (the BOM table, the title block) is
     dropped.
  4. The inside of the frame is read as a weld number (digits, an optional
     "-n" suffix) four ways and by majority; a frame holding two lines of
     text (an instrument bubble, a material box) or no number is not a weld
     marker.
  5. THD, FFW or BR printed near a frame — above, below or beside — is the
     label of the nearest frame, closest pairs first.

Measured on the 54 golden sheets of eval/cases/golden (npm run eval:reader;
docs/epc-llm/08-no-model-reader.md).

What it does not do: dashed frames (a joint of the neighbouring sheet) are
not closed and are not found; that is the right answer for the register,
which excludes them, but they are not reported either. The size at each
weld and branches are not read here (docs/epc-llm/09-iso-symbols.md).
"""
import sys, json, subprocess, tempfile, os, re, bisect
import numpy as np, cv2

args = sys.argv[1:]
src = args[0]
dpi = int(args[args.index("--dpi") + 1]) if "--dpi" in args else 200
page = int(args[args.index("--page") + 1]) if "--page" in args else 1
debug = args[args.index("--debug") + 1] if "--debug" in args else None
S = dpi / 200.0                     # every size below is for 200 dpi


def load_at(path, at_dpi):
    with tempfile.TemporaryDirectory() as d:
        subprocess.run(["pdftoppm", "-r", str(at_dpi), "-gray", "-png", "-f", str(page), "-l", str(page), path, f"{d}/p"], check=True)
        f = [x for x in os.listdir(d) if x.endswith(".png")][0]
        return cv2.imread(f"{d}/{f}", cv2.IMREAD_GRAYSCALE)


def load(path):
    if path.lower().endswith(".pdf"):
        with tempfile.TemporaryDirectory() as d:
            subprocess.run(["pdftoppm", "-r", str(dpi), "-gray", "-png", "-f", str(page), "-l", str(page), path, f"{d}/p"], check=True)
            f = [x for x in os.listdir(d) if x.endswith(".png")][0]
            return cv2.imread(f"{d}/{f}", cv2.IMREAD_GRAYSCALE)
    return cv2.imread(path, cv2.IMREAD_GRAYSCALE)


def tess(img, psm, extra=()):
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        cv2.imwrite(f.name, img)
        name = f.name
    try:
        # one thread: its own threading only slows a server reading several sheets at once
        r = subprocess.run(["tesseract", name, "-", "--psm", str(psm), *extra], capture_output=True, text=True,
                           env={**os.environ, "OMP_THREAD_LIMIT": "1"})
        return r.stdout
    finally:
        os.unlink(name)


def table_boxes(ink):
    """Bounding boxes of the ruled tables: where long horizontal rules stack."""
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (int(260 * S), 1))
    rules = cv2.morphologyEx(ink, cv2.MORPH_OPEN, k)
    n, lab, st, _ = cv2.connectedComponentsWithStats(rules)
    lines = [st[i] for i in range(1, n) if st[i][2] >= 260 * S]
    boxes = []
    for x, y, w, h, _ in lines:
        # a rule with another rule of overlapping span within 400 px below or above is part of a table
        mates = [l for l in lines if abs(l[1] - y) < 400 * S and abs(l[1] - y) > 5 and min(x + w, l[0] + l[2]) - max(x, l[0]) > 0.5 * min(w, l[2])]
        # a table stacks rules: two long lines are a border and a dimension
        # line as often as a table (25-1007: the sheet border and the line
        # under weld 1 hid both its welds)
        if len(mates) >= 2:
            ys = [y] + [l[1] for l in mates]
            boxes.append((x - 4, min(ys) - 4, x + w + 4, max(ys) + 4))
    return boxes


def inside(b, boxes):
    x0, y0, x1, y1 = b
    return any(x0 >= a[0] and x1 <= a[2] and y0 >= a[1] and y1 <= a[3] for a in boxes)


def roundness(c):
    """Nearest over farthest point of the outline from its centre: a circle
    is about 0.95, a hexagon (the spool mark) about 0.84."""
    m = cv2.moments(c)
    if m["m00"] == 0:
        return 0
    d = np.hypot(c[:, 0, 0] - m["m10"] / m["m00"], c[:, 0, 1] - m["m01"] / m["m00"])
    return d.min() / d.max()


def batch_read(crops, psm, whitelist):
    """Read many small images in one tesseract run: stacked on one canvas
    with white space between, each read back by where its words fall. One
    process per page instead of one per marker (a sheet went from minutes
    to seconds) — the same engine and settings either way."""
    if not crops:
        return []
    gap = 60
    width = max(c.shape[1] for c in crops) + 2 * gap
    height = sum(c.shape[0] + gap for c in crops) + gap
    canvas = np.full((height, width), 255, np.uint8)
    spans, y = [], gap
    for c in crops:
        canvas[y:y + c.shape[0], gap:gap + c.shape[1]] = c
        spans.append((y, y + c.shape[0]))
        y += c.shape[0] + gap
    out = tess(canvas, psm, ["-c", f"tessedit_char_whitelist={whitelist}", "-c", "preserve_interword_spaces=1", "tsv"])
    words = [[] for _ in crops]
    for line in out.splitlines()[1:]:
        f = line.split("\t")
        if len(f) < 12 or not f[11].strip():
            continue
        left, top, h = int(f[6]), int(f[7]), int(f[9])
        cy = top + h / 2
        for i, (a, b) in enumerate(spans):
            if a - gap / 2 <= cy <= b + gap / 2:
                words[i].append((left, f[11].strip()))
                break
    return [" ".join(t for _, t in sorted(ws)) for ws in words]


NUMBER = re.compile(r"\d{1,3}(-\d{1,2})?")


def number_crops(g, x, y, w, h, contour=None):
    """The inside of a frame four ways — grey and binarized, 2× and 3×. A
    circle's crop is blanked outside the hole's own outline (pulled in 2 px):
    its arc in the crop's corners took the "1" of "15"."""
    pad = int(max(w, h) * 0.12)
    crop = g[y:y + h, x:x + w].copy()
    if contour is not None:
        mask = np.zeros(crop.shape, np.uint8)
        cv2.drawContours(mask, [contour - [x, y]], -1, 255, -1)
        crop[cv2.erode(mask, np.ones((5, 5), np.uint8)) == 0] = 255
    crop = crop[pad:h - pad, pad:w - pad]
    _, bw = cv2.threshold(crop, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    out = []
    for base in (crop, bw):
        b = cv2.copyMakeBorder(base, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=255)
        for f in (2, 3):
            out.append(cv2.resize(b, None, fx=f, fy=f, interpolation=cv2.INTER_CUBIC))
    return out


def text_lines(img):
    """Rows of text in a binarized crop: bands of inked rows split by a
    blank run at least a twentieth of the crop high. Any ink counts — the
    thin stroke joining a bold "5"'s bar to its bowl is a row of text too —
    but a band with under a quarter of the main band's ink is a speck of a
    neighbouring line (an insulation scallop under "23"), not text."""
    rows = (img < 128).sum(axis=1)
    gap_min = max(3, img.shape[0] // 20)
    bands, cur, blank = [], None, gap_min
    for n in rows:
        if n > 0:
            if cur is None or blank >= gap_min:
                cur = [0]
                bands.append(cur)
            cur[0] += int(n)
            blank = 0
        else:
            blank += 1
    if not bands:
        return 0
    top = max(b[0] for b in bands)
    return sum(1 for b in bands if b[0] >= 0.25 * top)


def read_numbers(g, cands):
    """Each frame's number: the reading most of the four variants agree on.
    Every single setting failed on some golden marker (a lone bold "9" lost
    at 2× grey; "15" read "18" at 3× binarized); the vote is right on both.
    A frame no variant read as a line gets one try per variant as a single
    character."""
    variants = [number_crops(g, *c["xywh"], c["contour"] if c["shape"] == "circle" else None) for c in cands]
    # A weld frame holds one line: its number. An instrument bubble ("FG"
    # over "8151", read 85 through the digit whitelist) and a material box
    # ("MATL" over "1P1", read 11) hold two, and are not weld markers.
    lines = [text_lines(v[1]) for v in variants]
    votes = [{} for _ in cands]
    for k in range(4):
        for i, t in enumerate(batch_read([v[k] for v in variants], 6, "0123456789-")):
            t = t.replace(" ", "")
            if NUMBER.fullmatch(t):
                votes[i][t] = votes[i].get(t, 0) + 1
    for i, n in enumerate(lines):
        if n != 1:
            votes[i] = {}
            variants[i] = None
    for i, v in enumerate(variants):
        if votes[i] or v is None:
            continue
        for k in (1, 3):
            t = tess(v[k], 10, ["-c", "tessedit_char_whitelist=0123456789-"]).strip()
            if NUMBER.fullmatch(t):
                votes[i][t] = votes[i].get(t, 0) + 1
    return [max(v.items(), key=lambda kv: (kv[1], len(kv[0])))[0] if v else "" for v in votes]


def batch_words(crops, psm, whitelist):
    """Like batch_read, but every word with its box in its own crop's pixels."""
    if not crops:
        return []
    gap = 60
    width = max(c.shape[1] for c in crops) + 2 * gap
    height = sum(c.shape[0] + gap for c in crops) + gap
    canvas = np.full((height, width), 255, np.uint8)
    spans, y = [], gap
    for c in crops:
        canvas[y:y + c.shape[0], gap:gap + c.shape[1]] = c
        spans.append(y)
        y += c.shape[0] + gap
    out = tess(canvas, psm, ["-c", f"tessedit_char_whitelist={whitelist}", "tsv"])
    words = []
    for line in out.splitlines()[1:]:
        f = line.split("\t")
        if len(f) < 12 or not f[11].strip():
            continue
        left, top, w, h = int(f[6]), int(f[7]), int(f[8]), int(f[9])
        cy = top + h / 2
        for i, y0 in enumerate(spans):
            if y0 <= cy <= y0 + crops[i].shape[0]:
                words.append((i, left - gap, top - y0, w, h, f[11].strip()))
                break
    return words


LABELS = ("THD", "FFW", "BR")


def read_labels(g, marks):
    """THD / FFW / BR printed near a frame — above, below, or beside it.
    Each word found is placed back on the page and given to the NEAREST
    frame: a label printed between two frames belongs to one of them, not
    both (25-1003: FFW between welds 15 and 13)."""
    H, W = g.shape
    crops, origin = [], []
    for m in marks:
        x, y, w, h = m["xywh"]
        x0, y0 = int(max(0, x - 1.3 * w)), int(max(0, y - 0.9 * h))
        x1, y1 = int(min(W, x + 2.3 * w)), int(min(H, y + 1.9 * h))
        crops.append(cv2.resize(g[y0:y1, x0:x1], None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC))
        origin.append((x0, y0))
    found = []
    for i, x, y, w, h, t in batch_words(crops, 11, "THDFWBR"):
        if t.upper() not in LABELS:
            continue
        cx, cy = origin[i][0] + (x + w / 2) / 2, origin[i][1] + (y + h / 2) / 2
        if not any(abs(cx - a) < 12 and abs(cy - b) < 12 and t2 == t.upper() for a, b, t2 in found):
            found.append((cx, cy, t.upper()))
    # closest pairs first; a word and a frame are each used once
    def gap(m, cx, cy):
        x, y, w, h = m["xywh"]
        dx = max(x - cx, 0, cx - (x + w))
        dy = max(y - cy, 0, cy - (y + h))
        return (dx * dx + dy * dy) ** 0.5
    pairs = sorted((gap(m, cx, cy), j, i) for i, (cx, cy, t) in enumerate(found) for j, m in enumerate(marks))
    out, used = [""] * len(marks), set()
    for d, j, i in pairs:
        if i in used or out[j] or d > 1.1 * max(marks[j]["xywh"][2:]):
            continue
        out[j] = found[i][2]
        used.add(i)
    return out


def detect(g):
    """The weld markers of an upright page: (marks, rejected, tables)."""
    _, ink = cv2.threshold(g, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    tables = table_boxes(ink)
    cnts, hier = cv2.findContours(ink, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    lo, hi = 38 * S, 130 * S
    marks, rejected = [], []
    for i, c in enumerate(cnts):
        if hier[0][i][3] < 0:          # outer stroke boundary; the holes are what we want
            continue
        x, y, w, h = cv2.boundingRect(c)
        if not (lo <= w <= hi and lo <= h <= hi) or not (0.8 <= w / h <= 1.25):
            continue
        area = cv2.contourArea(c)
        peri = cv2.arcLength(c, True)
        if peri == 0:
            continue
        fill = area / (w * h)
        circ = 4 * np.pi * area / (peri * peri)
        approx = cv2.approxPolyDP(c, 0.04 * peri, True)
        if len(approx) == 4 and fill > 0.88:
            shape = "square"
        elif circ > 0.82 and 0.70 < fill < 0.85 and roundness(c) > 0.9:
            shape = "circle"
        else:
            continue
        # a thin frame: the band just outside the hole's own outline is ink
        # (2–3 px at 200 dpi), whatever the hole's shape
        band = max(2, int(3 * S))
        x0, y0 = max(0, x - band - 1), max(0, y - band - 1)
        sub = ink[y0:y + h + band + 1, x0:x + w + band + 1]
        hole = np.zeros(sub.shape, np.uint8)
        cv2.drawContours(hole, [c - [x0, y0]], -1, 255, -1)
        ring = cv2.dilate(hole, np.ones((2 * band + 1, 2 * band + 1), np.uint8)) & ~hole
        if (sub[ring > 0] > 0).mean() < 0.35:
            continue
        box = (x, y, x + w, y + h)
        if inside(box, tables):
            rejected.append({"why": "table", "box": box})
            continue
        marks.append({"shape": shape, "outline": "solid", "box": [int(v) for v in box], "xywh": (x, y, w, h), "contour": c})
    # the numbers, then the labels, each in one pass over the page
    nos = read_numbers(g, marks)
    for m, no in zip(marks, nos):
        m["no"] = no
    for m in [m for m in marks if not m["no"]]:
        rejected.append({"why": "no number", "shape": m["shape"], "box": m["box"]})
    marks = [m for m in marks if m["no"]]
    return marks, rejected, tables


TAG_NO = re.compile(r"[A-Z]{1,3}-\d{1,3}")


def detect_tags(g, tables):
    """The spool marks and support marks of an upright page: [{kind, no, box, xywh}].

    A spool mark is an OVAL holding its number (SP-1), a support mark a
    HEXAGON (SW-1, S-2) — on the sheets that taught this, and as the
    platform draws them back (lib/sheet/markup.mjs). The shape is the
    evidence of the kind; the text inside is read like a weld number, four
    ways and by majority, and a frame whose text is not letters, a hyphen
    and digits is not reported (it is not guessed)."""
    _, ink = cv2.threshold(g, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    cnts, hier = cv2.findContours(ink, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    found = []
    for i, c in enumerate(cnts):
        if hier[0][i][3] < 0:
            continue
        x, y, w, h = cv2.boundingRect(c)
        if not (80 * S <= w <= 190 * S and 40 * S <= h <= 100 * S):
            continue
        area = cv2.contourArea(c)
        peri = cv2.arcLength(c, True)
        if peri == 0 or len(c) < 5:
            continue
        fill, ar = area / (w * h), w / h
        # how far the hole is from the ellipse fitted to it: an oval is within a few percent, a hexagon is not
        el = cv2.fitEllipse(c)
        a, b = np.zeros(g.shape[:2], np.uint8), np.zeros(g.shape[:2], np.uint8)
        cv2.ellipse(a, el, 255, -1)
        cv2.drawContours(b, [c], -1, 255, -1)
        miss = 1 - cv2.countNonZero(cv2.bitwise_and(a, b)) / max(1, cv2.countNonZero(cv2.bitwise_or(a, b)))
        verts = len(cv2.approxPolyDP(c, 0.03 * peri, True))
        if 1.9 <= ar <= 3.0 and 0.68 <= fill <= 0.84 and miss < 0.03:
            kind = "spool"
        elif 1.2 <= ar <= 1.5 and 0.68 <= fill <= 0.82 and verts == 6 and 0.03 <= miss <= 0.15:
            kind = "support"
        else:
            continue
        box = (x, y, x + w, y + h)
        if inside(box, tables):
            continue
        found.append({"kind": kind, "box": [int(v) for v in box], "xywh": (x, y, w, h), "contour": c})
    variants = [number_crops(g, *t["xywh"], t["contour"]) for t in found]
    votes = [{} for _ in found]
    for k in range(4):
        for i, t in enumerate(batch_read([v[k] for v in variants], 6, "SPWU-0123456789")):
            t = t.replace(" ", "").upper()
            if TAG_NO.fullmatch(t):
                votes[i][t] = votes[i].get(t, 0) + 1
    tags = []
    for t, v in zip(found, votes):
        if v:
            t["no"] = max(v.items(), key=lambda kv: (kv[1], len(kv[0])))[0]
            tags.append(t)
    return tags


def cell_vote(cell, whitelist, valid, key=lambda o: o, scales=(3, 4), spaces=False):
    """One line of a title-block cell read four ways (grey and two-level, 3x
    and 4x, white margin round it). An answer only when every reading that
    fits the pattern says the same thing; none, or two that disagree, is
    unknown."""
    outs = []
    for k in scales:
        big = cv2.resize(cell, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC if k >= 1 else cv2.INTER_AREA)
        _, bw = cv2.threshold(big, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        for im in (big, bw):
            im = cv2.copyMakeBorder(im, 30, 30, 30, 30, cv2.BORDER_CONSTANT, value=255)
            o = tess(im, 7, ["-c", f"tessedit_char_whitelist={whitelist}", "-c", "preserve_interword_spaces=1"]).strip()
            outs.append(re.sub(r"\s+", " ", o) if spaces else o.replace(" ", ""))
    got = {key(o) for o in outs if valid(o)}
    return got.pop() if len(got) == 1 else None


def runs(mask):
    """Start and end of each run of True."""
    out = []
    for i in np.flatnonzero(mask):
        if out and i - out[-1][1] <= 2:
            out[-1][1] = i
        else:
            out.append([i, i])
    return out


# The line data printed in the title block: each value is the words beside
# its label, inside the label's own cell, and kept only when it reads as
# such a value. A label under a heading ("DESIGN" under PRESSURE or under
# TEMPERATURE) takes its meaning from the heading above it in its column.
LINE_FIELDS = [
    # key, label word, heading word above (or None), may the value sit below the label, valid value
    ("designPressure", r"DESIGN:?", r"PRESSURE", False, r"\d+(?:[.,]\d+)?(?:\s*,?\s*FV)?|FV"),
    ("operatingPressure", r"OPERATING:?", r"PRESSURE", False, r"\d+(?:[.,]\d+)?(?:\s*-\s*\d+(?:[.,]\d+)?)?"),
    ("designTemp", r"DESIGN:?", r"TEMPERATURE", False, r"-?\d+(?:[.,]\d+)?"),
    ("operatingTemp", r"OPERATING:?", r"TEMPERATURE", False, r"-?\d+(?:[.,]\d+)?(?:\s*-\s*-?\d+(?:[.,]\d+)?)?"),
    ("insulationType", r"TYPE:?", r"INSULATION", False, r"[A-Z]{1,4}|NONE|N/?A|-"),
    ("insulationThk", r"THK", r"INSULATION", False, r"\d{1,3}|-"),
    ("testFluid", r"FLUID:?", r"TEST", False, r"WATER|AIR|NITROGEN|N2|SERVICE|PNEUMATIC|HYDRO(?:STATIC)?"),
    ("testPressure", r"PRESSURE:?", r"TEST", True, r"\d+(?:[.,]\d+)?"),
    ("lineClass", r"CLASS:?", r"LINE", True, r"[0-9][A-Z0-9]{1,5}|[A-Z][0-9][A-Z0-9]{0,4}"),
    ("paint", r"PAINT:?", None, False, r"[A-Z]{1,3}-?\d{1,3}|NONE|N/?A|-"),
    ("ndt", r"NDT:?", None, False, r"[A-Z]|\d{1,3}\s*%|[A-Z]\d?"),
    ("pwht", r"PWHT:?", None, False, r"YES|NO|N/?A|REQ(?:UIRED|'D)?|-"),
]


def read_line_data(strip, words, vert, horz, corner_label):
    """The line data of the title block (LINE_FIELDS), and the line number.

    A value is kept only when it fits its field's pattern; anything else is
    null, never a near guess. The line number is kept only when the title
    block's LINE NO. cell and the file label at the sheet's corner,
    "(ISO-aa-nnnn)/<line>", read the same."""
    Hs, Ws = strip.shape[:2]

    def cell_of(w):
        cx, cy = w["x"] + w["w"] // 2, w["y"] + w["h"] // 2
        row = vert[max(0, cy - 2):cy + 3, :].max(0) > 0
        col = horz[:, max(0, cx - 2):cx + 3].max(1) > 0
        left = next((x for x in range(w["x"] - 2, -1, -1) if row[x]), 0)
        right = next((x for x in range(w["x"] + w["w"] + 2, Ws) if row[x]), Ws)
        top = next((y for y in range(cy, -1, -1) if col[y]), 0)
        bottom = next((y for y in range(cy, Hs) if col[y]), Hs)
        return left, right, top, bottom

    def heading_of(w, pattern):
        # the heading over the label, in its column, in the same cell
        l, r, t, _ = cell_of(w)
        return any(re.fullmatch(pattern, h["t"].strip("(:")) and l <= h["x"] + h["w"] // 2 <= r and t <= h["y"] < w["y"] for h in words)

    out = {}
    used = set()
    for key, lab, head, below, ok in LINE_FIELDS:
        got = None
        for w in words:
            if id(w) in used or not re.fullmatch(lab, w["t"]):
                continue
            if head and not heading_of(w, head):
                continue
            l, r, t, b = cell_of(w)
            cy = w["y"] + w["h"] / 2
            vals = sorted((v for v in words if v is not w and v["x"] > w["x"] + w["w"] - 2 and v["x"] + v["w"] <= r + 2
                           and t <= v["y"] + v["h"] / 2 <= b
                           and (abs(v["y"] + v["h"] / 2 - cy) < max(w["h"], v["h"]) * 0.6
                                or (below and v["y"] > w["y"]))),
                          key=lambda v: (round((v["y"] + v["h"] / 2 - cy) / max(1, w["h"] * 1.2)), v["x"]))
            # the value runs to the next label of the cell (a word ending in ":"); a unit in brackets is not the value
            text, boxes = [], []
            for v in vals:
                if re.fullmatch(r"\(.*\):?", v["t"]):
                    continue
                if v["t"].endswith(":"):
                    break
                text.append(v["t"])
                boxes.append(v)
            # 6,2 printed 6.2: a comma between two digits is the decimal point either way
            value = re.sub(r"(?<=\d),(?=\d)", ".", " ".join(text).strip(" :"))
            if value and re.fullmatch(ok, value):
                used.add(id(w))
                # a number stands only when its cell, read again several ways on its own, says the
                # same: one reading drops a minus sign ("-5" read "5") or a decimal point
                if re.search(r"\d", value) and key not in ("paint", "lineClass"):
                    same = [b2 for b2 in boxes if abs(b2["y"] - boxes[0]["y"]) < w["h"]]
                    bx0 = max(w["x"] + w["w"] + 2, min(b2["x"] for b2 in same) - int(14 * S))
                    bx1 = max(b2["x"] + b2["w"] for b2 in same) + 6
                    # the value's own line, as tall as its label's: a taller box takes in the line below
                    mid = sum(b2["y"] + b2["h"] / 2 for b2 in same) / len(same)
                    by0, by1 = int(mid - w["h"] * 0.5) - 5, int(mid + w["h"] * 0.5) + 5
                    norm = lambda o: re.sub(r"(?<=\d),(?=\d)", ".", re.sub(r"\s+", "", o))
                    again = cell_vote(strip[max(0, by0):by1, bx0:bx1], "0123456789-~.,FV",
                                      lambda o: bool(re.fullmatch(ok, o.replace(",FV", ", FV"))), key=norm)
                    if again is None or again != norm(value):
                        value = None
                got = value
                break
        out[key] = got

    # LINE NO.: the title-block cell and the corner label must agree, each read
    # on its own several ways (cell_vote) — one reading, or two that differ, is unknown
    line_pat = re.compile(r"(\d{1,2}(?:\.\d/\d)?)\"?-([A-Z]{1,5}-\d{3,6}-[A-Z0-9]{1,5}(?:-[A-Z0-9]{1,4})?)")
    white = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-/().\""

    def vote(box):
        x0_, y0_, x1_, y1_ = box
        crop = strip[max(0, y0_ - 4):y1_ + 4, max(0, x0_ - 6):x1_ + 6]
        return cell_vote(crop, white, lambda o: line_pat.search(o), key=lambda o: "%s\"-%s" % line_pat.search(o).groups())

    corner = None
    if corner_label:
        c = corner_label
        row = sorted((v for v in words if abs((v["y"] + v["h"] / 2) - (c["y"] + c["h"] / 2)) < c["h"] * 0.6 and v["x"] >= c["x"]), key=lambda v: v["x"])
        end_x = c["x"] + c["w"]
        for v in row[1:]:
            if v["x"] - end_x > 40 * S:
                break
            end_x = v["x"] + v["w"]
        corner = vote((c["x"], c["y"], end_x, c["y"] + c["h"]))
    cell = None
    if corner:
        for w in words:
            if w is corner_label or not line_pat.search(w["t"].replace("*", '"')):
                continue
            if vote((w["x"], w["y"], w["x"] + w["w"], w["y"] + w["h"])) == corner:
                cell = corner
                break
    out["lineNo"] = cell
    return out


BOM_GROUP = re.compile(r"(?:PIPES?|FITTINGS?|FLANGES?|SUPPORTS?|GASKETS?|BOLTS?(?: ?& ?NUTS)?|STUD BOLTS|VALVES?(?: ?/ ?IN-LINE ITEMS)?|IN-LINE ITEMS|"
                       r"INSTRUMENTS?|SPECIAL(?: ITEMS)?|SPECIALS|MISC(?:ELLANEOUS)?\.?|OLETS?|BRANCH(?:ES)?)")
BOM_SIZE = re.compile(r"(\d+(?:\.\d+/\d+|/\d+|\.\d+)?)(?:\s*[xX]\s*(\d+(?:\.\d+/\d+|/\d+|\.\d+)?))?")
# the nominal pipe sizes a size column can hold; a bolt's second figure is its length in mm
NPS = {"1/8", "1/4", "3/8", "1/2", "3/4", "1", "1.1/4", "1.1/2", "2", "2.1/2", "3", "3.1/2", "4", "5", "6", "8", "10", "12",
       "14", "16", "18", "20", "22", "24", "26", "28", "30", "32", "34", "36", "40", "42", "44", "48", "52", "56", "60"}
BOLT_DIA = {"1/2", "5/8", "3/4", "7/8", "1", "1.1/8", "1.1/4", "1.3/8", "1.1/2", "1.5/8", "1.3/4", "1.7/8", "2"}


def bom_size(text, description):
    """The N.S. column as printed — "6", "6 x 3/4", a bolt's "5/8 x 90" — or None
    when it does not read as nominal sizes (a lost slash reads 1/2 as "172")."""
    m = BOM_SIZE.fullmatch(text)
    if not m:
        return None
    a, b = m.group(1), m.group(2)
    bolt = re.search(r"\bBOLT", description.upper())
    if a not in (BOLT_DIA if bolt else NPS):
        return None
    if b is None:
        return a
    if b in NPS or (bolt and re.fullmatch(r"\d{2,3}", b)):
        return f"{a} x {b}"
    return None


# ── where each weld is on the pipe ────────────────────────────────────────
# Measured on the golden sheets (docs/epc-llm/10-weld-points.md). At 300 dpi
# a weld is drawn as a filled dot on the pipe, about 5.4 px in inscribed
# radius; the pipe's heavy line is 2.8-3, a flow arrowhead 6.4 and more, a
# leader 1-1.5. 200 dpi does not tell a dot from the sheet's border line, so
# the page is rendered again at 300 dpi for this.
DOT_DT = (4.3, 6.3)
PIPE_DT, PIPE_LEN = 2.0, 40       # the pipe: a run of ink at least 2 px from its edge, 40 px long or more
LEAD_DT = 2.4                     # a leader ends where it meets ink this thick (a pipe, a fitting's body)


def weld_points(g3, frames, avoid):
    """Each frame's weld point, and the dots drawn on the pipe.

    g3      the upright page at 300 dpi
    frames  the weld frames' boxes, in g3's pixels
    avoid   boxes where nothing is a weld (spool and support tags, tables)

    A frame's weld point is where its leader meets the pipe: the line that
    leaves the frame is followed (one bend at most) until it reaches the
    pipe's heavy line or a dot, and snaps to a dot within 14 px. A frame whose
    leader is not followed to the pipe has none — a frame in a stack drawn
    without a leader of its own included: it is not the stack's point.

    Returns ([ (x, y, on_dot) | None per frame ], [ (x, y) dots on the pipe ],
    [ (x, y) socket ends on the pipe ]).
    """
    H, W = g3.shape
    ink = (g3 < 140).astype(np.uint8)
    dt = cv2.distanceTransform(ink, cv2.DIST_L2, 5)
    fmask = np.zeros_like(ink)
    for x0, y0, x1, y1 in list(frames) + list(avoid):
        fmask[max(0, y0 - 4):y1 + 5, max(0, x0 - 4):x1 + 5] = 1
    core = ((dt >= DOT_DT[0]) & (fmask == 0)).astype(np.uint8)
    n, lab, st, cen = cv2.connectedComponentsWithStats(core, 8)
    dots = []
    for i in range(1, n):
        x, y, w, h, a = st[i]
        if a < 6 or w > 16 or h > 16:
            continue
        if dt[y:y + h, x:x + w][lab[y:y + h, x:x + w] == i].max() > DOT_DT[1]:
            continue
        dots.append((float(cen[i][0]), float(cen[i][1])))
    darr = np.array(dots) if dots else np.zeros((0, 2))

    # the frames' own outlines erased: a stack of frames touching each other is not a leader
    ink2 = ink.copy()
    for x0, y0, x1, y1 in frames:
        ink2[max(0, y0 - 6):y1 + 7, max(0, x0 - 6):x1 + 7] = 0
    inkb = cv2.dilate(ink2, np.ones((3, 3), np.uint8))
    th0 = ((dt >= LEAD_DT) & (fmask == 0)).astype(np.uint8)
    n2, lab2, st2, _ = cv2.connectedComponentsWithStats(th0, 8)
    keep = np.zeros(n2, np.uint8)
    keep[1:] = np.maximum(st2[1:, 2], st2[1:, 3]) >= 50
    thick = keep[lab2]
    for x, y in dots:
        cv2.circle(thick, (int(x), int(y)), 5, 1, -1)
    # the pipe as the dots are tested against it (a smaller bore is drawn thinner than LEAD_DT)
    tp = ((dt >= PIPE_DT) & (fmask == 0)).astype(np.uint8)
    n3, lab3, st3, _ = cv2.connectedComponentsWithStats(tp, 8)
    # long and thin, or sparse in its box as an elbow's L is — not a bold letter (FFW, THD), compact in its box
    w3, h3, a3 = st3[1:, 2].astype(float), st3[1:, 3].astype(float), st3[1:, 4].astype(float)
    keep3 = np.zeros(n3, np.uint8)
    keep3[1:] = (np.maximum(w3, h3) >= PIPE_LEN) & ((np.maximum(w3, h3) / np.maximum(1, np.minimum(w3, h3)) >= 3) | (a3 / (w3 * h3) < 0.25))
    pipe = keep3[lab3]
    small = (th0 > 0) & (thick == 0)    # a fitting's short body, or a label's bold letters

    lmax = int(0.22 * W)
    ang = np.deg2rad(np.arange(0, 360, 1.0))
    steps = np.arange(1, lmax)
    cos_, sin_ = np.cos(ang)[:, None] * steps, np.sin(ang)[:, None] * steps

    def scan(px, py, min_small, avoid_ang=None):
        xs = (px + cos_).round().astype(int)
        ys = (py + sin_).round().astype(int)
        ok = (xs >= 0) & (xs < W) & (ys >= 0) & (ys < H)
        xs, ys = xs.clip(0, W - 1), ys.clip(0, H - 1)
        on = (inkb[ys, xs] > 0) & ok
        run = np.where(on.all(1), lmax, np.argmin(on, 1))
        th = (thick[ys, xs] > 0) & ok
        first = np.where(th.any(1), np.argmax(th, 1), lmax)
        sm = small[ys, xs] & ok
        sm[:, :int(min_small)] = False        # not the frame's own label (THD, FFW printed beside it)
        first_sm = np.where(sm.any(1), np.argmax(sm, 1), lmax)
        # the pipe or a dot reached along the run wins over a short thick spot passed on the way
        # (two thin lines crossing look thick for a few pixels)
        first = np.where(first < run, first, first_sm)
        hit = first < run
        length = np.where(hit, first, run)
        if avoid_ang is not None:
            back = np.abs(((ang - avoid_ang + np.pi) % (2 * np.pi)) - np.pi) < np.deg2rad(160)
            length = np.where(back, length, 0)
        k = int(np.argmax(length + hit * 5))
        L = int(length[k])
        return ang[k], L, (px + np.cos(ang[k]) * L, py + np.sin(ang[k]) * L), bool(hit[k])

    points = []
    for x0, y0, x1, y1 in frames:
        # the lines leaving the frame: ink in a band 8-12 px outside it (found in a window round the frame)
        wx, wy = max(0, x0 - 12), max(0, y0 - 12)
        win = ink2[wy:y1 + 13, wx:x1 + 13].copy()
        win[max(0, y0 - 8) - wy:y1 + 9 - wy, max(0, x0 - 8) - wx:x1 + 9 - wx] = 0
        m, _, _, ecen = cv2.connectedComponentsWithStats(win, 8)
        ecen = ecen + [wx, wy]
        min_small = 1.2 * max(x1 - x0, y1 - y0)
        best = None
        for e in range(1, m):
            px, py = ecen[e]
            a, L, end, hit = scan(px, py, min_small)
            mx, my = px + np.cos(a) * 12, py + np.sin(a) * 12
            if x0 - 3 <= mx <= x1 + 3 and y0 - 3 <= my <= y1 + 3:
                continue          # along the frame's own side, not away from it
            total = L
            if not hit and L >= 15:      # a bent leader: one turn more
                # the frame's own label (THD, FFW printed beside it) stays out on the second leg too:
                # turning there, the first version ended 17 leaders on the golden sheets on a label
                a2, L2, end2, hit2 = scan(end[0], end[1], max(0, min_small - L), avoid_ang=a)
                if hit2 and L2 >= 8:
                    end, hit, total = end2, True, L + L2
            if not hit or L < 15:
                continue
            if best is None or total < best[0]:
                best = (total, end)
        if not best:
            points.append(None)
            continue
        ex, ey = best[1]
        on_dot = False
        if len(darr):
            dd = np.hypot(darr[:, 0] - ex, darr[:, 1] - ey)
            j = int(dd.argmin())
            if dd[j] < 14:
                ex, ey, on_dot = darr[j][0], darr[j][1], True
        points.append((float(ex), float(ey), on_dot))

    # the dots on the pipe: a ring round each crosses the pipe's heavy line; none near the page's edge
    ringpts = [(int(round(14 * np.cos(t))), int(round(14 * np.sin(t)))) for t in np.deg2rad(np.arange(0, 360, 4))]
    on_pipe = []
    for x, y in dots:
        if not (0.03 * W < x < 0.97 * W and 0.03 * H < y < 0.97 * H):
            continue
        if any(pipe[min(H - 1, max(0, int(y) + dy)), min(W - 1, max(0, int(x) + dx))] for dx, dy in ringpts):
            on_pipe.append((x, y))
    return points, on_pipe, socket_ends(ink, dt, fmask)


# A socket-weld joint with no dot is drawn at the fitting's socket end: a
# filled, blunt block on the pipe (the ends of a socket-weld valve, either side
# of its bow-tie). Measured on the golden sheets (docs/epc-llm/10-weld-points.md):
# the block's inscribed radius is 7 px and more at 300 dpi (a dot's is 6.3 at
# most), it is short and blunt (elongation under 1.95, its smallest enclosing
# triangle half as large again as itself) where a flow arrowhead is long and
# pointed, and the pipe's heavy line runs on from one end only — the other is
# the valve's thin bow-tie — where an arrowhead sits inside a straight run.
SOCKET_DT, SOCKET_ELONG, SOCKET_TRI = 7.0, 1.95, 1.58


def socket_ends(ink, dt, fmask):
    H, W = ink.shape
    op = cv2.morphologyEx(ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    op[fmask > 0] = 0
    n, lab, st, cen = cv2.connectedComponentsWithStats(op, 8)
    heavy = dt >= 2.0
    rr = np.arange(22, 46)
    out = []
    for i in range(1, n):
        x, y, w, h, a = st[i]
        if a < 40 or not (0.03 * W < cen[i][0] < 0.97 * W and 0.03 * H < cen[i][1] < 0.97 * H):
            continue
        sub = lab[y:y + h, x:x + w] == i
        if dt[y:y + h, x:x + w][sub].max() < SOCKET_DT:
            continue
        cnt, _ = cv2.findContours(sub.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        c = max(cnt, key=cv2.contourArea)
        area = max(1.0, cv2.contourArea(c))
        rw, rh = cv2.minAreaRect(c)[1]
        if max(rw, rh) / max(1.0, min(rw, rh)) >= SOCKET_ELONG or cv2.minEnclosingTriangle(c)[0] / area < SOCKET_TRI:
            continue
        # the pipe's direction through the block, and the heavy line on each side of it
        px, py = cen[i]
        best = None
        for th in np.deg2rad(np.arange(0, 180, 3)):
            sides = []
            for sgn in (1, -1):
                xs = (px + sgn * np.cos(th) * rr).astype(int).clip(0, W - 1)
                ys = (py + sgn * np.sin(th) * rr).astype(int).clip(0, H - 1)
                sides.append(float(heavy[ys, xs].mean()))
            if best is None or sum(sides) > sum(best):
                best = sides
        lo, hi = sorted(best)
        if lo <= 0.35 and hi >= 0.7:
            out.append((float(px), float(py)))
    return out


def materials_panel(g):
    H, W = g.shape[:2]
    # the materials panel: between the two rightmost long vertical rules
    # (the drawing frame's edge and the sheet's border) at least a sixth of the
    # sheet apart; with none, the right third of the sheet
    ink = (g < 150).astype(np.uint8) * 255
    vert = cv2.morphologyEx(ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, int(H * 0.4))))
    xs = [(a + b) // 2 for a, b in runs((vert > 0).sum(0) >= H * 0.4)]
    pairs = [(a, b) for a, b in zip(xs, xs[1:]) if b - a >= W / 6 and a > W / 2]
    x0, x1 = (pairs[-1][0] + 4, pairs[-1][1] - 4) if pairs else (int(W * 0.66), W)
    region = g[: int(H * 0.86), x0:x1]
    return region


def panel_edge(g):
    """The x of the rule between the drawing and the materials panel: a rule
    running most of the sheet's height in its right half, or None. A long
    vertical pipe leg (25-1020 SH1's 2150) is not one."""
    H, W = g.shape[:2]
    ink = (g < 150).astype(np.uint8) * 255
    vert = cv2.morphologyEx(ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, int(H * 0.4))))
    xs = [(a + b) // 2 for a, b in runs((vert > 0).sum(0) >= H * 0.7)]
    xs = [x for x in xs if W / 2 < x < W - W / 6]
    return xs[-1] if xs else None


def size_value(t):
    """ "1.1/2" → 1.5, "3/4" → 0.75, "6" → 6."""
    m = re.fullmatch(r"(\d+)(?:\.(\d+)/(\d+))?|(\d+)/(\d+)", t)
    if not m:
        return None
    if m.group(4):
        return int(m.group(4)) / int(m.group(5))
    return int(m.group(1)) + (int(m.group(2)) / int(m.group(3)) if m.group(2) else 0)


def read_cut_lengths(g):
    """The CUT PIPE LENGTH table, when the sheet carries one: one entry per
    piece mark "<n>" with its cut length in mm and its nominal size. The table
    may be printed in two side-by-side halves, each under its own PIECE / CUT /
    N.S. header. A length stands only when its cell, read again several ways
    on its own, says the same (a dropped digit is a wrong length); a size only
    when it is a nominal size. A piece read twice is dropped."""
    region = materials_panel(g)
    words = []
    for line in tess(region, 11, ["tsv"]).splitlines()[1:]:
        f = line.split("\t")
        if len(f) >= 12 and f[11].strip():
            words.append({"t": f[11].strip().upper(), "x": int(f[6]), "y": int(f[7]), "w": int(f[8]), "h": int(f[9])})
    # each half of the table under its header: PIECE with CUT beside it
    heads = sorted((w for w in words if w["t"] == "PIECE" and any(
        v["t"] == "CUT" and abs(v["y"] - w["y"]) < w["h"] and 0 < v["x"] - w["x"] < 150 * S for v in words)), key=lambda w: w["x"])
    out = []
    for k, h in enumerate(heads):
        right = heads[k + 1]["x"] - 10 if k + 1 < len(heads) else region.shape[1]
        row_h = [w for w in words if abs(w["y"] - h["y"]) < h["h"] and h["x"] <= w["x"] < right]
        cut = next((w for w in row_h if w["t"] == "CUT"), None)
        ns = next((w for w in row_h if re.fullmatch(r"N\.?S[.:]?", w["t"])), None)
        if not cut or not ns:
            continue
        rem = next((w for w in row_h if w["t"].startswith("REMARK")), None)
        end_ns = rem["x"] - 10 if rem else right
        for p in (w for w in words if w["y"] > h["y"] + 2 * h["h"] and h["x"] - 20 * S <= w["x"] < cut["x"] - 10 * S):
            m = re.fullmatch(r"[<(\[]?(\d{1,3})[>)\]]?", p["t"])
            if not m:
                continue
            row = [w for w in words if abs((w["y"] + w["h"] / 2) - (p["y"] + p["h"] / 2)) < p["h"] * 0.6 and p["x"] < w["x"] < end_ns]
            ln = [w for w in row if cut["x"] - 40 * S <= w["x"] < ns["x"] - 10 * S]
            sz = [w for w in row if ns["x"] - 20 * S <= w["x"] < end_ns]
            length = None
            if len(ln) == 1 and re.fullmatch(r"\d{2,5}", ln[0]["t"]):
                c = ln[0]
                again = cell_vote(region[max(0, c["y"] - 4):c["y"] + c["h"] + 4, max(0, c["x"] - 6):c["x"] + c["w"] + 6], "0123456789",
                                  lambda o: bool(re.fullmatch(r"\d{2,5}", o)))
                length = int(again) if again == ln[0]["t"] else None
            # the size from its cell read several ways ("1.1/2" read once is "1/2")
            # the row's own line: a taller band takes in the top of the row below ("3" over "3/4" reads 30)
            y0c, y1c = int(p["y"] - 2), int(p["y"] + p["h"] + 2)
            # the size column is as wide as its header and a little more, not the remarks beside it
            again = cell_vote(region[max(0, y0c):y1c, max(0, int(ns["x"] - 15 * S)):int(min(end_ns, ns["x"] + ns["w"] + 22 * S))], "0123456789./",
                              lambda o: o in NPS and o not in ("12", "14", "18", "34", "38"))
            size = again if again and (not sz or len(sz) == 1 and sz[0]["t"] == again) else None
            if length is None:
                continue
            out.append({"piece": int(m.group(1)), "lengthMm": length, "nps": size_value(size) if size else None, "ns": size})
    seen = {}
    for c in out:
        seen.setdefault(c["piece"], []).append(c)
    return [v[0] for k, v in sorted(seen.items()) if len(v) == 1]


def rising(xs):
    """The indices of the longest strictly rising run of xs (not necessarily adjacent), in order."""
    best, prev = [], [None] * len(xs)
    tails = []          # tails[k]: index of the smallest last value of a rising run of length k+1
    for i, x in enumerate(xs):
        k = bisect.bisect_left([xs[j] for j in tails], x)
        prev[i] = tails[k - 1] if k else None
        if k == len(tails):
            tails.append(i)
        else:
            tails[k] = i
    i = tails[-1] if tails else None
    while i is not None:
        best.append(i)
        i = prev[i]
    return best[::-1]


def read_bom(g):
    """The bill of material printed beside the drawing (FABRICATION / ERECTION
    MATERIALS): one row per PT number — its group heading, description, size
    (N.S.), item code and quantity — as the sheet prints them.

    The table is found by its header line (a QTY word and a DESCRIPTION word);
    each word goes to the column whose header it stands under. A row starts at
    a PT number; a line with no PT number continues the description above it,
    unless it is a group heading (PIPE, FITTINGS, …). A size or quantity that
    does not read as one is null; the description and item code are the OCR's
    text, for a person to check."""
    region = materials_panel(g)
    lines = {}
    for line in tess(region, 6, ["tsv"]).splitlines()[1:]:
        f = line.split("\t")
        if len(f) >= 12 and f[11].strip():
            k = (int(f[2]), int(f[3]), int(f[4]))
            lines.setdefault(k, []).append({"t": f[11].strip(), "x": int(f[6]), "y": int(f[7]), "w": int(f[8]), "h": int(f[9])})
    lines = sorted((sorted(ws, key=lambda w: w["x"]) for ws in lines.values()), key=lambda ws: min(w["y"] for w in ws))

    def is_header(ws):
        t = [w["t"].upper() for w in ws]
        return any(re.fullmatch(r"QTY\.?|QUANTITY", x) for x in t) and any("DESCRIPTION" in x for x in t)

    rows, cols, group, row, gap = [], None, None, None, int(14 * S)
    for ws in lines:
        if is_header(ws):
            find = lambda pat: next((w["x"] for w in ws if re.fullmatch(pat, w["t"].upper())), None)
            desc = find(r"COMPONENT|DESCRIPTION")
            ns = find(r"N\.?S\.?|SIZE|NPS|DIA\.?")
            code = find(r"ITEM|CODE|STOCK")
            qty = find(r"QTY\.?|QUANTITY")
            ptx = find(r"PT\.?|ITEM|NO\.?|MK")
            cols = (desc, ns, code, qty) if None not in (desc, ns, code, qty) and desc < ns < code < qty else None
            # words left of the PT column are the drawing's, not the table's
            left = (ptx if ptx is not None and ptx < (desc or 0) else (desc or 0) - int(100 * S)) - int(20 * S)
            row, group = None, None
            continue
        if not cols:
            continue
        desc, ns, code, qty = cols
        ws = [w for w in ws if w["x"] + w["w"] >= left]
        if not ws:
            continue
        text = " ".join(w["t"] for w in ws).upper()
        if re.search(r"CONT\.? ?ON|\*{4}|MATERIALS$", text):
            row = None
            continue
        if re.fullmatch(r"\(?INS\)?|NO\.?", text.replace(" ", "")) or re.fullmatch(r"[\d\s]*\(INS\).*", text):
            continue
        part = {"pt": [], "desc": [], "ns": [], "code": [], "qty": []}
        for w in ws:
            cx = w["x"] + w["w"] / 2
            k = ("pt" if w["x"] + w["w"] < desc - gap / 2 else "desc" if w["x"] < ns - gap else
                 "ns" if w["x"] < code - gap else "code" if w["x"] < qty - gap else "qty")
            part[k].append(w["t"])
        pt = " ".join(part["pt"]).rstrip(".")
        if re.fullmatch(r"\d{1,3}", pt):
            # on a page read at 600 dpi (another style's hairline CAD font) the PT number is read again on
            # its own cell, several ways: a row whose number does not read the same is not trusted (11 read 14)
            ptw = [w for w in ws if w["x"] + w["w"] < desc - gap / 2] if S > 2 else []
            if ptw:
                bx0, by0 = min(w["x"] for w in ptw), min(w["y"] for w in ptw)
                bx1, by1 = max(w["x"] + w["w"] for w in ptw), max(w["y"] + w["h"] for w in ptw)
                again = cell_vote(region[max(0, by0 - 4):by1 + 4, max(0, bx0 - 6):bx1 + 6], "0123456789",
                                  lambda o: bool(re.fullmatch(r"\d{1,3}", o)), scales=(0.5, 0.67))
                if again != pt:
                    row = None
                    continue
            size = bom_size(" ".join(part["ns"]).replace(".x", " x").strip(" ."), " ".join(part["desc"]))
            # 1/2, 1/4, 1/8, 3/4, 3/8 lose their slash as 12, 14, 18, 34, 38: such a size stands only
            # when the cell, read again several ways on its own, says the same
            if size and any(p in ("12", "14", "18", "34", "38") for p in size.split(" x ")):
                nsw = [w for w in ws if ns - gap <= w["x"] < code - gap]
                if nsw:
                    bx0, by0 = min(w["x"] for w in nsw), min(w["y"] for w in nsw)
                    bx1, by1 = max(w["x"] + w["w"] for w in nsw), max(w["y"] + w["h"] for w in nsw)
                    again = cell_vote(region[max(0, by0 - 4):by1 + 4, max(0, bx0 - 6):bx1 + 6], "0123456789/x.",
                                      lambda o: bool(o), key=lambda o: o.replace("x", " x ").replace("  ", " ").strip())
                    if again is None or again.replace(" ", "") != size.replace(" ", ""):
                        size = None
            q = re.fullmatch(r"(\d+(?:\.\d+)?)\s*(M)?", " ".join(part["qty"]).upper())
            row = {"pt": int(pt), "group": group, "description": " ".join(part["desc"]),
                   "diam": size,
                   "stockCode": " ".join(part["code"]) or None,
                   "qty": float(q.group(1)) if q else None, "qtyUnit": ("m" if q.group(2) else "pcs") if q else None}
            rows.append(row)
            continue
        if not part["pt"] and not part["ns"] and not part["code"] and not part["qty"] and BOM_GROUP.fullmatch(" ".join(part["desc"]).upper().strip(" .:,")):
            group, row = " ".join(part["desc"]).upper().strip(" .:,"), None
            continue
        if row and part["desc"] and not part["pt"]:
            row["description"] += " " + " ".join(part["desc"])
    # the PT numbers run down the table in order: a row out of that order is a misread number (the
    # rows kept are the longest run of numbers rising down the table; the others are dropped)
    rows = [rows[i] for i in rising([r["pt"] for r in rows])]
    # one row per PT number, in order; a number read twice is not trusted
    seen = {}
    for r in rows:
        seen.setdefault(r["pt"], []).append(r)
    return [v[0] for k, v in sorted(seen.items()) if len(v) == 1]


# ── a drawing style with no template ──────────────────────────────────────
# A sheet that is not the golden sheets' layout (read_title finds no ISO
# number in its cell) is read by what its title block says rather than where:
# each value is found from its label — a row label and a column heading for a
# value in a grid (PRESS. by DESIGN), a label and the words after it in the
# same cell (TEST FLUID: …), a label above it (CLASS over 1B). The cells are
# the title block's own ruled lines. docs/epc-llm/11-drawing-styles.md.

def is_vector(path, pg):
    """A PDF page drawn as lines (no image on it): it can be rendered as
    finely as its small text needs."""
    if not path.lower().endswith(".pdf"):
        return False
    r = subprocess.run(["pdfimages", "-list", "-f", str(pg), "-l", str(pg), path], capture_output=True, text=True)
    return len([l for l in r.stdout.splitlines()[2:] if l.strip()]) == 0


def text_image(path, pg):
    """The page for reading its text: a vector page at 600 dpi with its
    hairline strokes thickened (tesseract reads a 1 px stroke badly), with
    the scale of its pixels to 200 dpi."""
    return cv2.erode(load_at(path, 600), np.ones((3, 3), np.uint8)), 3.0


class at_scale:
    """The module's 200 dpi sizes (S) at another scale, for a function written for them."""
    def __init__(self, s):
        self.s = s
    def __enter__(self):
        global S
        self.old, S = S, self.s
    def __exit__(self, *a):
        global S
        S = self.old


GRID_FIELDS = [
    # key, row label, column heading, valid value
    ("designPressure", r"PRESS\.?\(?(BARG)?\)?:?|PRESSURE", r"DESIGN", r"\d+(?:\.\d+)?(?:\s*,?\s*FV)?|FV"),
    ("operatingPressure", r"PRESS\.?\(?(BARG)?\)?:?|PRESSURE", r"OP[EK]?R?ATING|OPER\.?", r"\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?"),
    ("designTemp", r"TE[MN][P>]\.?.*|TEMPERATURE", r"DESIGN", r"-?\d+(?:\.\d+)?"),
    ("operatingTemp", r"TE[MN][P>]\.?.*|TEMPERATURE", r"OP[EK]?R?ATING|OPER\.?", r"-?\d+(?:\.\d+)?(?:\s*-\s*-?\d+(?:\.\d+)?)?"),
]
INLINE_FIELDS = [
    # key, label (the words of the label, joined), valid value
    # the label alone, never "any words after it": PRESS.TEST(barg): 11.1 must not take "11." into the label
    ("testPressure", r"(.?RESS\.?\s?TEST|TEST\s?PRESS(URE)?)\s?\(?\s?(BAR[GQ]?\)?)?:?", r"\d+(?:\.\d+)?"),
    ("testFluid", r"(TEST\s*)?FLUID:?", r"(FRESH\s*|SEA\s*|DEMIN\.?\s*)?WATER|AIR|NITROGEN|N2|SERVICE|PNEUMATIC|HYDRO(STATIC)?"),
    ("ndt", r"N[DO0]T:", r"\d{1,3}\s*%\s*[A-Z]{2}(\s*\+\s*\d{1,3}\s*%\s*[A-Z]{2})*|[A-Z]|-"),
    ("pwht", r"PWHT:?", r"YES|NO|N|Y|N/?A|-"),
    ("paint", r"PAINT(\s*CODE)?:?", r"[A-Z]{1,3}-?\d{1,3}|NONE|N/?A|-"),
    ("insulationType", r"INSULATION\s*TYPE:?|INS\.?\s*TYPE:?", r"[A-Z]{1,4}|NONE|N/?A|-"),
    ("insulationThk", r"INSULATION\s*THK\.?:?|INS\.?\s*THK\.?:?", r"\d{1,3}|-"),
]
LINE_NO = re.compile(r"(\d{1,2}(?:\.\d/\d)?)[\"”']{1,2}-?([A-Z]{2,5}-[0-9A-Z]{1,8}(?:-[0-9A-Z]{1,8}){1,5})")


def read_title_generic(T, s):
    """The title block's line data of a sheet in a style with no template,
    read off T (the page as text_image gives it, s its pixels' scale to 200
    dpi). Keys as read_title's and read_line_data's; a value not read for
    certain is None."""
    H, W = T.shape[:2]
    y0 = int(H * 0.80)
    strip = T[y0:, :]
    ink = (strip < 150).astype(np.uint8) * 255
    hl = cv2.morphologyEx(ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (int(60 * s), 1)))
    vl = cv2.morphologyEx(ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, int(25 * s))))
    clean = 255 - cv2.subtract(ink, cv2.dilate(hl | vl, np.ones((3, 3), np.uint8)))
    Hs, Ws = strip.shape[:2]
    # the words, to find the labels by: read at two sizes, as each misses some small labels the
    # other finds (REV. of the revision table at the one, LINE at the other)
    words = []
    for k in ((1.0, 0.5) if s > 2 else (1.0,)):
        im = clean if k == 1 else cv2.resize(clean, None, fx=k, fy=k, interpolation=cv2.INTER_AREA)
        for line in tess(im, 11, ["tsv"]).splitlines()[1:]:
            f = line.split("\t")
            if len(f) >= 12 and f[11].strip():
                w = {"t": f[11].strip().upper(), "x": int(int(f[6]) / k), "y": int(int(f[7]) / k), "w": int(int(f[8]) / k), "h": int(int(f[9]) / k)}
                # the same word read alike at both sizes is kept once; read otherwise, both readings stay
                if not any(abs(v["x"] - w["x"]) < w["h"] and abs(v["y"] - w["y"]) < w["h"] and v["t"] == w["t"] for v in words):
                    words.append(w)

    def cell_of(w):
        cx, cy = w["x"] + w["w"] // 2, w["y"] + w["h"] // 2
        row = vl[max(0, cy - 2):cy + 3, :].max(0) > 0
        col = hl[:, max(0, cx - 2):cx + 3].max(1) > 0
        left = next((x for x in range(w["x"] - 2, -1, -1) if row[x]), 0)
        right = next((x for x in range(w["x"] + w["w"] + 2, Ws) if row[x]), Ws)
        top = next((y for y in range(cy, -1, -1) if col[y]), 0)
        bottom = next((y for y in range(cy, Hs) if col[y]), Hs)
        return left, right, top, bottom

    def inside(v, box):
        l, r, t, b = box
        cx, cy = v["x"] + v["w"] / 2, v["y"] + v["h"] / 2
        return l <= cx <= r and t <= cy <= b

    # a value is read from its own cell, several ways, and kept when they agree: the strip read whole
    # misreads this kind of single-stroke lettering (7.4 as 7A, 2.3 as 7.3), a cell read alone does not
    sc = (0.5, 0.67) if s > 2 else (3, 4)

    def vote(box, white, ok, key=lambda o: o, spaces=False, lead=False):
        l, r, t, b = box
        # read off the strokes as drawn: taking the ruled lines away nibbles a decimal point (7.4 read 74)
        crop = strip[max(0, t + 4):b - 3, max(0, l + 4):r - 3]
        if crop.size == 0 or crop.shape[0] < 12 or crop.shape[1] < 12:
            return None
        if lead:
            # the rest of a label (".:" after THK) left at the value's start: dots, small and round, before the first other mark
            n, _, st, _ = cv2.connectedComponentsWithStats((crop < 150).astype(np.uint8), 8)
            marks = sorted(st[1:].tolist())
            if not marks:
                return None
            th = max(m[3] for m in marks)      # the height of the lettering: a dot is small beside it, a "1" is not
            x = 0
            for mx, my, mw, mh, _a in marks:
                if mh < 0.4 * th and mw < 0.4 * th and mw < 2 * mh:
                    x = mx + mw + 2
                else:
                    break
            crop = crop[:, x:]
            if crop.shape[1] < 12:
                return None
        return cell_vote(crop, white, lambda o: bool(re.fullmatch(ok, o)), key=key, scales=sc, spaces=spaces)

    out = {"drawingNo": None, "sheet": None, "rev": None}
    line = {k: None for k, *_ in GRID_FIELDS + INLINE_FIELDS}
    line.update({"lineClass": None, "lineNo": None})
    num = "0123456789.-"

    # a value in a grid: the cell in its row label's row and its column heading's column
    for key, rlab, clab, ok in GRID_FIELDS:
        for R in (w for w in words if re.fullmatch(rlab, w["t"])):
            rc = cell_of(R)
            for C in (w for w in words if re.fullmatch(clab, w["t"]) and w["y"] < R["y"] - R["h"]):
                cc = cell_of(C)
                box = (cc[0], cc[1], rc[2], rc[3])
                if box[0] <= rc[1]:
                    continue        # the column is the row label's own cell
                got = vote(box, num + "FV,", ok.replace(r"\s*", ""))
                if got:
                    line[key] = got
                    break
            if line[key]:
                break

    # a label and the words after it in its cell
    for key, lab, ok in INLINE_FIELDS:
        for k, L in enumerate(words):
            # the label's words: it and the next words to its right on its line, each close to the last
            # (every reading of them: a word read two ways at the two sizes gives two groups)
            def groups(g, n):
                if len(g) == n:
                    yield g
                    return
                last = g[-1]
                for w in words:
                    if abs(w["y"] - L["y"]) < L["h"] and last["x"] + last["w"] - 4 <= w["x"] <= last["x"] + last["w"] + 2 * L["h"]:
                        yield from groups(g + [w], n)
            for group in (g for n in (3, 2, 1) for g in groups([L], n)):   # the longest label first: PAINT CODE:, not PAINT
                if re.fullmatch(lab, " ".join(g["t"] for g in group)):
                    end = group[-1]
                    l, r, t, b = cell_of(end)
                    # the value: the rest of the label's line in its cell
                    vb = (end["x"] + end["w"] + 2, r, max(t, end["y"] - end["h"] // 2), min(b, end["y"] + end["h"] + end["h"] // 2))
                    white = (num + "%+RTMUPACB ") if key in ("testPressure", "ndt", "insulationThk") else "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/ "
                    text_field = key in ("testFluid", "paint", "insulationType", "pwht")
                    got = vote(vb, white, ok.replace(r"\s*", r"\s?") if text_field else ok.replace(r"\s*", ""), spaces=text_field, lead=True)
                    if got:
                        line[key] = got
                        break
            if line[key]:
                break

    # labels over their value: CLASS, SHT. NO., REV — in the cells of the line number's row
    def below(lab, white, ok, key=lambda o: o):
        # the value under its label: in the same cell, or in the cell under it when the label has a row of its own
        for L in (w for w in words if re.fullmatch(lab, w["t"])):
            l, r, t, b = cell_of(L)
            boxes = [(l, r, L["y"] + L["h"] + 2, b)]
            col = hl[:, max(0, L["x"] + L["w"] // 2 - 2):L["x"] + L["w"] // 2 + 3].max(1) > 0
            nxt = next((y for y in range(b + 4, Hs) if col[y]), None)
            if nxt:
                boxes.append((l, r, b, nxt))
            for box in boxes:
                got = vote(box, white, ok, key=key)
                if got:
                    return got
        return None
    line["lineClass"] = below(r"CLASS:?|CLASS\.?", "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ", r"\d[A-Z]\d?|[A-Z]\d[A-Z]?\d?")
    # the drawing's own number: under a DOCUMENT No. / DWG. No. label, a code of four parts or more (AISPC-10-DE-930-PI-ISO-0001)
    # (its part ISO is read 1S0 or IS0 as on the golden sheets: that part is the word ISO)
    out["drawingNo"] = below(r"DOCUMENT|DWG\.?|DRAWING", "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-", r"[A-Z0-9]{2,8}(-[A-Z0-9]{1,8}){3,8}",
                             key=lambda o: "-".join("ISO" if re.fullmatch(r"[1I][S5][O0]", p) else p for p in o.split("-")))
    sheet = below(r"SHT\.?(NO\.?)?:?|SHEET:?", "0123456789OF/", r"\d{1,2}(OF|/)\d{1,2}")
    if sheet:
        a, b_ = re.split(r"OF|/", sheet)
        if 0 < int(a) <= int(b_):
            out["sheet"] = f"{int(a)}/{int(b_)}"
    # the revision: the revision table's topmost written row, in the column over its REV. heading,
    # and only with a date printed in that row's DATE column (a revision written in by hand is not read)
    for R in (w for w in words if re.fullmatch(r"REV\.?", w["t"])):
        D = next((w for w in words if re.fullmatch(r"DATE", w["t"]) and abs(w["y"] - R["y"]) < R["h"] and 0 < w["x"] - R["x"] < 600 * s / 3), None)
        if not D:
            continue
        rl, rr, rt, rb = cell_of(R)
        dl, dr, _, _ = cell_of(D)
        colm = hl[:, max(0, R["x"] + R["w"] // 2 - 2):R["x"] + R["w"] // 2 + 3].max(1) > 0
        ys = [y for y in range(rt - 2, 0, -1) if colm[y] and not colm[y - 1]]   # the rules above, nearest first
        rows = [(ys[i + 1], ys[i]) for i in range(len(ys) - 1)]
        written = [(a, b_) for a, b_ in rows if b_ - a > 20 and (strip[a + 6:b_ - 5, rl + 6:rr - 5] < 150).any()]
        if written:
            a, b_ = written[-1]           # the topmost
            # a revision is a letter and a number (A0, B1) or either alone: an O after the letter is the number's 0
            rev = vote((rl, rr, a, b_), "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ", r"[A-Z]?[0-9O]{1,2}|[A-Z]",
                       key=lambda o: o[0] + o[1:].replace("O", "0") if o[:1].isalpha() else o.replace("O", "0"))
            date = vote((dl, dr, a, b_), "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ/.-", r"\d{1,2}[./-]?([A-Z]{3}|\d{1,2})[./-]?\d{2,4}")
            if rev and date:
                out["rev"] = rev
        break

    # the line number: the cell labelled LINE No., read several ways; it must read as a line number
    for L in (w for w in words if re.fullmatch(r"LINE", w["t"])):
        l, r, t, b = cell_of(L)
        # the number is printed large and may run on past its cell's border (25-CWR …-UCW into REV):
        # its own band of ink, from the label's right to where the ink of that band ends
        # after the label's own words (LINE No.:), small and on its first line
        lab_end = max([w["x"] + w["w"] for w in words if abs(w["y"] - L["y"]) < L["h"] and L["x"] <= w["x"] < L["x"] + 250 * s / 3 * 2
                       and re.fullmatch(r"LINE|N[O0]\.?:?|NUMBER:?|LINE\s*N[O0]\.?:?", w["t"])] + [L["x"] + L["w"]])
        band = strip[max(0, t + 4):b - 3, :]
        ink = (band < 150).astype(np.uint8)
        ink[:, :lab_end + 4] = 0
        ink[vl[max(0, t + 4):b - 3, :] > 0] = 0
        n, lab, st, _ = cv2.connectedComponentsWithStats(ink, 8)
        if n < 2:
            continue
        # the number is the band's large lettering: its glyphs, and its dashes (flat, at mid height),
        # not the small words of cells it runs over
        hbig = np.percentile(st[1:, 3], 90)
        tall = [i for i in range(1, n) if 0.6 * hbig <= st[i, 3]]
        if not tall:
            continue
        top = min(st[i, 1] for i in tall)
        bot = max([st[i, 1] + st[i, 3] for i in tall if st[i, 3] <= 1.3 * hbig] + [top + hbig])
        keep = np.zeros_like(ink)
        glyphs = []
        for i in range(1, n):
            x, y, w_, h_, a = st[i]
            if 0.6 * hbig <= h_ or (h_ <= 0.15 * hbig and 0.3 * hbig <= w_ <= hbig and top < y < bot):
                keep[lab == i] = 1
                glyphs.append((x, x + w_, h_))
        glyphs.sort()
        # the number's own run: from the first glyph, until a gap wider than two letters
        run = [glyphs[0]]
        for g_ in glyphs[1:]:
            if g_[0] - run[-1][1] > 2 * hbig:
                break
            run.append(g_)
        # printed over another cell's words (UCW over "REV: A0") its readings disagree or do not read
        # as a line number: unknown (a guard on the glyphs' height was tried: it changed nothing)
        x0c, x1 = run[0][0], run[-1][1]
        crop = 255 - keep[:, max(0, x0c - 6):x1 + 6] * 255
        crop = crop.astype(np.uint8)
        got = cell_vote(crop, "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-.\"/", lambda o: bool(LINE_NO.fullmatch(o)),
                        key=lambda o: '%s"-%s' % LINE_NO.fullmatch(o).groups(), scales=sc)
        if got:
            line["lineNo"] = got
            break
    out["line"] = line
    return out


def read_title(g):
    """The title block: isometric number, sheet "n/m" and revision. Each is
    found by where it is printed — the cell right of the isometric number for
    the sheet, the column above the REV. header for the revision — and read
    on its own; what is not read for certain is None, never a near guess.

      drawing  the "ISO-aa-nnnn" cell, located by a loose match of the page's
               words (OCR prints ISO as 1S0, TSO, 180) and read again on its
               own for the digits; the file label at the sheet's corner,
               "(ISO-aa-nnnn)/<line>", must agree when it is read.
      sheet    the next cell to the right, "n/m" with n <= m.
      rev      the topmost written row of the revision column. A row written
               by hand above the printed ones is the current revision and is
               not read: the row's date must be a printed dd.mm.yyyy, or the
               revision is unknown (25-1001's "0A" is handwritten).
    """
    H = g.shape[0]
    strip = g[int(H * 0.82):, :]
    ink = (strip < 150).astype(np.uint8) * 255
    vert = cv2.morphologyEx(ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, int(25 * S))))
    horz = cv2.morphologyEx(ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (int(60 * S), 1)))

    def vlines(y0, y1, x0, x1):
        x0, x1 = max(0, x0), min(strip.shape[1], x1)
        return [(x0 + a, x0 + b) for a, b in runs((vert[y0:y1, x0:x1] > 0).sum(0) >= (y1 - y0) * 0.8)]

    def hlines(x0, x1, y0, y1):
        y0 = max(0, y0)
        return [(y0 + a, y0 + b) for a, b in runs((horz[y0:y1, x0:x1] > 0).sum(1) >= (x1 - x0) * 0.8)]

    words = []
    for line in tess(strip, 11, ["tsv"]).splitlines()[1:]:
        f = line.split("\t")
        if len(f) >= 12 and f[11].strip():
            words.append({"t": f[11].strip().upper(), "x": int(f[6]), "y": int(f[7]), "w": int(f[8]), "h": int(f[9])})

    loose = re.compile(r"^(?:[ITL1|][S5][O0Q]{1,2}|1?8?0)-(\d{2})-(\d{3,5})$")
    cell_no, label, label_word = None, None, None
    for w in words:
        is_label = w["t"].lstrip("{[").startswith("(")
        m = loose.match(re.sub(r"^[{\[]*\(|\).*$", "", w["t"]))
        if not m:
            continue
        if is_label:
            if label is None:
                label = f"ISO-{m.group(1)}-{m.group(2)}"
                label_word = w
        elif cell_no is None:
            cell_no = w
    out = {"drawingNo": None, "sheet": None, "rev": None}
    if cell_no:
        x, y, w, h = cell_no["x"], cell_no["y"], cell_no["w"], cell_no["h"]
        num = re.compile(r"^[I1T]?[S5]?[O0]{0,2}-?(\d{2}-\d{3,5})$")
        digits = cell_vote(strip[y - 4:y + h + 4, max(0, x - 6):x + w + 6], "ISO-0123456789",
                           lambda o: num.match(o), key=lambda o: num.match(o).group(1))
        if digits and (label is None or label == f"ISO-{digits}"):
            out["drawingNo"] = f"ISO-{digits}"
        borders = vlines(y - 4, y + h + 4, x + w, x + w + int(400 * S))
        if len(borders) >= 2:
            def sheet_ok(o):
                m = re.fullmatch(r"(\d{1,2})/(\d{1,2})", o)
                return m and 0 < int(m.group(1)) <= int(m.group(2))
            # the value's own line only: the "SHT NO." header above it spoils the read
            s = cell_vote(strip[y - 3:y + h + 3, borders[0][1] + 3:borders[1][0] - 2], "0123456789/", sheet_ok)
            if s:
                a, b = s.split("/")
                out["sheet"] = f"{int(a)}/{int(b)}"

    col = None
    rev_hdr = [w for w in words if re.fullmatch(r"REV\.?", w["t"])]
    date_hdr = [w for w in words if w["t"] == "DATE"]
    if rev_hdr:
        R = rev_hdr[0]
        bs = vlines(R["y"], R["y"] + R["h"], R["x"] - int(60 * S), R["x"] + R["w"] + int(60 * S))
        left = [b for b in bs if b[1] < R["x"]]
        right = [b for b in bs if b[0] > R["x"] + R["w"]]
        if left and right:
            col = (left[-1][1] + 3, right[0][0] - 2, R["y"])
    elif date_hdr:
        # no REV. read: the revision column is the cell left of the lowest DATE header
        D = max(date_hdr, key=lambda w: w["y"])
        bs = vlines(D["y"], D["y"] + D["h"], D["x"] - int(160 * S), D["x"])
        if len(bs) >= 2:
            col = (bs[-2][1] + 3, bs[-1][0] - 2, D["y"])
    if col:
        xl, xr, top = col
        hl = hlines(xl, xr, top - int(900 * S), top)
        rows = [(hl[i][1] + 2, hl[i + 1][0] - 1) for i in range(len(hl) - 1)]

        def written(r):
            # a character-sized blob, not a stub of a rule
            n, _, st, _ = cv2.connectedComponentsWithStats(ink[r[0] + 1:r[1] - 1, xl + 2:xr - 2])
            return any(6 * S <= st[i][3] <= max(8 * S, (r[1] - r[0]) * 0.9) and st[i][2] <= st[i][3] * 2 for i in range(1, n))
        filled = [r for r in rows if r[1] - r[0] > 12 * S and written(r)]
        if filled:
            r = filled[0]
            rev = cell_vote(strip[r[0]:r[1], xl:xr], "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ",
                            lambda o: re.fullmatch(r"\d{1,2}[A-Z]?|[A-Z]\d?", o))
            nxt = vlines(r[0] + 2, r[1] - 2, xr + 6, xr + int(260 * S))
            date = rev and nxt and cell_vote(strip[r[0]:r[1], xr + 5:nxt[0][0] - 2], "0123456789.",
                                             lambda o: re.fullmatch(r"\d{2}\.\d{2}\.\d{4}", o))
            if date:
                out["rev"] = rev
    out["line"] = read_line_data(strip, words, vert, horz, label_word)
    return out


def main():
    g0 = load(src)
    # Which way up: the turn in which the most frames hold a weld number.
    # Tesseract's orientation pass was tried first and is not used: on the
    # golden set it turned 18 upright sheets over (an upside-down "16" reads
    # "91"). The page as rendered (its PDF /Rotate applied) wins a tie.
    best = None
    for rot in (0, 180, 90, 270):
        turn = {0: None, 90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}[rot]
        g = cv2.rotate(g0, turn) if turn is not None else g0
        marks, rejected, tables = detect(g)
        if best is None or len(marks) > len(best[1]):
            best = (g, marks, rejected, tables, rot)
    g, marks, rejected, tables, rot = best
    for m, lab in zip(marks, read_labels(g, marks)):
        m["label"] = lab
    tags = detect_tags(g, tables)
    marks = [{k: m[k] for k in ("no", "shape", "outline", "label", "box")} for m in marks]
    # one marker per number and place: a number read twice at one spot is one marker
    seen, out = set(), []
    for m in sorted(marks, key=lambda m: (m["box"][1], m["box"][0])):
        k = (m["no"], m["box"][0] // 20, m["box"][1] // 20)
        if k not in seen:
            seen.add(k)
            out.append(m)
    # where each marker sits on the page as rendered (before the turn above), as
    # fractions of its width and height: the reviewer's drawing is that page
    H0, W0 = g0.shape[:2]

    def page_at(b):
        x, y = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
        if rot == 180:
            x, y = W0 - x, H0 - y
        elif rot == 90:      # turned clockwise: x' = H0 - y, y' = x
            x, y = y, H0 - x
        elif rot == 270:     # turned counter-clockwise: x' = y, y' = W0 - x
            x, y = W0 - y, x
        return [round(x / W0, 4), round(y / H0, 4)]
    for m in out:
        m["at"] = page_at(m["box"])
    tags_out = sorted(({"kind": t["kind"], "no": t["no"], "at": page_at(t["box"])} for t in tags), key=lambda t: (t["kind"], t["no"]))
    # where each weld is on the pipe, on the page rendered again at 300 dpi (a PDF; an image as it is)
    K = 300 / dpi if src.lower().endswith(".pdf") else 1.0
    g3 = load_at(src, 300) if K != 1.0 else g0
    turn = {0: None, 90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}[rot]
    if turn is not None:
        g3 = cv2.rotate(g3, turn)
    up = lambda b: [int(v * K) for v in b]
    edge = panel_edge(g)
    avoid = [up(t["box"]) for t in tags] + [up(t) for t in tables]
    Hg, Wg = g.shape[:2]
    avoid.append(up((0, int(Hg * 0.82), Wg, Hg)))                       # the title block
    if edge is not None:
        avoid.append(up((edge - 6, 0, Wg, Hg)))                         # the materials panel
    pts, dots, sockets = weld_points(g3, [up(m["box"]) for m in out], avoid)
    for m, p in zip(out, pts):
        if p:
            # as the marker's `at`: a fraction of the page as rendered
            x, y = p[0] / K, p[1] / K
            m["weldAt"] = page_at([x, y, x, y])
            m["weldDot"] = p[2]
    dots_out = [page_at([x / K, y / K, x / K, y / K]) for x, y in dots]
    sockets_out = [page_at([x / K, y / K, x / K, y / K]) for x, y in sockets]
    if debug:
        dbg = cv2.cvtColor(g, cv2.COLOR_GRAY2BGR)
        for t in tables:
            cv2.rectangle(dbg, t[:2], t[2:], (200, 200, 0), 2)
        for m in out:
            b = m["box"]
            cv2.rectangle(dbg, (b[0], b[1]), (b[2], b[3]), (0, 0, 255) if m["shape"] == "square" else (0, 160, 0), 3)
            cv2.putText(dbg, m["no"] + (" " + m["label"] if m["label"] else ""), (b[2] + 4, b[1] + 20), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 0, 0), 2)
        cv2.imwrite(debug, dbg)
    meta = read_title(g)
    line = meta.pop("line", {})
    bom, cuts, style = None, None, "golden"
    # a sheet in another drawing style: the golden sheets' title block is not there (no ISO number in
    # its cell, hardly a line-data value beside its labels) — its title block is read by its labels,
    # and a vector page's text at 600 dpi (the golden layout's 200 dpi blurs a hairline CAD font)
    if not meta.get("drawingNo") and sum(1 for v in line.values() if v) < 3:
        style = "generic"
        vec = is_vector(src, page)
        T, s = text_image(src, page) if vec else (g0, S)
        if turn is not None:
            T = cv2.rotate(T, turn)
        gen = read_title_generic(T, s)
        line = gen.pop("line")
        meta = gen
        with at_scale(s):
            bom, cuts = read_bom(T), read_cut_lengths(T)
    if bom is None:
        bom, cuts = read_bom(g), read_cut_lengths(g)
    print(json.dumps({"orientation": rot, "aspect": round(W0 / H0, 4), "style": style, "meta": meta, "lineData": line, "bom": bom, "cutLengths": cuts, "weldDots": dots_out, "socketEnds": sockets_out, "marks": out, "tags": tags_out, "rejected": rejected}))


if __name__ == "__main__":
    main()
