/**
 * The key and server address registered in the piping page (owner's request
 * 2026-10-29), against a stand-in OpenAI-compatible server started here:
 * the admin opens «ثبت کلید و آدرس سرور» under the isometric reader's model
 * picker, registers the address, key and model; the list shows the address
 * and the key's last four characters and nothing more; the field is never
 * filled in again; the model appears in the picker as registered in this
 * project; a reading is sent to the stand-in with the key as a bearer; the
 * endpoint is removed. The key is a throwaway made up here.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-llm-endpoints.mjs
 */
import { chromium } from "playwright";
import http from "node:http";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }

// the stand-in OpenAI-compatible service: records what it is sent, answers with a stream
const seen = [];
const fake = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, model: (() => { try { return JSON.parse(body).model; } catch { return null; } })() });
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "{}" } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 11, completion_tokens: 2 } })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => fake.listen(0, "127.0.0.1", r));
const PORT = fake.address().port;
const SECRET = `drv-${Date.now().toString(36)}-SECRET-key-7391`;

const b = await chromium.launch({ executablePath: CHROME });
const problems = [];
let failed = 0;
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) failed++; };
const page = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/40[0-9]|50[0-9]|Failed to load resource|Failed to fetch RSC payload/.test(m.text())) problems.push("console: " + m.text()); });
const asked = [];
page.on("dialog", (d) => { asked.push(d.message()); d.accept(); });
// every response the page receives, to prove the key never comes back
const bodies = [];
page.on("response", async (r) => { if (r.url().includes("/api/")) { try { bodies.push({ url: r.url(), text: await r.text() }); } catch { /* a redirect or a stream */ } } });
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
const api = (path, body) => page.evaluate(async ([p, x]) => {
  const r = await fetch(p, x ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(x) } : {});
  return { status: r.status, body: await r.json().catch(() => ({})) };
}, [path, body]);
const me = (await api("/api/auth/me")).body;
const projectId = me.projects.find((p) => p.code === "DMW").id;
await page.locator(".topbar select").selectOption(`p:${projectId}`); await page.waitForTimeout(500);
await api("/api/llm-endpoints", { projectId, kind: "remove", provider: "openai-compatible" });   // a clean start

await page.goto(`${BASE}/piping`, { waitUntil: "networkidle" });
const panel = page.locator("[data-llm-endpoints]");
await panel.locator("summary").click();
check(await panel.locator("[data-llm-none]").count() === 1, "nothing registered: the server reads its own Environment");
await panel.locator("[data-llm-new]").click();
check(await panel.locator('select[aria-label=provider]').inputValue() === "openai-compatible", "OpenAI-compatible (Liara …) is the first choice");
await panel.locator('input[aria-label=baseUrl]').fill(`http://127.0.0.1:${PORT}/v1`);
await panel.locator('input[aria-label=secret]').fill(SECRET);
await panel.locator('textarea[aria-label=models]').fill("drv-vision-72b\ndrv-vision-7b");
check(await panel.locator('input[aria-label=secret]').getAttribute("type") === "password", "the key field hides what is typed");
await page.screenshot({ path: `${SHOT}/500-llm-endpoint-form-fa.png` });
asked.length = 0;
await panel.locator("[data-llm-save]").click();
await panel.locator('[data-llm-endpoint="openai-compatible"]').waitFor();
check(asked.length === 1 && /رمزنگاری/.test(asked[0]), "saving is asked first, and says the key is sealed");
const row = await panel.locator('[data-llm-endpoint="openai-compatible"]').innerText();
check(row.includes(`127.0.0.1:${PORT}/v1`) && row.includes("••••7391") && !row.includes("SECRET"), `the list shows the address and the key's last four only (${row.replace(/\s+/g, " ").slice(0, 110)})`);
await page.screenshot({ path: `${SHOT}/501-llm-endpoint-saved-fa.png` });
check(!(await page.content()).includes(SECRET), "the key is nowhere in the page");
check(await panel.locator("[data-llm-form]").count() === 0, "the form closed");

// editing: the key field is empty; leaving it empty keeps the stored key
await panel.locator('[data-llm-endpoint="openai-compatible"] button', { hasText: "ویرایش" }).click();
check(await panel.locator('input[aria-label=secret]').inputValue() === "" && /خالی = همان کلید/.test(await panel.locator('input[aria-label=secret]').getAttribute("placeholder")), "editing never fills the key back in");
await panel.locator("[data-llm-save]").click();
await panel.locator('[data-llm-endpoint="openai-compatible"]').waitFor();
check((await panel.locator('[data-llm-endpoint="openai-compatible"]').innerText()).includes("••••7391"), "saved with the key left empty: the same key is kept");

// the model picker lists it as registered in this project
await page.getByRole("button", { name: "خواندن مدل‌ها" }).click();
const group = page.locator('.model-group[data-provider="openai-compatible"]').first();
await group.waitFor();
check(/ثبت‌شده در این پروژه/.test(await group.innerText()) && await group.locator('button[data-model="drv-vision-72b"]').isEnabled(), "its models are in the picker, marked as registered in this project");
await page.screenshot({ path: `${SHOT}/502-llm-endpoint-models-fa.png` });

// a reading goes to the stand-in with the key as a bearer
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const r = await api("/api/extract", { projectId, model: "drv-vision-72b", images: [{ label: "FULL SHEET", data: png, mediaType: "image/png" }] });
check(seen.length >= 1 && seen[0].url === "/v1/chat/completions" && seen[0].auth === `Bearer ${SECRET}` && seen[0].model === "drv-vision-72b",
  `the reading reached the registered server with the key as a bearer (${seen[0]?.url} ${seen[0]?.model}; extract answered ${r.status})`);

// the key never came back in any response the page received
check(!bodies.some((x) => x.text.includes(SECRET) || x.text.includes("secret_enc")), `none of ${bodies.length} responses carried the key or its sealed form`);

// removed
asked.length = 0;
await panel.locator('[data-llm-endpoint="openai-compatible"] button', { hasText: "حذف" }).click();
await panel.locator("[data-llm-none]").waitFor();
check(asked.length === 1 && (await api(`/api/llm-endpoints?projectId=${projectId}`)).body.endpoints.length === 0, "removed after a question");

console.log(problems.length ? problems.join("\n") : "no page errors");
await b.close();
fake.close();
process.exit(failed || problems.length ? 1 : 0);
