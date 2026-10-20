/**
 * Drive the ERP refinement layer (app/design.css, end of file) in a real
 * browser and measure it: the launchpad and KPI tiles fill their grid
 * columns, a card's first heading band reaches the card's edges (and runs on
 * under the form buttons beside it), and no page scrolls sideways — in
 * Persian, English and Arabic, dark and light, both densities, at desktop,
 * tablet and phone width.
 * Screenshots go to SHOT_DIR for a look by eye.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-ui-refinement.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
mkdirSync(SHOT, { recursive: true });
const b = await chromium.launch({ executablePath: CHROME });
const problems = [];
let failed = 0;
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) failed++; };
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
const api = (path, body) => page.evaluate(async ([p, x]) => {
  const r = await fetch(p, x ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(x) } : {});
  const j = await r.json();
  if (!r.ok) throw new Error(`${p}: ${j.error}`);
  return j;
}, [path, body]);
const prefs = async (p) => {
  await api("/api/auth/prefs", p);
  await page.evaluate((x) => localStorage.setItem("epc.prefs", JSON.stringify({ ...JSON.parse(localStorage.getItem("epc.prefs") || "{}"), ...x })), p);
};
const projectId = (await api("/api/auth/me")).projects.find((p) => p.code === "DMW").id;
await page.locator(".topbar select").selectOption(`p:${projectId}`); await page.waitForTimeout(500);

const PAGES = ["/", "/forms", "/hse", "/quality", "/piping/overview", "/documents"];

/** Everything measured on one page, in the page. */
const measure = () => page.evaluate(() => {
  const r = (e) => e.getBoundingClientRect();
  const de = document.documentElement, body = document.querySelector(".body");
  const out = { sideways: de.scrollWidth - de.clientWidth, bodySideways: body ? body.scrollWidth - body.clientWidth : 0 };
  const lp = document.querySelector(".lp-tiles");
  if (lp) {
    const tiles = [...lp.querySelectorAll(".lp-tile")];
    // offsetTop, not the box: a hovered tile is lifted by its transform
    const row = tiles.filter((t) => t.offsetTop === tiles[0].offsetTop);
    out.lpPerRow = row.length;
    out.lpTiles = tiles.length;
    out.lpFill = tiles.length ? Math.round(row.reduce((s, t) => s + r(t).width, 0) / r(lp).width * 100) : 0;
  }
  const head = document.querySelector(".lp-tile .lp-head");
  if (head) {
    const probe = document.createElement("i"); probe.style.color = "var(--ink)"; document.body.append(probe);
    out.lpInk = getComputedStyle(head).color === getComputedStyle(probe).color; probe.remove();
  }
  const kt = document.querySelector(".tiles");
  if (kt) {
    const tiles = [...kt.querySelectorAll(":scope > .tile")];
    out.kpiPerRow = tiles.filter((t) => t.offsetTop === tiles[0].offsetTop).length;
    out.kpiTiles = tiles.length;
    // the value sits inside its tile and does not overlap the title
    out.kpiClash = tiles.filter((t) => {
      const big = t.querySelector(".big"), ti = t.querySelector(".t");
      if (!big || !ti || !big.textContent.trim()) return false;
      const a = r(big), c = r(ti), o = r(t);
      const inside = a.left >= o.left - 1 && a.right <= o.right + 1;
      const overlap = a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1;
      return !inside || overlap;
    }).length;
  }
  out.cards = [...document.querySelectorAll(".card")].filter((c) => c.firstElementChild?.tagName === "H2" && c.offsetParent).map((c) => {
    const h = c.firstElementChild, a = r(h), o = r(c), bw = parseFloat(getComputedStyle(c).borderLeftWidth) || 0;
    const bar = c.dataset.actions === "head" ? c.querySelector(":scope > .card-actions") : null;
    const edge = c.dataset.actions === "head" && bar
      // the band runs on under the buttons: edges, top, and no seam between them
      ? Math.max(Math.abs(Math.min(a.left, r(bar).left) - (o.left + bw)), Math.abs(Math.max(a.right, r(bar).right) - (o.right - bw)), Math.abs(r(bar).top - a.top),
        Math.abs(a.left < r(bar).left ? r(bar).left - a.right : a.left - r(bar).right))
      : Math.max(Math.abs(a.left - (o.left + bw)), Math.abs(a.right - (o.right - bw)));
    return { edge: Math.round(edge * 10) / 10, top: Math.round((a.top - (o.top + bw)) * 10) / 10, head: !!bar, name: h.textContent.trim().slice(0, 30) };
  });
  return out;
});

for (const [lang, theme, width, density] of [["fa", "dark", 1500, "comfortable"], ["en", "light", 1500, "compact"], ["fa", "light", 390, "comfortable"], ["ar", "dark", 820, "compact"]]) {
  await prefs({ lang, theme, density });
  await page.setViewportSize({ width, height: 950 });
  for (const p of PAGES) {
    await page.goto(BASE + p, { waitUntil: "networkidle" }); await page.waitForTimeout(400);
    const tag = `${lang}/${theme}/${density}/${width} ${p}`;
    const m = await measure();
    check(m.sideways <= 1 && m.bodySideways <= 1, `${tag}: no sideways scroll (${m.sideways}, ${m.bodySideways})`);
    if (m.lpTiles) {
      check(m.lpInk, `${tag}: a launchpad tile's title is in the ink colour, not the link colour`);
      const want = width >= 1121 ? 4 : width > 820 ? 3 : width > 520 ? 2 : 1;
      check(m.lpPerRow === Math.min(want, m.lpTiles), `${tag}: launchpad ${m.lpPerRow} per row (want ${want})`);
      if (m.lpTiles >= want) check(m.lpFill >= 95, `${tag}: launchpad tiles fill the row (${m.lpFill}%)`);
    }
    if (m.kpiTiles) {
      const want = width > 820 ? 3 : width > 520 ? 2 : 1;
      check(m.kpiPerRow === Math.min(want, m.kpiTiles), `${tag}: KPI tiles ${m.kpiPerRow} per row (want ${want})`);
      check(m.kpiClash === 0, `${tag}: each KPI value sits in its tile, clear of the title (${m.kpiClash} clash)`);
    }
    const bad = m.cards.filter((c) => c.edge > 1.5 || Math.abs(c.top) > 1.5);
    if (m.cards.length) check(bad.length === 0, `${tag}: ${m.cards.length} card heading bands reach the card's edges${m.cards.some((c) => c.head) ? " (with buttons beside)" : ""}${bad.length ? " — off: " + JSON.stringify(bad.slice(0, 3)) : ""}`);
    await page.screenshot({ path: `${SHOT}/ui-${lang}-${theme}-${width}${p.replace(/\//g, "_") || "_home"}.png`, fullPage: false });
  }
}
await prefs({ lang: "fa", theme: "dark", density: "comfortable" });
console.log(problems.length ? problems.join("\n") : "no page errors");
await b.close();
if (failed || problems.length) process.exit(1);
