"""What an isometric sheet prints at each weld marker — read without a model.

    python3 -I tools/iso-read.py <sheet.pdf|.png|.jpg> [--page 1] [--dpi 200] [--debug out.png]

Prints one JSON object: { "orientation", "meta": {drawingNo, sheet, rev},
"marks": [ {no, shape, outline, label, box, at} ], "rejected": [...] }. `meta` is
the title block (read_title; any part not read for certain is null); `box`
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
which excludes them, but they are not reported either. Sizes, branches and
spools are not read here.
"""
import sys, json, subprocess, tempfile, os, re
import numpy as np, cv2

args = sys.argv[1:]
src = args[0]
dpi = int(args[args.index("--dpi") + 1]) if "--dpi" in args else 200
page = int(args[args.index("--page") + 1]) if "--page" in args else 1
debug = args[args.index("--debug") + 1] if "--debug" in args else None
S = dpi / 200.0                     # every size below is for 200 dpi


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


def cell_vote(cell, whitelist, valid, key=lambda o: o):
    """One line of a title-block cell read four ways (grey and two-level, 3x
    and 4x, white margin round it). An answer only when every reading that
    fits the pattern says the same thing; none, or two that disagree, is
    unknown."""
    outs = []
    for k in (3, 4):
        big = cv2.resize(cell, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
        _, bw = cv2.threshold(big, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        for im in (big, bw):
            im = cv2.copyMakeBorder(im, 30, 30, 30, 30, cv2.BORDER_CONSTANT, value=255)
            outs.append(tess(im, 7, ["-c", f"tessedit_char_whitelist={whitelist}"]).strip().replace(" ", ""))
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
    cell_no, label = None, None
    for w in words:
        is_label = w["t"].lstrip("{[").startswith("(")
        m = loose.match(re.sub(r"^[{\[]*\(|\).*$", "", w["t"]))
        if not m:
            continue
        if is_label:
            label = label or f"ISO-{m.group(1)}-{m.group(2)}"
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
    if debug:
        dbg = cv2.cvtColor(g, cv2.COLOR_GRAY2BGR)
        for t in tables:
            cv2.rectangle(dbg, t[:2], t[2:], (200, 200, 0), 2)
        for m in out:
            b = m["box"]
            cv2.rectangle(dbg, (b[0], b[1]), (b[2], b[3]), (0, 0, 255) if m["shape"] == "square" else (0, 160, 0), 3)
            cv2.putText(dbg, m["no"] + (" " + m["label"] if m["label"] else ""), (b[2] + 4, b[1] + 20), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 0, 0), 2)
        cv2.imwrite(debug, dbg)
    print(json.dumps({"orientation": rot, "meta": read_title(g), "marks": out, "tags": tags_out, "rejected": rejected}))


main()
