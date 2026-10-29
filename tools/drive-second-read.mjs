/**
 * The second read on the isometric page: with a second reader picked, the
 * sheet is read twice (nodes and BOM), the two readings are compared, and a
 * number they do not agree on appears as a check the repair pass is shown;
 * with it off nothing extra is called. The model is stubbed in the browser
 * (page.route), so it needs no key; what it proves is the page's own wiring.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-second-read.mjs
 */
import { chromium } from "playwright";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const b = await chromium.launch({ executablePath: CHROME });
let failed = 0;
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) failed++; };
const problems = [];

const catalogue = {
  provider: "openai", configured: true, defaultModel: "m-first", repairModel: "m-first",
  providers: [{ id: "openai", label: "stub", configured: true }],
  models: [{ id: "m-first", label: "first", provider: "openai" }, { id: "m-second", label: "second", provider: "openai" }],
};
const nodes = (elbowE) => [
  { id: "N1", type: "tie-in", ref: "A", E: 0, N: 0, EL: 10000 },
  { id: "N2", type: "elbow90", ref: "", E: elbowE, N: 0, EL: 10000 },
  { id: "N3", type: "tie-in", ref: "B", E: elbowE, N: 2000, EL: 10000 },
];
const edges = [{ from: "N1", to: "N2", nps: 12 }, { from: "N2", to: "N3", nps: 12 }];
const bom = (qty) => [{ pt: 1, group: "PIPE", description: "PIPE 12 SCH 40", diam: 12, stockCode: "P1", qty }];
const meta = { nps: 12, schedule: "SCH 40", pupLength: 0 };

async function run(secondModel, secondDisagrees) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  const calls = [];
  await page.route("**/api/models**", (r) => r.fulfill({ json: catalogue }));
  await page.route("**/api/extract", async (r) => {
    const body = JSON.parse(r.request().postData() || "{}");
    calls.push(`${body.pass}:${body.model}`);
    const second = body.model === "m-second";
    const data =
      body.pass === "nodes" ? { nps: 12, nodes: nodes(second && secondDisagrees ? 3200 : 3000), edges, unreadable: [] }
      : body.pass === "meta" ? { meta, bom: bom(second && secondDisagrees ? 12 : 10), cutLengths: [], notes: [], unreadable: [] }
      : body.pass === "welds" ? { marks: [] }
      : {};
    await r.fulfill({ json: { data, model: body.model, ms: 5, pass: body.pass, usage: null } });
  });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]"); await page.waitForSelector(".shell");
  await page.goto(`${BASE}/piping`, { waitUntil: "networkidle" }); await page.waitForTimeout(800);
  await page.getByRole("button", { name: "خواندن مدل‌ها" }).click();
  await page.waitForSelector("[data-second-reader] .model-group");
  if (secondModel) await page.locator(`[data-second-reader] button[data-model="${secondModel}"]`).click();
  await page.getByRole("button", { name: /نقشه دوبعدی/ }).first().click();
  await page.check('input[name="iso-reader"][value="model"]');
  await page.setInputFiles(".drop input[type=file]", "eval/cases/golden/drawings/25-1004-SH1-0.pdf");
  await page.waitForSelector("nav.tabnav", { timeout: 60000 });
  await page.waitForTimeout(1500);
  const note = await page.locator(".note.mono").last().innerText();
  await page.locator("nav.tabnav button", { hasText: "اعتبارسنجی" }).click();
  const checks = await page.locator(".pane").first().innerText();
  await page.screenshot({ path: `${SHOT}/second-read-${secondModel || "off"}-${secondDisagrees ? "differ" : "same"}.png` });
  await ctx.close();
  return { calls, note, checks };
}

const off = await run("", false);
check(!off.calls.some((c) => c.endsWith(":m-second")), `off: the second reader is never called (${off.calls.join(", ")})`);
check(!/خوانش دوم/.test(off.note) && !/دو خوانش یکی نیست/.test(off.checks), "off: nothing about a second reading appears");

const same = await run("m-second", false);
check(same.calls.filter((c) => c.endsWith(":m-second")).sort().join() === "meta:m-second,nodes:m-second", `agree: the second reader reads nodes and BOM (${same.calls.join(", ")})`);
check(/هم‌خوان/.test(same.note), "agree: the note says the readings agree");
check(!/دو خوانش یکی نیست/.test(same.checks), "agree: no check is raised");

const diff = await run("m-second", true);
check(/دو خوانش یکی نیست/.test(diff.checks), "differ: the check «دو خوانش یکی نیست» is raised");
check(/اختلاف/.test(diff.note), `differ: the note counts the disagreements (${diff.note.slice(-70)})`);
check(/3200/.test(diff.checks) || /elbow90/.test(diff.checks) || /BOM ردیف 1/.test(diff.checks), "differ: the check names the number that differs");
check(diff.calls.some((c) => c.startsWith("repair:")), "differ: the repair pass is shown it (a warning reached repair)");

console.log(problems.length ? problems.join("\n") : "no page errors");
await b.close();
process.exit(failed || problems.length ? 1 : 0);
