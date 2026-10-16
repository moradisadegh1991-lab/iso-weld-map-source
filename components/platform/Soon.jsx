"use client";
import Link from "next/link";
import { ALL_ITEMS } from "../../lib/platform/navigation.mjs";

/**
 * A section that is declared but not built.
 *
 * It exists as a real route rather than a dead menu entry because the menu
 * shows planned work on purpose — a platform that shows only what exists
 * gives no sense of where it is going. What it must not do is pretend: this
 * says plainly that nothing is here yet, and what it is waiting for.
 */
export default function Soon({ href }) {
  const item = ALL_ITEMS.find((i) => i.href === href);
  return (
    <div className="page">
      <div className="pagehead">
        <h1>{item?.title || "بخش"}</h1>
        <span className="sub">{item?.desc}</span>
      </div>
      <div className="card">
        <h2>هنوز ساخته نشده</h2>
        <p className="muted sm">
          این بخش در نقشهٔ سامانه هست ولی هنوز پیاده نشده. آنچه لازم دارد،
          همان دو چیزی است که هر رشته را از بقیه جدا می‌کند: <b>اسکیمای استخراج</b>
          {" "}و <b>قواعد مهندسی</b> که موتور قطعی‌اش به آن پاسخ می‌دهد. بقیهٔ
          مسیر — مراحل، دسترسی، ساب‌سیستم، پیمانکار، گزارش — از قبل مشترک است.
        </p>
        <div>
          <Link className="btn ghost" href="/">بازگشت به میز کار</Link>
        </div>
      </div>
    </div>
  );
}
