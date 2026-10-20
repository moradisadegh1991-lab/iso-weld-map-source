/**
 * What the no-model drawing reader (tools/iso-read.py) needs on the server,
 * and which of it is missing — each piece with the Ubuntu package that
 * provides it, so the message can say exactly what to install.
 *
 * A server installed before the reader existed has none of it: `epc update`
 * brings new code, not new system packages (deploy/vps/epc `deps` does).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// the same list deploy/vps/packages.txt installs
export const READER_PACKAGES = ["python3", "python3-opencv", "python3-numpy", "tesseract-ocr", "poppler-utils"];

const missingProgram = (e) => e?.code === "ENOENT";

/** [{ what, pkg }] for every piece that is not there; [] when the reader can run. */
export async function readerMissing() {
  const missing = [];
  try {
    // which of the two modules fails to import, each on its own
    const { stdout } = await run("python3", ["-I", "-c",
      "import importlib.util as u; print(' '.join(m for m in ('cv2', 'numpy') if u.find_spec(m) is None))"], { timeout: 20_000 });
    for (const m of stdout.trim().split(/\s+/).filter(Boolean)) {
      missing.push(m === "cv2" ? { what: "OpenCV (cv2)", pkg: "python3-opencv" } : { what: "NumPy", pkg: "python3-numpy" });
    }
  } catch (e) {
    if (missingProgram(e)) missing.push({ what: "python3", pkg: "python3" }, { what: "OpenCV (cv2)", pkg: "python3-opencv" }, { what: "NumPy", pkg: "python3-numpy" });
    else throw e;
  }
  for (const [cmd, args, what, pkg] of [["tesseract", ["--version"], "tesseract", "tesseract-ocr"], ["pdftoppm", ["-v"], "pdftoppm (poppler)", "poppler-utils"]]) {
    try { await run(cmd, args, { timeout: 20_000 }); } catch (e) { if (missingProgram(e)) missing.push({ what, pkg }); }
  }
  return missing;
}

/** The one line a person acts on. */
export function readerMissingText(missing) {
  return `خواندن بدون مدل روی این سرور نصب نیست — نیست: ${missing.map((m) => m.what).join("، ")}. ` +
    `روی سرور اجرا کنید: sudo apt-get install -y ${missing.map((m) => m.pkg).join(" ")} ` +
    `(یا sudo epc deps).`;
}
