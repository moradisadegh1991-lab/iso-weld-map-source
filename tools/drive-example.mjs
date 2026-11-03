/**
 * Example drive: open a sheet, add a cut piece through its form, and show the table's row count.
 *   DRIVE_EMAIL=… DRIVE_PASSWORD=… node tools/drive-example.mjs /path/sheet.pdf
 */
import { openWorkspace, tab } from "./drive-lib.mjs";
const { page, b, errs, shot } = await openWorkspace({ pdf: process.argv[2] });
await tab(page, "cut");
const rows = () => page.locator("[data-cut-lengths] table tbody tr").count();
const before = await rows();
await page.click("[data-cut-add]"); await page.waitForSelector("[data-cut-form]");
await page.fill('[data-cut-form] [data-input="lengthMm"]', "800");
await page.click("[data-form-save]"); await page.waitForTimeout(300);
console.log("cut rows:", before, "→", await rows(), "| page errors:", errs.length ? errs : "none");
await shot("drive-example");
await b.close();
