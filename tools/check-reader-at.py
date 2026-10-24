"""Where tools/iso-read.py says each weld marker sits (`at`), checked under
every turn of the page: one golden sheet is rendered, turned 90°, 180° and
270°, and read four times; each marker's `at` must be the same spot of the
page as handed to the reader, whichever way the reader turned it upright.

    python3 -I tools/check-reader-at.py [sheet.pdf]

Needs what the reader needs (OpenCV, NumPy, tesseract, poppler). Exits 1
when any marker moves by more than half a percent of the page.
"""
import json, os, subprocess, sys, tempfile
import cv2

here = os.path.dirname(os.path.abspath(__file__))
sheet = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "..", "eval", "cases", "golden", "drawings", "25-1014-SH1-0.pdf")
d = tempfile.mkdtemp()
subprocess.run(["pdftoppm", "-r", "200", "-gray", "-png", "-f", "1", "-l", "1", sheet, f"{d}/p"], check=True)
page = cv2.imread(next(os.path.join(d, f) for f in os.listdir(d) if f.endswith(".png")), 0)
# how a point of the upright page, as fractions, lands on the page turned each way
TURNS = {"none": (None, lambda x, y: (x, y)),
         "90 clockwise": (cv2.ROTATE_90_CLOCKWISE, lambda x, y: (1 - y, x)),
         "180": (cv2.ROTATE_180, lambda x, y: (1 - x, 1 - y)),
         "90 counter-clockwise": (cv2.ROTATE_90_COUNTERCLOCKWISE, lambda x, y: (y, 1 - x))}
read = {}
for name, (turn, _) in TURNS.items():
    f = os.path.join(d, name.replace(" ", "-") + ".png")
    cv2.imwrite(f, cv2.rotate(page, turn) if turn is not None else page)
    out = subprocess.run([sys.executable, "-I", os.path.join(here, "iso-read.py"), f], check=True, capture_output=True, text=True).stdout
    read[name] = {m["no"]: m["at"] for m in json.loads(out)["marks"]}
base, worst, failed = read["none"], 0.0, False
if not base:
    sys.exit("no marker read on the upright page — nothing to check")
for name, (_, move) in TURNS.items():
    common = [n for n in base if n in read[name]]
    err = max((max(abs(a - b) for a, b in zip(move(*base[n]), read[name][n])) for n in common), default=1)
    ok = err <= 0.005 and len(common) == len(base)
    failed |= not ok
    print("ok  " if ok else "FAIL", f"{name}: {len(common)}/{len(base)} markers, worst {err:.4f} of the page")
sys.exit(1 if failed else 0)
