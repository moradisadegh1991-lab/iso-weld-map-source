/**
 * Drive the printed-marker path through the real UI:
 *   1. the project declares its weld symbols (circle = shop, square = field);
 *   2. an isometric PDF goes through the extraction passes — meta, nodes and
 *      the new `welds` pass — and opens as a weld list built from the joint
 *      numbers printed on the sheet;
 *   3. the contractor's joint history (the whole project's Excel) is compared
 *      with it, cut to this drawing's own sheet.
 *
 *   DRIVE_EMAIL=… DRIVE_PASSWORD=… ISO_PDF=sheet.pdf REGISTER_XLSX=joints.xlsx \
 *   EXPECT_JOINTS=25 node --import ./tools/register.mjs tools/drive-weldmap.mjs
 *
 * The server's LLM_BASE_URL may point at a stub that answers each pass with
 * a hand-read extraction; what is driven is everything after the model.
 */
import { chromium } from "playwright";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD, ISO_PDF, REGISTER_XLSX } = process.env;
const EXPECT = Number(process.env.EXPECT_JOINTS || 0);
const problems = [], log = (m) => console.log(m);
const check = (ok, what) => { log(`  ${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) problems.push(what); };
const flat = (t) => String(t).replace(/\s+/g, " ").trim();

const b = await chromium.launch({ executablePath: CHROME });
const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
p.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
const settle = () => p.waitForTimeout(900);
await p.goto(BASE, { waitUntil: "networkidle" });
await p.fill("#email", EMAIL); await p.fill("#password", PASSWORD);
await p.click("button[type=submit]"); await p.waitForSelector(".shell");

try {
  log("1  the project's weld symbols");
  await p.goto(BASE + "/project", { waitUntil: "networkidle" }); await settle();
  await p.selectOption("#weld_symbol_shop", "circle");
  await p.selectOption("#weld_symbol_field", "square");
  await p.locator("form", { has: p.locator("#weld_symbol_shop") }).getByRole("button", { name: /ذخیره/ }).first().click();
  await p.waitForSelector("text=ذخیره شد", { timeout: 15000 });
  await p.reload({ waitUntil: "networkidle" });
  const kept = await p.waitForFunction(() => document.querySelector("#weld_symbol_shop")?.value === "circle"
    && document.querySelector("#weld_symbol_field")?.value === "square", null, { timeout: 15000 }).then(() => true, () => false);
  check(kept, "saved: circle = shop, square = field");

  log("2  the isometric through the three passes");
  await p.goto(BASE + "/piping", { waitUntil: "networkidle" }); await settle();
  await p.locator("input[type=file][accept*='image/webp']").setInputFiles(ISO_PDF);
  await p.waitForSelector(".wl-table", { timeout: 120000 }); await settle();
  const rows = p.locator(".wl-table tbody tr");
  const n = await rows.count();
  check(!EXPECT || n === EXPECT, `the weld list holds the ${n} joints printed on the sheet`);
  const locs = await p.locator(".wl-table tbody tr td:nth-child(4) input").evaluateAll((els) => els.map((e) => e.value));
  check(locs.length > 0 && locs.every((v) => /^(Shop|Field)$/i.test(v)), `every joint has its location from the declared symbols (${[...new Set(locs)].join("/")})`);
  const note = flat(await p.locator("[data-weld-marks]").innerText());
  check(/از 25 شمارهٔ جوش چاپ‌شده روی نقشه/.test(note) || /شمارهٔ جوش چاپ‌شده روی نقشه/.test(note),
    `the page says the register came from the printed numbers, and what is left for a person («${note.slice(0, 200)}»)`);
  await p.screenshot({ path: `${SHOT}/weldmap-list.png`, fullPage: true });

  log("3  the contractor's joint history, cut to this sheet");
  await p.locator("details", { hasText: "حقیقت مرجع" }).locator("summary").click();
  await p.locator("details", { hasText: "حقیقت مرجع" }).locator("input[type=file]").setInputFiles(REGISTER_XLSX);
  await p.waitForSelector("text=ردیف خوانده شد", { timeout: 180000 }); await settle();
  const t = flat(await p.locator("details", { hasText: "حقیقت مرجع" }).innerText());
  check(/فقط این نقشه و برگ/.test(t), `only this sheet's rows («${(t.match(/\d+ ردیف خوانده شد[^·]*/) || [""])[0]}»)`);
  check(new RegExp(`پیمانکار ${EXPECT} · محاسبه ${EXPECT}`).test(t) && !/پیدا نشد:|اضافه:/.test(t), "the count agrees, nothing missing, nothing extra");
  const locRow = (t.match(/محل \(Field\/Shop\) (\d+) (\d+) (\d+%|سنجیده نشد)/) || []).slice(1);
  check(locRow[2] === "100%", `Shop/Field ${locRow.join(" / ")}`);
  await p.screenshot({ path: `${SHOT}/weldmap-truth.png`, fullPage: true });
} catch (e) {
  problems.push(e.message.split("\n")[0]);
  await p.screenshot({ path: `${SHOT}/weldmap-fail.png`, fullPage: true }).catch(() => {});
}
log(`\nproblems: ${problems.length ? JSON.stringify(problems) : "none"}`);
await b.close();
process.exit(problems.length ? 1 : 0);
