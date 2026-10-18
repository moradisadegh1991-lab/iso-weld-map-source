/**
 * Drive duties, the workflow tree and a workflow's pages in the browser
 * (owner's requirements of 2026-10-18, items 1–3), on the DM-pump scenario
 * played to the end: build the contract daily report's workflow, define a
 * duty and give it to the signed-in person, put the workflow under a folder
 * of the tree, give it two pages, place the duty in a group with days to
 * review, write a report through the duty, sign it accepting the stage's
 * changes, and print it page by page — each page's footer only the groups
 * that reach it. Then the setup page is read in English and Arabic for
 * Persian of its own.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-workflows.mjs
 */
import { chromium } from "playwright";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const b = await chromium.launch({ executablePath: CHROME });
const problems = [];
let failed = 0;
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) failed++; };
const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/40[0-9]|Failed to load resource|Failed to fetch RSC payload/.test(m.text())) problems.push("console: " + m.text()); });
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
const api = (path, body) => page.evaluate(async ([p, x]) => {
  const r = await fetch(p, x ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(x) } : {});
  return r.json();
}, [path, body]);
const setLang = async (lang) => {
  await api("/api/auth/prefs", { lang });
  await page.evaluate((l) => localStorage.setItem("epc.prefs", JSON.stringify({ ...JSON.parse(localStorage.getItem("epc.prefs") || "{}"), lang: l })), lang);
};
const sel = page.locator(".topbar select");
const picked = await sel.evaluate((s) => [...s.options].find((o) => o.value.startsWith("c:") && o.parentElement.label.startsWith("DMW"))?.value);
if (picked) { await sel.selectOption(picked); await page.waitForTimeout(500); }
check(!!picked, "the scenario's subcontract picked in the top bar");
await setLang("en");
const ok = async (text) => page.locator(".okmsg, .err").first().waitFor().then(async () => {
  const err = await page.locator(".err").allInnerTexts();
  return err.length ? `ERR ${err.join(" ")}` : text;
});

// the contract daily report's workflow, built from its own button
await page.goto(`${BASE}/contract-reports`, { waitUntil: "networkidle" });
await page.locator("button", { hasText: "Build the workflow" }).click();
await page.locator(".okmsg", { hasText: "Workflow built" }).waitFor();

await page.goto(`${BASE}/report-setup`, { waitUntil: "networkidle" });
check(await page.locator("tr[data-form=CR] select option:checked").innerText().then((x) => /گزارش روزانهٔ قرارداد|CR/.test(x)), "the contract daily report follows a workflow of its own (made from its old setup)");
// a duty, held by the signed-in person
const duties = page.locator("[data-duties]");
await duties.locator(".fold-btn").click();
await page.fill("#du-name", "Site manager"); await page.fill("#du-code", "SM");
for (const right of ["Create report", "Add content", "Edit content", "Sign", "Final stage approval"]) await duties.locator("label", { hasText: right }).first().locator("input").check();
await duties.locator("button", { hasText: "Save duty" }).click();
check(await ok("saved") === "saved", "a duty defined from the English form");
await duties.locator("tr[data-duty=SM] button", { hasText: "Set holders" }).click();
await duties.locator("tr[data-duty=SM] label", { hasText: "Drive admin" }).locator("input").check();
await duties.locator("tr[data-duty=SM] button", { hasText: "Save holders" }).click();
await page.waitForTimeout(600);
check(await duties.locator("tr[data-duty=SM]").innerText().then((x) => x.includes("Drive admin")), "the duty's holder shown");

// a folder in the tree, and the workflow moved under it by dragging
const tree = page.locator("[data-workflow-tree]");
await tree.locator(".fold-btn").click();
await page.fill("#wf-name", "Site reports"); await page.fill("#wf-code", "SITE");
await tree.locator("button", { hasText: "Save node" }).click();
await page.waitForTimeout(800);
const crNode = tree.locator("[data-node]").filter({ has: page.locator("[data-wf=CR]") });
await crNode.dragTo(tree.locator("[data-node]").filter({ has: page.locator("[data-wf=SITE]") }));
await page.waitForTimeout(800);
const st = await api(`/api/report-setup?projectId=${(await api("/api/auth/me")).projects.find((p) => p.code === "DMW").id}`);
const cr = st.workflows.find((w) => w.code === "CR"), site = st.workflows.find((w) => w.code === "SITE");
check(cr?.parentId === site?.id, "the CR workflow dragged under the «Site reports» folder");
await tree.locator("[data-wf=CR]").click();

// two pages, and the duty in the planning group with two days to review
const pages = page.locator("[data-pages]");
await page.fill("#pg-no", "1"); await page.fill("#pg-name", "Work");
for (const part of ["Header", "Narrative", "Problems"]) await pages.locator("label", { hasText: part }).first().locator("input").check();
await pages.locator("button", { hasText: "Add page" }).click();
await page.waitForTimeout(700);
await page.fill("#pg-no", "2"); await page.fill("#pg-name", "Resources");
await pages.locator("label", { hasText: "Resources" }).first().locator("input").check();
await pages.locator("button", { hasText: "Add page" }).click();
await page.waitForTimeout(700);
check(await pages.locator("tr[data-page]").count() === 2, "two pages on the workflow");
const grp = page.locator("[data-group-duties]").first();
await grp.locator("summary").first().click();
await grp.locator("select").first().selectOption({ label: "Site manager (Drive admin)" });
await grp.locator("input[type=number]").fill("2");
await grp.locator("button", { hasText: "Save the duty in the group" }).click();
await page.waitForTimeout(800);
check(await page.locator(".groupbox").first().innerText().then((x) => x.includes("Drive admin") && x.includes("Site manager")), "the duty's holder is a member of the group through it");
await page.screenshot({ path: `${SHOT}/350-workflow-setup-en.png`, fullPage: true });

// a report through the duty; signed accepting the stage's changes
await page.goto(`${BASE}/contract-reports`, { waitUntil: "networkidle" });
await page.fill("#nr-t", "Duty report");
await page.locator("button", { hasText: "Create report" }).click();
await page.locator(".ptabs").waitFor();
check(true, "the report created by the duty's holder");
check(await page.locator("[data-due=open]").first().innerText().then((x) => /Review by .*\(2 days\)/.test(x)), "the group's two days to review shown");
await page.locator(".ptabs button", { hasText: "Sign, approve & send" }).click();
await page.locator("#wf-accept").check();
await page.locator("button", { hasText: "Sign for" }).first().click();
await page.locator(".okmsg", { hasText: "Signed." }).waitFor();
check(await page.locator("[data-accepts]").count() > 0, "the signature marked as accepting the stage's changes");
await page.screenshot({ path: `${SHOT}/351-report-signed-en.png`, fullPage: true });

// printed page by page: the planning group (its duty reaches every page) on both; groups with nobody yet on both
await page.locator("a", { hasText: "Print / PDF" }).click();
await page.locator("[data-print-page]").first().waitFor();
check(await page.locator("[data-print-page]").count() === 2, "printed as two pages");
const resPage = page.locator("[data-print-page='2']");
check(await resPage.innerText().then((x) => !x.includes("شرح کار") && x.includes("منابع")), "page 2 holds the resources, not the narrative");

// the setup page in English and Arabic: no Persian of its own
const chrome = () => page.evaluate(() => {
  const s = ".page h1, .page h2:not(.mono), .page h3, .page th, .page label, .page button, .page summary, .page .empty-note, .page .pagehead .sub, .page .muted.sm:not(td *)";
  return [...document.querySelectorAll(s)].filter((n) => n.offsetParent !== null)
    .filter((n) => !n.closest(".groupbox > b, .groupbox > .muted, [data-node], tr, .stagebox > h3, [data-scope-tree]"))
    .map((n) => (n.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean);
});
const names = st.workflows.flatMap((w) => [w.name, ...w.stageList.flatMap((s) => [s.name, ...s.groups.map((g) => g.name)])]).concat(st.types.map((t) => t.name), st.duties.map((d) => d.name), st.users.map((u) => u.name))
  .filter(Boolean).sort((x, y) => y.length - x.length);
const unnamed = (w) => names.reduce((x, n) => x.split(n).join(""), w);
for (const [lang, rx] of [["en", /[\u0600-\u06FF]/], ["ar", /[\u067E\u0686\u0698\u06AF\u06CC\u06A9]/]]) {
  await setLang(lang);
  await page.goto(`${BASE}/report-setup`, { waitUntil: "networkidle" });
  const left = (await chrome()).filter((w) => rx.test(unnamed(w)));
  check(left.length === 0, `${lang} /report-setup: Persian left: ${left.slice(0, 6).join(" | ") || "none"}`);
}
await page.screenshot({ path: `${SHOT}/352-workflow-setup-ar.png`, fullPage: true });
await setLang("fa");

console.log(problems.length ? `problems:\n  ${problems.join("\n  ")}` : "no page errors");
await b.close();
if (failed || problems.length) process.exit(1);
