"""Page text of a P&ID set whose CAD text was exploded into strokes.

    pip install rapidocr_onnxruntime pymupdf
    python3 -I tools/pid-ocr.py <set.pdf> <out dir> all|3,4,5 [dpi=200]

Each page is read in six overlapping tiles (small text survives the
detector's resize) and written as <out dir>/pNNN.json: every string with
its confidence and box in page points. The strings are what the OCR saw —
lib/pid/ocr-parse.mjs reads them; nothing here interprets.

One thread per process: run one process per core, each on its own pages.
The engine's default takes every core in every process, and four processes
then run slower than one.
"""
import sys, json, pymupdf, numpy as np, time
from rapidocr_onnxruntime import RapidOCR
pdf, out = sys.argv[1], sys.argv[2]
dpi = int(sys.argv[4]) if len(sys.argv) > 4 else 200
eng = RapidOCR(intra_op_num_threads=1, inter_op_num_threads=1)
d = pymupdf.open(pdf)
pages = range(d.page_count) if sys.argv[3] == 'all' else [int(x) for x in sys.argv[3].split(',')]
for i in pages:
    t = time.time(); pg = d[i]
    # tile the page so small text survives the detector's resize
    W, H = pg.rect.width, pg.rect.height
    nx, ny = 3, 2; ov = 0.04
    res = []
    for ix in range(nx):
        for iy in range(ny):
            x0 = max(0, W*(ix/nx - ov)); x1 = min(W, W*((ix+1)/nx + ov))
            y0 = max(0, H*(iy/ny - ov)); y1 = min(H, H*((iy+1)/ny + ov))
            pm = pg.get_pixmap(dpi=dpi, clip=pymupdf.Rect(x0, y0, x1, y1), colorspace=pymupdf.csRGB)
            img = np.frombuffer(pm.samples, dtype=np.uint8).reshape(pm.height, pm.width, 3)
            r, _ = eng(img)
            s = 72 / dpi
            for box, txt, conf in (r or []):
                xs = [p[0]*s + x0 for p in box]; ys = [p[1]*s + y0 for p in box]
                res.append({"t": txt, "c": round(float(conf), 3), "b": [round(min(xs),1), round(min(ys),1), round(max(xs),1), round(max(ys),1)]})
    json.dump({"page": i, "w": W, "h": H, "items": res}, open(f"{out}/p{i:03d}.json", "w"))
    print(i, len(res), f"{time.time()-t:.1f}s", flush=True)
