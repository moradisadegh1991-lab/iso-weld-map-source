/**
 * Drive the file store on MinIO (production build, STORAGE_DRIVER=s3): a
 * drawing too big for a request body goes from the browser straight into
 * the bucket — cross-origin, through the URL signed for its hash — and is
 * registered only once the bucket holds it; a forged upload is refused by
 * the bucket; a registration claiming bytes never uploaded is refused by
 * the server.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-storage.mjs
 */
import { chromium } from "playwright";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const b = await chromium.launch({ executablePath: CHROME });
const page = await (await b.newContext()).newPage();
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");

const out = await page.evaluate(async () => {
  const me = await (await fetch("/api/auth/me")).json();
  const projectId = me.projects.find((x) => x.code === "DEMO").id;
  // A 6 MB "PDF": over the 3.4 MB body ceiling. Random, so each run is new.
  const buf = new Uint8Array(6 * 1024 * 1024);
  for (let i = 0; i < buf.length; i += 65536) crypto.getRandomValues(buf.subarray(i, i + 65536));
  buf.set(new TextEncoder().encode("%PDF-1.7\n"), 0);
  const hex = (d) => [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
  const sha256 = hex(await crypto.subtle.digest("SHA-256", buf));
  const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json() }));
  const docNo = `DRIVE-BIG-${sha256.slice(0, 6)}`;
  const early = await post("/api/documents", { projectId, docNo, revision: "0", contentType: "application/pdf", fileSha256: sha256, byteSize: buf.length, uploaded: true });
  const slot = await post("/api/documents/upload-url", { projectId, sha256, byteSize: buf.length, contentType: "application/pdf" });
  const forged = buf.slice(); forged[1000] ^= 1;
  const bad = await fetch(slot.body.url, { method: "PUT", headers: slot.body.headers, body: forged }).then((r) => r.status, (e) => "network: " + e.message);
  const t0 = performance.now();
  const put = await fetch(slot.body.url, { method: "PUT", headers: slot.body.headers, body: buf }).then((r) => r.status, (e) => "network: " + e.message);
  const ms = Math.round(performance.now() - t0);
  const doc = await post("/api/documents", { projectId, docNo, revision: "0", contentType: "application/pdf", fileSha256: sha256, byteSize: buf.length, uploaded: true });
  const again = await post("/api/documents/upload-url", { projectId, sha256, byteSize: buf.length, contentType: "application/pdf" });
  return { host: new URL(slot.body.url).host, early, bad, put, ms, doc, again: again.body.exists };
});
console.log("register before the upload:", out.early.status, out.early.body.error);
console.log("upload URL host:", out.host, "(cross-origin from the app)");
console.log("forged bytes PUT:", out.bad);
console.log("real bytes PUT:", out.put, `in ${out.ms} ms`);
console.log("register after:", out.doc.status, out.doc.body.document?.storage_uri, out.doc.body.document?.byte_size);
console.log("second upload needed:", !out.again);
await b.close();
