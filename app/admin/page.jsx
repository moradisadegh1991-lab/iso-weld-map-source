"use client";
import { useEffect, useState } from "react";
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
  MANAGE_MEMBERS: "مدیریت اعضا", RECORD_HSE: "ثبت HSE", ISSUE_PERMIT: "صدور مجوز کار",
  MANAGE_CONTROLS: "کنترل پروژه", RECORD_QUALITY: "ثبت Punch و NCR", APPROVE_CONCESSION: "تأیید ارفاق (NCR)",
  RECORD_COMPLETIONS: "ثبت تکمیل", SIGN_MC: "امضای MC", MANAGE_PROCUREMENT: "خرید", CONTROL_DOCUMENTS: "کنترل مدارک",
  MANAGE_HANDOVER: "تحویل به نگهداری", RECORD_INSPECTION: "درخواست و امضای بازرسی", MANAGE_ITP: "تهیه و تأیید ITP",
};
const PARTY_FA = { contractor: "پیمانکار", company: "کارفرما", tpi: "بازرس شخص ثالث (TPI)" };

/**
 * The members, and the party each signs inspections for. Role says what a
 * person may do; party says on whose behalf they sign an inspection — a
 * company inspector and a contractor's QC can hold the same role.
 */
function Members({ projectId, call }) {
  const [rows, setRows] = useState(null);
  const [msg, setMsg] = useState(null);
  const load = () => call(`/api/project/members?projectId=${projectId}`).then((r) => setRows(r.members)).catch((e) => setMsg(e.message));
  useEffect(() => { if (projectId) load(); }, [projectId]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows) return msg ? <p className="err">{msg}</p> : null;
  return (
    <div className="card">
      <h2>اعضا و طرف بازرسی</h2>
      <p className="muted sm">طرف بازرسی تعیین می‌کند هر نفر نتیجهٔ بازرسی را از طرف چه کسی امضا می‌کند. بدون آن، شخص درخواست یا امضای بازرسی ثبت نمی‌کند.</p>
      {msg && <p className="err">{msg}</p>}
      <div className="wrap"><table className="dtable">
        <thead><tr><th>نام</th><th>ایمیل</th><th>نقش</th><th>طرف بازرسی</th></tr></thead>
        <tbody>{rows.map((m) => (
          <tr key={m.user_id}>
            <td>{m.display_name || "—"}</td><td className="mono sm">{m.email || "—"}</td><td>{ROLE_FA[m.role] || m.role}</td>
            <td><select aria-label={`طرف بازرسی ${m.display_name || m.email}`} value={m.inspection_party || ""} onChange={async (e) => {
              setMsg(null);
              try { await call("/api/project/members", { method: "POST", body: JSON.stringify({ projectId, userId: m.user_id, party: e.target.value || null }) }); load(); }
              catch (err) { setMsg(err.message); }
            }}>
              <option value="">— هیچ —</option>{Object.entries(PARTY_FA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></td>
          </tr>))}</tbody>
      </table></div>
    </div>
  );
}

export default function AdminPage() {
  const { project, role, projectId, call } = usePlatform();

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

      {can({ role }, ACTIONS.MANAGE_MEMBERS) && <Members projectId={projectId} call={call} />}

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
