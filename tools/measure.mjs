import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto("http://localhost:3000", { waitUntil: "networkidle" });
await p.fill("#email", process.env.DRIVE_EMAIL);
await p.fill("#password", process.env.DRIVE_PASSWORD);
await p.click("button[type=submit]");
await p.waitForSelector(".shell");
await p.waitForTimeout(900);
console.log(await p.evaluate(() => {
  const w = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return "(missing)";
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return `${Math.round(r.width)}px  display=${cs.display} align-self=${cs.alignSelf}`;
  };
  return [
    "body      " + w("body"),
    ".shell    " + w(".shell"),
    "main.body " + w("main.body"),
    ".page     " + w(".page"),
    ".card     " + w(".card"),
    ".tiles    " + w(".tiles"),
    "tile      " + w(".tiles .tile"),
    "tiles cols= " + getComputedStyle(document.querySelector(".tiles")).gridTemplateColumns,
  ].join("\n");
}));
await b.close();
