/**
 * Drive session revocation: two browsers signed in as the same person;
 * "sign out everywhere" in one ends the other.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-auth.mjs
 */
import { chromium } from "playwright";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const b = await chromium.launch({ executablePath: CHROME });
const login = async () => {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]"); await page.waitForSelector(".shell");
  return page;
};
const phone = await login();
const office = await login();
const me = async (page) => page.evaluate(async () => (await fetch("/api/auth/me")).status);
console.log("both signed in:", await me(phone), await me(office));
office.on("dialog", (d) => d.accept());
await office.getByRole("button", { name: "خروج از همه‌جا" }).click();
await office.waitForSelector("#email");
console.log("office after 'everywhere':", await me(office));
console.log("phone after 'everywhere':", await me(phone));
await phone.reload({ waitUntil: "networkidle" });
console.log("phone shows the login form:", await phone.locator("#email").count() === 1);
const again = await login();
console.log("a fresh sign-in works:", await me(again));
await b.close();
