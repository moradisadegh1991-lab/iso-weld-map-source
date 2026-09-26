"use client";
/**
 * One bar across every piping page, so the discipline reads as one workflow:
 * drawing → register → execution → NDT → test — not seven separate tools.
 */
const LINKS = [
  ["/piping/overview", "داشبورد پایپینگ"],
  ["/piping", "ایزومتریک و رجیستر جوش"],
  ["/piping/execution", "اجرا: اسپول، ساپورت"],
  ["/qc", "NDT و جوشکار"],
  ["/piping/joint", "سابقهٔ جوش"],
  ["/ndt-joints", "NDT ساپورت و سازه"],
  ["/inspection", "بازرسی (ITP)"],
  ["/completions", "پکیج تست"],
  ["/warehouse", "مواد"],
];

export default function PipingNav({ here }) {
  return (
    <nav aria-label="بخش‌های پایپینگ" style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "0 0 12px" }}>
      {LINKS.map(([href, title]) => (
        <a key={href} href={href} aria-current={href === here ? "page" : undefined}
           className={`btn ${href === here ? "" : "ghost"}`} style={{ fontSize: 13 }}>{title}</a>
      ))}
    </nav>
  );
}
