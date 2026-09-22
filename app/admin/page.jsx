"use client";
import { usePlatform } from "../../lib/client/platform.mjs";
import { ROLES, ACTIONS, can } from "../../lib/authz.mjs";

/**
 * Who may do what.
 *
 * The matrix is generated from lib/authz.mjs rather than written out, so it
 * cannot drift from the rules the server actually enforces. A permissions
 * page that is maintained by hand is a permissions page that lies.
 */
const ROLE_FA = { viewer: "بیننده", qc: "کنترل کیفیت", engineer: "مهندس", admin: "مدیر" };
const ACTION_FA = {
  VIEW_PROJECT: "دیدن پروژه", UPLOAD_DOCUMENT: "بارگذاری مدرک",
  RUN_EXTRACTION: "اجرای استخراج", EDIT_EXTRACTION: "ویرایش استخراج",
  APPROVE_REGISTER: "تأیید رجیستر", ASSIGN_WELD: "تخصیص جوش",
  RECORD_NDT: "ثبت NDT", MANAGE_WELDERS: "مدیریت جوشکاران",
  MANAGE_PIPING_CLASS: "مدیریت کلاس پایپینگ", DRAW_NDT_SAMPLE: "نمونه‌گیری NDT",
  MANAGE_MEMBERS: "مدیریت اعضا",
};

export default function AdminPage() {
  const { project, role } = usePlatform();

  return (
    <div className="page">
      <div className="pagehead">
        <h1>کاربران و دسترسی</h1>
        <span className="sub">{project ? project.code : ""}</span>
      </div>

      <div className="card">
        <h2>اختیارات هر نقش</h2>
        <p className="muted sm">
          این جدول از <code className="mono">lib/authz.mjs</code> ساخته می‌شود، نه
          دستی — پس نمی‌تواند با قاعده‌ای که سرور واقعاً اعمال می‌کند اختلاف پیدا کند.
          نقش شما: <b>{ROLE_FA[role] || role || "—"}</b>
        </p>
        <div className="wrap">
          <table className="dtable">
            <thead>
              <tr>
                <th>اختیار</th>
                {ROLES.map((r) => <th key={r}>{ROLE_FA[r] || r}</th>)}
              </tr>
            </thead>
            <tbody>
              {Object.entries(ACTIONS).map(([key, value]) => (
                <tr key={key}>
                  <td>{ACTION_FA[key] || key}</td>
                  {ROLES.map((r) => (
                    <td key={r} className="mono">
                      {can({ role: r }, value)
                        ? <span style={{ color: "var(--ok)" }}>✓</span>
                        : <span className="muted">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>افزودن کاربر</h2>
        <p className="muted sm">
          حساب‌ها فعلاً از خط فرمان ساخته می‌شوند — عمداً، تا رمز عبور هرگز از
          مرورگر عبور نکند و هیچ حساب پیش‌فرضی روی یک نشانی اینترنتی باز نماند:
        </p>
        <p className="mono sm" dir="ltr">
          npm run auth:admin -- someone@example.com &apos;a-good-passphrase&apos; &apos;Name&apos;
        </p>
        <p className="muted sm">
          گام بعدی این بخش، Keycloak است. درز آن در
          {" "}<code className="mono">lib/authz.mjs</code> باز مانده: هیچ چیزِ پایین‌دستِ
          آن نمی‌داند چه چیزی هویت را تأیید کرده است.
        </p>
      </div>
    </div>
  );
}
