/**
 * Shared start of a browser drive of the workspace (Playwright is pre-installed in the cloud container).
 *
 *   import { openWorkspace } from "./drive-lib.mjs";
 *   const { page, b, errs, dialogs, shot } = await openWorkspace({ pdf: "/path/sheet.pdf" });
 *   … drive …
 *   await b.close();
 *
 * Needs a running server and a user that exists in its database; nothing is created here:
 *   DRIVE_URL        default http://localhost:3000
 *   DRIVE_EMAIL / DRIVE_PASSWORD   the account to sign in with (required)
 *   DRIVE_PROJECT    a regex for the project's name in the top bar's picker (default: the first project)
 *   DRIVE_SHOTS      a folder for screenshots (default: the OS temp dir)
 * Options: pdf (path; omit to stop at the /piping page), reader ("local" | …, default "local"),
 *          viewport ({ width, height }), page-errors are collected in `errs`, confirm() dialogs are accepted and listed in `dialogs`.
 */
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
const { chromium } = createRequire(import.meta.url)("playwright");

export async function openWorkspace({ pdf = null, reader = "local", viewport = { width: 1920, height: 1000 } } = {}) {
  const url = process.env.DRIVE_URL || "http://localhost:3000";
  const { DRIVE_EMAIL: email, DRIVE_PASSWORD: password } = process.env;
  if (!email || !password) throw new Error("DRIVE_EMAIL and DRIVE_PASSWORD are required (an account of the server's database)");
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport })).newPage();
  const errs = [], dialogs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.fill("#email", email); await page.fill("#password", password);
  await page.click("button[type=submit]"); await page.waitForSelector(".shell");
  if (process.env.DRIVE_PROJECT) {
    const sel = page.locator(".topbar select").first();
    const v = await sel.locator("option").evaluateAll((os, re) => os.find((o) => new RegExp(re).test(o.textContent))?.value, process.env.DRIVE_PROJECT);
    if (!v) throw new Error(`no project matching ${process.env.DRIVE_PROJECT} in the picker`);
    await sel.selectOption(v); await page.waitForTimeout(600);
  }
  await page.goto(`${url}/piping`, { waitUntil: "networkidle" }); await page.waitForTimeout(600);
  if (pdf) {
    await page.check(`input[name=iso-reader][value=${reader}]`);
    await page.setInputFiles('input[type=file][accept^="application/pdf"]', pdf);
    await page.waitForSelector("[data-workspace]", { timeout: 240000 }); await page.waitForTimeout(1000);
  }
  const shot = (name) => page.screenshot({ path: `${process.env.DRIVE_SHOTS || tmpdir()}/${name}.png` });
  return { page, b, errs, dialogs, shot, url };
}

/** Switch to a workspace tab by key: info, welds, spools, supports, equip, bom, cut, style, import, save. */
export const tab = (page, k) => page.click(`[data-ws-tab="${k}"]`);
