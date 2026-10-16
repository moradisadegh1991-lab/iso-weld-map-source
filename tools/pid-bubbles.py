"""Instrument bubbles: circles in the sheet's vector data, each read on its own.

    python3 -I tools/pid-bubbles.py <set.pdf> <out dir> all|3,4,5

Writes <out dir>/bNNN.json: each circle's centre and radius, and the text
lines read inside it, top to bottom.

Why not the page OCR: a bubble's number runs into its circle, and read off
the page the circle's arc eats a digit — 110927 comes back as 10927, a
different, valid-looking tag. Here the circle is found in the drawing's own
geometry (arcs fitted and grouped by centre and radius, straight segments on
the same circle counted too), and only the strokes inside it — the letters
and digits, never the circle — are redrawn on a blank page and read.
"""
import sys, json, math, re, pymupdf, numpy as np, time
from rapidocr_onnxruntime import RapidOCR

def _circum(p, q, r):
    ax, ay, bx, by, cx, cy = p.x, p.y, q.x, q.y, r.x, r.y
    d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if abs(d) < 1e-9:
        return None
    ux = ((ax*ax + ay*ay) * (by - cy) + (bx*bx + by*by) * (cy - ay) + (cx*cx + cy*cy) * (ay - by)) / d
    uy = ((ax*ax + ay*ay) * (cx - bx) + (bx*bx + by*by) * (ax - cx) + (cx*cx + cy*cy) * (bx - ax)) / d
    return ux, uy, math.hypot(ax - ux, ay - uy)

def circles(pg):
    """Every circle drawn on the sheet, however it was split into arcs.

    Each Bezier arc gets the circle through its ends and middle; arcs that
    agree on centre and radius are one circle, kept when together they sweep
    most of the way round.
    """
    M = pg.rotation_matrix
    arcs = []
    for p in pg.get_drawings():
        for it in p["items"]:
            if it[0] != "c":
                continue
            a, b, c, e = (pymupdf.Point(q) * M for q in it[1:5])
            bez = lambda t: a * ((1-t) ** 3) + b * (3 * (1-t) ** 2 * t) + c * (3 * (1-t) * t * t) + e * (t ** 3)
            f = _circum(bez(0), bez(0.5), bez(1))
            if not f or not (3 < f[2] < 25):
                continue
            # does the arc really lie on that circle (not an S-curve)?
            if abs(math.hypot(bez(0.25).x - f[0], bez(0.25).y - f[1]) - f[2]) > 0.08 * f[2]:
                continue
            ang = lambda P: math.atan2(P.y - f[1], P.x - f[0])
            span = 0.0
            for t0, t1 in ((0, 0.25), (0.25, 0.5), (0.5, 0.75), (0.75, 1)):
                dd = ang(bez(t1)) - ang(bez(t0))
                dd = (dd + math.pi) % (2 * math.pi) - math.pi
                span += abs(dd)
            # straight segments of the same path that lie on this circle are
            # part of it too (some bubbles are drawn half as a polyline)
            for jt in p["items"]:
                if jt[0] != "l":
                    continue
                q0, q1 = pymupdf.Point(jt[1]) * M, pymupdf.Point(jt[2]) * M
                if all(abs(math.hypot(q.x - f[0], q.y - f[1]) - f[2]) < 0.07 * f[2] for q in (q0, q1)):
                    dd = (ang(q1) - ang(q0) + math.pi) % (2 * math.pi) - math.pi
                    span += abs(dd)
            arcs.append((f[0], f[1], f[2], span))
    groups = []
    for x, y, r, sp in arcs:
        for g in groups:
            if math.hypot(x - g[0], y - g[1]) < 0.15 * r and abs(r - g[2]) < 0.12 * r:
                g[3] += sp; g[4] += 1
                break
        else:
            groups.append([x, y, r, sp, 1])
    return [(x, y, r) for x, y, r, sp, n in groups if sp > 1.1 * math.pi]

def paths(pg):
    M = pg.rotation_matrix
    out = []
    for p in pg.get_drawings():
        r = p["rect"] * M
        out.append((r, p, M))
    return out

def strokes_inside(allp, x, y, r):
    """The text strokes in a bubble: small paths wholly inside its circle."""
    box = pymupdf.Rect(x - r, y - r, x + r, y + r)
    keep = []
    for rr, p, M in allp:
        if not box.contains(rr) or max(rr.width, rr.height) > 1.1 * r:
            continue
        if any(it[0] == "c" for it in p["items"]) and max(rr.width, rr.height) > 0.6 * r:
            continue
        keep.append((p, M))
    return keep

def render(keep, x, y, r, dpi=600, width=0.35):
    doc = pymupdf.open(); page = doc.new_page(width=2 * r + 4, height=2 * r + 4)
    sh = page.new_shape(); off = pymupdf.Point(x - r - 2, y - r - 2)
    for p, M in keep:
        for it in p["items"]:
            q = [pymupdf.Point(v) * M - off for v in it[1:] if isinstance(v, pymupdf.Point)]
            if it[0] == "l": sh.draw_line(q[0], q[1])
            elif it[0] == "c": sh.draw_bezier(*q)
        sh.finish(color=(0, 0, 0), width=width, closePath=False)
    sh.commit()
    pm = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY)
    img = np.frombuffer(pm.samples, dtype=np.uint8).reshape(pm.height, pm.width)
    img = np.pad(img, 30, constant_values=255)
    return np.stack([img] * 3, axis=-1)

LETTERS = re.compile(r"^[A-Z]{1,5}$")

def weak(lines):
    """A reading worth a second look: no letters line, or one that is not
    plain capitals, or read with low confidence."""
    if len(lines) < 2:
        return True
    t, c = lines[0][1].replace(" ", ""), lines[0][2]
    return not LETTERS.match(t) or c < 0.9

def read_bubble(eng, keep, x, y, r, scale):
    """Read a bubble; when the first reading is weak, read it again at other
    sizes and stroke widths and keep the most confident plain reading."""
    best = None
    for dpi, width in ((600, 0.35), (450, 0.45), (800, 0.3), (350, 0.5)):
        rr, _ = eng(render(keep, x, y, r, dpi=int(dpi / scale), width=width))
        lines = sorted([(min(p[1] for p in b), txt, float(c)) for b, txt, c in (rr or [])])
        score = (0 if weak(lines) else 1, sum(c for _, _, c in lines) / max(len(lines), 1))
        if best is None or score > best[0]:
            best = (score, lines)
        if not weak(lines):
            break
    return best[1]

def main():
    pdf, outdir = sys.argv[1], sys.argv[2]
    eng = RapidOCR(intra_op_num_threads=1, inter_op_num_threads=1)
    d = pymupdf.open(pdf)
    pages = range(d.page_count) if sys.argv[3] == "all" else [int(x) for x in sys.argv[3].split(",")]
    for i in pages:
        t0 = time.time(); pg = d[i]
        scale = pg.rect.width / 1191
        allp = paths(pg)
        res = []
        for (x, y, r) in circles(pg):
            if r < 5 * scale or r > 16 * scale:
                continue
            keep = strokes_inside(allp, x, y, r)
            if not keep:
                res.append({"x": round(x, 1), "y": round(y, 1), "r": round(r, 2), "lines": []}); continue
            lines = read_bubble(eng, keep, x, y, r, scale)
            res.append({"x": round(x, 1), "y": round(y, 1), "r": round(r, 2),
                        "lines": [[t, round(c, 3)] for _, t, c in lines]})
        json.dump({"page": i, "w": pg.rect.width, "h": pg.rect.height, "bubbles": res}, open(f"{outdir}/b{i:03d}.json", "w"))
        print(i, len(res), f"{time.time() - t0:.1f}s", flush=True)

main()
