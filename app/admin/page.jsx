"use client";
import { useEffect, useState } from "react";
import { usePlatform } from "../../lib/client/platform.mjs";
import { ROLES, ACTIONS, can } from "../../lib/authz.mjs";
import { AREAS } from "../../lib/platform/areas.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";

/**
 * Users and access.
 *
 * A project admin invites people, sets each one's role (what they may do),
 * work areas (their menu, and where they may write) and inspection party,
 * sends a one-time link to set a password, ends sessions and removes
 * members. What reaches beyond this project — resetting a password that
 * exists, deactivating an account, the developer flag — is a developer's.
 *
 * The permission matrix is generated from lib/authz.mjs rather than written
 * out, so it cannot drift from the rules the server enforces.
 */
const ROLE_FA = { viewer: "بیننده", qc: "کنترل کیفیت", engineer: "مهندس", admin: "مدیر پروژه", designer: "طراح", contracts: "امور قراردادها", finance: "مالی", hr: "منابع انسانی", developer: "توسعه‌دهنده" };
const ROLE_HINT = {
  viewer: "فقط دیدن", qc: "ثبت کار سایت، NDT، Punch، بازرسی", engineer: "تأیید رجیستر و امضاهای مهندسی", admin: "همهٔ کارها + مدیریت کاربران پروژه", designer: "فقط پرتال طراح: ارسال ترانسمیتال و پاسخ به کامنت‌ها",
  contracts: "قرارداد و ردیف‌های پرداخت، تهیه و تأیید نهایی صورت وضعیت", finance: "پرداخت‌ها و گزارش مالی", hr: "پرسنل و کارکرد روزانه",
};
const PARTY_FA = { contractor: "پیمانکار", company: "کارفرما", tpi: "بازرس شخص ثالث (TPI)" };
const STATUS = { active: ["ok", "فعال"], invited: ["warn", "دعوت‌شده — منتظر تنظیم رمز"], no_password: ["warn", "بدون رمز"],
  locked: ["bad", "قفل (تلاش ناموفق)"], inactive: ["bad", "غیرفعال"] };
const ACTION_FA = {
  VIEW_PROJECT: "دیدن پروژه", UPLOAD_DOCUMENT: "بارگذاری مدرک", RUN_EXTRACTION: "اجرای استخراج", EDIT_EXTRACTION: "ویرایش استخراج",
  APPROVE_REGISTER: "تأیید رجیستر", ASSIGN_WELD: "ثبت کار سایت (جوش، مراحل)", RECORD_NDT: "ثبت NDT", MANAGE_WELDERS: "مدیریت جوشکاران",
  MANAGE_PIPING_CLASS: "مدیریت کلاس پایپینگ", DRAW_NDT_SAMPLE: "نمونه‌گیری NDT", MANAGE_MEMBERS: "مدیریت کاربران پروژه",
  RECORD_HSE: "ثبت HSE", ISSUE_PERMIT: "صدور مجوز کار", MANAGE_CONTROLS: "کنترل پروژه", RECORD_QUALITY: "ثبت Punch و NCR",
  APPROVE_CONCESSION: "تأیید ارفاق (NCR)", RECORD_COMPLETIONS: "ثبت تکمیل و پیش‌راه‌اندازی", SIGN_MC: "امضای MC و RFSU",
  MANAGE_PROCUREMENT: "خرید", CONTROL_DOCUMENTS: "کنترل مدارک", MANAGE_HANDOVER: "تحویل به نگهداری",
  RECORD_INSPECTION: "درخواست و امضای بازرسی", MANAGE_ITP: "تهیه و تأیید ITP",
  SUBMIT_DESIGN: "پرتال طراح: ارسال ترانسمیتال و پاسخ به کامنت",
  MANAGE_CONTRACTS: "قرارداد و ردیف‌های پرداخت", PREPARE_STATEMENT: "تهیه و ارسال صورت وضعیت", VERIFY_STATEMENT: "تأیید فنی صورت وضعیت",
  APPROVE_STATEMENT: "تأیید نهایی صورت وضعیت", MANAGE_FINANCE: "ثبت پرداخت", MANAGE_HR: "پرسنل و کارکرد", COMMENT: "کامنت در لاگ",
};

export default function AdminPage() {
  const { project, role, projectId, call, user } = usePlatform();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [link, setLink] = useState(null);           // { who, token, expiresAt, purpose }
  const [tab, setTab] = useState("users");
  const [open, setOpen] = useState(null);
  const may = can({ role }, ACTIONS.MANAGE_MEMBERS);

  const load = () => call(`/api/users?projectId=${projectId}`).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { if (projectId && may) load(); }, [projectId, may]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function post(body, done) {
    setMsg(null);
    try {
      const r = await call("/api/users", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      await load();
      done?.(r);
      return r;
    } catch (e) { setMsg(e.message); return null; }
  }

  return (
    <div className="page">
      <div className="pagehead">
        <h1>کاربران و دسترسی</h1>
        <span className="sub">{project ? `${project.code} — ${project.name}` : ""}</span>
      </div>
      <div className="ptabs no-print" role="tablist">
        <button role="tab" aria-selected={tab === "users"} onClick={() => setTab("users")}>کاربران</button>
        <button role="tab" aria-selected={tab === "contracts"} onClick={() => setTab("contracts")}>تخصیص به قرارداد</button>
        <button role="tab" aria-selected={tab === "roles"} onClick={() => setTab("roles")}>نقش‌ها و اختیارات</button>
      </div>
      {msg && <p className="err" role="alert">{msg}</p>}
      {link && <LinkBox link={link} onClose={() => setLink(null)} />}

      {tab === "roles" ? <Roles role={role} /> : !may ? (
        <p className="muted">مدیریت کاربران با مدیر پروژه است.</p>
      ) : err ? <p className="err">{err}</p> : !data ? <p className="muted">در حال بارگذاری…</p> : tab === "contracts" ? <ContractMembers data={data} post={post} /> : <>
        <div className="kpis">
          <Kpi v={data.members.length} l="عضو پروژه" />
          <Kpi v={data.members.filter((m) => m.status === "active").length} l="فعال" tone="ok" />
          <Kpi v={data.members.filter((m) => ["invited", "no_password"].includes(m.status)).length} l="منتظر تنظیم رمز" tone="warn" />
          <Kpi v={data.members.filter((m) => ["inactive", "locked"].includes(m.status)).length} l="غیرفعال یا قفل" tone="bad" />
        </div>

        {data.resetRequests?.length > 0 && <ResetRequests data={data} post={post} setLink={setLink} />}

        <Fold title="دعوت کاربر جدید" hint="حساب ساخته می‌شود و یک لینک یک‌بارمصرف برای تنظیم رمز می‌گیرید">
          <Invite data={data} onSubmit={(f) => post({ kind: "invite", ...f }, (r) => {
            if (r.link) setLink({ who: f.email, ...r.link });
          })} />
        </Fold>

        <div className="card">
          <h2>اعضای پروژه</h2>
          <TableKit name="users">
            <table className="dtable">
              <thead><tr><th>نام</th><th>ایمیل / نام کاربری</th><th>نقش</th><th>حوزه‌های کاری</th><th>طرف بازرسی</th><th>وضعیت</th><th>آخرین ورود</th><th /></tr></thead>
              <tbody>{data.members.map((m) => {
                const [tone, label] = STATUS[m.status];
                return [
                  <tr key={m.user_id}>
                    <td>{m.display_name || "—"}{m.user_id === user?.id && <span className="muted sm"> (شما)</span>}
                      {(m.job_title || m.company_code) && <div className="sm muted">{[m.job_title, m.specialty, m.company_code].filter(Boolean).join(" · ")}</div>}
                      {m.is_developer && <span className="role-pill developer" style={{ marginInlineStart: 6 }}>توسعه‌دهنده</span>}</td>
                    <td className="mono sm">{m.email || "—"}{m.username && <div className="muted">{m.username}</div>}</td>
                    <td><span className={`role-pill ${m.role}`}>{ROLE_FA[m.role]}</span></td>
                    <td className="sm">{m.areas.length ? m.areas.map((a) => AREAS[a]).join("، ") : <span className="muted">همه</span>}
                      {m.tiles?.length > 0 && m.role !== "admin" && <div><span className="pill warn">{m.tiles.length} تایل</span></div>}</td>
                    <td className="sm">{m.inspection_party ? PARTY_FA[m.inspection_party] : <span className="muted">—</span>}</td>
                    <td><span className={`pill ${tone}`}>{label}</span></td>
                    <td className="sm">{m.last_login_at ? new Date(m.last_login_at).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" }) : "—"}</td>
                    <td><button className="btn ghost" onClick={() => setOpen(open === m.user_id ? null : m.user_id)}>{open === m.user_id ? "بستن" : "ویرایش"}</button></td>
                  </tr>,
                  open === m.user_id && <tr key={m.user_id + "-x"}><td colSpan={8}>
                    <MemberPanel m={m} data={data} me={user?.id} post={post} setLink={setLink} onClose={() => setOpen(null)} />
                  </td></tr>,
                ];
              })}</tbody>
            </table>
          </TableKit>
        </div>

        <div className="card">
          <h2>توسعه‌دهندگان سامانه</h2>
          <p className="muted sm">به همهٔ پروژه‌ها و همهٔ اختیارات دسترسی دارند. این نقش از این صفحه فقط توسط یک توسعه‌دهنده داده می‌شود؛ اولین توسعه‌دهنده با
            {" "}<code dir="ltr">npm run auth:developer -- email</code> ساخته می‌شود.</p>
          {data.developers.length === 0 ? <p className="empty-note">توسعه‌دهنده‌ای تعریف نشده.</p> : (
            <ul className="sm" style={{ margin: 0, paddingInlineStart: 18 }}>
              {data.developers.map((d) => <li key={d.user_id}>{d.display_name || "—"} · <span className="mono" dir="ltr">{d.email}</span>{!d.is_active && " (غیرفعال)"}</li>)}
            </ul>
          )}
        </div>
      </>}
    </div>
  );
}

/**
 * "Forgot my password" requests from the sign-in page. Nothing is mailed:
 * the admin makes a one-time link here and gives it to the person directly
 * (phone, messenger), after making sure it is them who asked.
 */
function ResetRequests({ data, post, setLink }) {
  return (
    <div className="card" style={{ borderColor: "var(--warn)" }}>
      <h2>درخواست‌های بازیابی رمز ({data.resetRequests.length})</h2>
      <p className="sm muted">از صفحهٔ ورود («رمز را فراموش کرده‌ام») ثبت شده‌اند. پس از اطمینان از اینکه خود شخص درخواست داده، لینک یک‌بارمصرف بسازید و مستقیم به او بدهید.
        لینک {data.setupHours} ساعت اعتبار دارد و با تنظیم رمز تازه، همهٔ نشست‌های قبلی آن حساب بسته می‌شود.</p>
      <table className="dtable"><thead><tr><th>کاربر</th><th>ایمیل / نام کاربری</th><th>زمان درخواست</th><th /></tr></thead>
        <tbody>{data.resetRequests.map((r) => (
          <tr key={r.id}><td>{r.display_name || "—"}</td><td className="mono sm" dir="ltr">{r.email}{r.username && ` · ${r.username}`}</td>
            <td className="sm">{new Date(r.requested_at).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" })}</td>
            <td>{r.mayIssue
              ? <button className="btn" type="button" onClick={() => post({ kind: "link", userId: r.user_id }, (x) => setLink({ who: r.email, ...x.link }))}>ساخت لینک بازنشانی رمز</button>
              : <span className="sm muted">این کاربر در پروژهٔ دیگری هم هست؛ بازنشانی با توسعه‌دهنده است.</span>}
              <button className="btn ghost sm" type="button" onClick={() => confirm("این درخواست بدون ساخت لینک بسته شود؟") && post({ kind: "reset-dismiss", id: r.id })}>رد درخواست</button></td></tr>))}
        </tbody></table>
    </div>
  );
}

function Invite({ data, onSubmit }) {
  const blank = { email: "", displayName: "", role: "qc", areas: [], party: "" };
  const [f, setF] = useState(blank);
  return (
    <form onSubmit={async (e) => { e.preventDefault(); await onSubmit({ ...f, party: f.party || null }); setF(blank); }}
          style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="grid2">
        <div className="field"><label htmlFor="u-email">ایمیل</label>
          <input id="u-email" type="email" dir="ltr" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div className="field"><label htmlFor="u-name">نام و نام خانوادگی</label>
          <input id="u-name" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></div>
        <RoleSelect id="u-role" value={f.role} on={(role) => setF({ ...f, role })} roles={data.roles} />
        <PartySelect id="u-party" value={f.party} on={(party) => setF({ ...f, party })} />
      </div>
      <AreaPicker value={f.areas} on={(areas) => setF({ ...f, areas })} disabled={f.role === "admin"} />
      <div><button className="btn" type="submit">دعوت و ساخت لینک</button></div>
    </form>
  );
}

function Profile({ m, data, post }) {
  const [p, setP] = useState({ username: m.username || "", displayName: m.display_name || "", jobTitle: m.job_title || "", specialty: m.specialty || "",
    phone: m.phone || "", companyId: m.company_id || "" });
  const F = (k, l, dir) => (
    <div className="field"><label htmlFor={`pf-${k}-${m.user_id}`}>{l}</label>
      <input id={`pf-${k}-${m.user_id}`} dir={dir} value={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.value })} /></div>);
  return (
    <fieldset style={{ border: "1px solid var(--rule)", borderRadius: 8, padding: "8px 12px", margin: 0 }}>
      <legend className="sm muted" style={{ padding: "0 6px" }}>مشخصات کاربر</legend>
      <div className="grid2">
        {F("displayName", "نام و نام خانوادگی")}{F("username", "نام کاربری (برای ورود، کنار ایمیل)", "ltr")}
        {F("jobTitle", "عنوان شغلی")}{F("specialty", "حوزهٔ تخصص")}{F("phone", "تلفن", "ltr")}
        <div className="field"><label htmlFor={`pf-co-${m.user_id}`}>شرکت شاغل</label>
          <select id={`pf-co-${m.user_id}`} value={p.companyId} onChange={(e) => setP({ ...p, companyId: e.target.value })}>
            <option value="">—</option>{data.companies.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}</select></div>
      </div>
      <p className="sm muted">امضای تصویری (رسم‌شده یا اسکن‌شده) را خود کاربر در «امضای من» بارگذاری می‌کند{m.has_signature ? " — این کاربر امضا دارد." : " — هنوز امضایی ندارد."}
        رمز عبور با لینک یک‌بارمصرف تنظیم می‌شود و از دست مدیر نمی‌گذرد؛ کاربر رمز خود را از منوی کاربر ◄ «تغییر رمز عبور» عوض می‌کند.</p>
      <button className="btn" type="button" onClick={() => post({ kind: "profile", userId: m.user_id, ...p, companyId: p.companyId || null })}>ذخیرهٔ مشخصات</button>
    </fieldset>
  );
}

function ContractMembers({ data, post }) {
  const BLANK = { contractId: "", userId: "", position: "", access: "edit" };
  const [f, setF] = useState(BLANK);
  const contract = data.contracts.find((c) => c.id === f.contractId);
  // Only people of the contract's stakeholder companies are assigned to it.
  const eligible = contract ? data.members.filter((m) => m.company_id && (contract.companies || []).includes(m.company_id)) : [];
  return (
    <div className="card">
      <h2>تخصیص کاربر به قرارداد</h2>
      <p className="sm muted">فقط کاربرانی که «شرکت شاغل» آن‌ها در ذی‌نفعان قرارداد است (تعریف قرارداد ◄ ذی‌نفعان) به قرارداد تخصیص داده می‌شوند و فقط همان قراردادها را در بالای صفحه می‌بینند.
        هر کاربر در هر قرارداد یک سمت و یک سطح دسترسی دارد: «مشاهده» فقط می‌بیند و امضا می‌کند، «ثبت و ویرایش» گزارش و محتوا ثبت می‌کند، «مدیریت قرارداد» تعریف و منابع قرارداد را هم تغییر می‌دهد. دسترسی دقیق در گزارش‌ها (ایجاد، افزودن، ویرایش و حذف محتوا، امضا، برگشت، تأیید نهایی) از گروه‌های گردش کار گزارش می‌آید.</p>
      {data.contracts.length === 0 ? <p className="empty-note">قراردادی تعریف نشده.</p> : (
        <form className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }}
          onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "contract-member", ...f })) setF(BLANK); }}>
          <div className="field"><label htmlFor="cm-c">قرارداد</label><select id="cm-c" required value={f.contractId} onChange={(e) => setF({ ...f, contractId: e.target.value, userId: "" })}>
            <option value="">—</option>{data.contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no} — {c.title}</option>)}</select></div>
          <div className="field"><label htmlFor="cm-u">کاربر</label><select id="cm-u" required value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}>
            <option value="">{contract && !eligible.length ? "— کاربری از شرکت‌های ذی‌نفع نیست —" : "—"}</option>
            {eligible.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name || m.email}{m.company_code ? ` (${m.company_code})` : ""}</option>)}</select></div>
          <div className="field"><label htmlFor="cm-p">سمت در قرارداد</label><input id="cm-p" required value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} /></div>
          <div className="field"><label htmlFor="cm-a">سطح دسترسی</label><select id="cm-a" value={f.access} onChange={(e) => setF({ ...f, access: e.target.value })}>
            {Object.entries(data.contractAccess).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
          <button className="btn" type="submit">ثبت</button>
          {f.contractId && f.userId && data.contractMembers.some((x) => x.contract_id === f.contractId && x.user_id === f.userId) &&
            <span className="sm muted">این کاربر در این قرارداد هست؛ ثبت، سمت و دسترسی او را ویرایش می‌کند.</span>}
        </form>)}
      {data.contractMembers.length === 0 ? <p className="empty-note">هنوز کسی به قراردادی تخصیص داده نشده.</p> : (
        <table className="dtable"><thead><tr><th>قرارداد</th><th>کاربر</th><th>سمت</th><th>دسترسی</th><th /></tr></thead>
          <tbody>{data.contractMembers.map((x) => (
            <tr key={x.id}><td><span className="mono">{x.contract_no}</span> — {x.contract_title}</td><td>{x.display_name || x.email}</td><td>{x.position}</td>
              <td>{data.contractAccess[x.access]}</td><td>
                <button className="btn ghost sm" type="button" onClick={() => setF({ contractId: x.contract_id, userId: x.user_id, position: x.position, access: x.access })}>ویرایش</button>
                <button className="btn ghost sm" type="button" onClick={() => post({ kind: "contract-member-remove", id: x.id })}>حذف</button></td></tr>))}</tbody></table>)}
    </div>
  );
}

/**
 * The tiles a member is given, as on the launchpad: grouped, one per page or
 * form. None ticked: the member's role decides, as before. Some ticked: the
 * member sees only those tiles, and the server answers only what those pages
 * call — reading included.
 */
function TilePicker({ m, catalog = [], post }) {
  const [tiles, setTiles] = useState(m.tiles || []);
  const flip = (h) => setTiles(tiles.includes(h) ? tiles.filter((x) => x !== h) : [...tiles, h]);
  const changed = JSON.stringify([...tiles].sort()) !== JSON.stringify([...(m.tiles || [])].sort());
  return (
    <fieldset style={{ border: "1px solid var(--rule)", borderRadius: 8, padding: "8px 12px", margin: 0 }} data-tile-picker={m.user_id}>
      <legend className="sm muted" style={{ padding: "0 6px" }}>تایل‌های دسترسی ({tiles.length ? `${tiles.length} تایل` : "همهٔ صفحه‌های نقش"})</legend>
      {m.role === "admin" ? <p className="sm muted">مدیر پروژه به همهٔ تایل‌ها دسترسی دارد و محدود نمی‌شود.</p> : <>
        <p className="sm muted">هیچ تایلی انتخاب نشود: نقش کاربر تعیین می‌کند. با انتخاب تایل‌ها، کاربر فقط همان‌ها را می‌بیند و سرور هم به چیزی بیرون از آن‌ها (حتی خواندن) پاسخ نمی‌دهد.
          میز کار، امضای من و تغییر رمز همیشه می‌ماند.</p>
        {catalog.map((g) => (
          <details key={g.group} className="inlinefold" open={g.sections.some((sec) => sec.tiles.some((t) => tiles.includes(t.href)))}>
            <summary>{g.group} <span className="muted sm">({g.sections.flatMap((x) => x.tiles).filter((t) => tiles.includes(t.href)).length})</span></summary>
            {g.sections.map((sec) => (
              <div key={sec.key} style={{ margin: "4px 0 8px" }}>
                <b className="sm">{sec.icon} {sec.title}</b>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {sec.tiles.map((t) => (
                    <label key={t.href} className="sm" style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <input type="checkbox" checked={tiles.includes(t.href)} onChange={() => flip(t.href)} data-tile={t.href} />{t.form ? "⇄ " : ""}{t.title}</label>))}
                </div>
              </div>))}
          </details>))}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" type="button" disabled={!changed} onClick={() => post({ kind: "tiles", userId: m.user_id, tiles })}>ذخیرهٔ تایل‌ها</button>
          {tiles.length > 0 && <button className="btn ghost" type="button" onClick={() => setTiles([])}>برداشتن همهٔ محدودیت‌ها</button>}
        </div></>}
    </fieldset>
  );
}

function MemberPanel({ m, data, me, post, setLink, onClose }) {
  const [f, setF] = useState({ role: m.role, areas: m.areas, party: m.inspection_party || "" });
  const dev = data.iAmDeveloper;
  const linkLabel = m.has_password ? "لینک بازنشانی رمز" : "لینک تنظیم رمز";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Profile m={m} data={data} post={post} />
      <div className="grid2">
        <RoleSelect id={`r-${m.user_id}`} value={f.role} on={(role) => setF({ ...f, role })} roles={data.roles} />
        <PartySelect id={`p-${m.user_id}`} value={f.party} on={(party) => setF({ ...f, party })} />
      </div>
      <AreaPicker value={f.areas} on={(areas) => setF({ ...f, areas })} disabled={f.role === "admin"} />
      <TilePicker m={m} catalog={data.tileCatalog} post={post} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn" onClick={() => post({ kind: "update", userId: m.user_id, ...f, party: f.party || null }, onClose)}>ذخیرهٔ تغییرات</button>
        {m.is_active && (
          <button className="btn ghost" onClick={() => post({ kind: "link", userId: m.user_id }, (r) => setLink({ who: m.email, ...r.link }))}>{linkLabel}</button>
        )}
        {m.has_password && <button className="btn ghost" title="همهٔ نشست‌های این حساب باطل می‌شود"
          onClick={() => confirm("همهٔ نشست‌های این کاربر پایان یابد؟") && post({ kind: "revoke", userId: m.user_id })}>پایان همهٔ نشست‌ها</button>}
        {m.user_id !== me && <button className="btn ghost" style={{ color: "var(--bad)" }}
          onClick={() => confirm(`«${m.display_name || m.email}» از این پروژه حذف شود؟ حساب و پروژه‌های دیگرش سر جایش می‌ماند.`) && post({ kind: "remove", userId: m.user_id }, onClose)}>حذف از پروژه</button>}
      </div>
      {dev && m.user_id !== me && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", borderTop: "1px solid var(--rule)", paddingTop: 10 }}>
          <span className="muted sm" style={{ alignSelf: "center" }}>فقط توسعه‌دهنده:</span>
          <button className="btn ghost" onClick={() => post({ kind: "active", userId: m.user_id, active: !m.is_active })}>{m.is_active ? "غیرفعال کردن حساب" : "فعال کردن حساب"}</button>
          <button className="btn ghost" onClick={() => confirm(m.is_developer ? "نقش توسعه‌دهنده برداشته شود؟" : "این کاربر به همهٔ پروژه‌ها و همهٔ اختیارات دسترسی خواهد داشت. ادامه؟")
            && post({ kind: "developer", userId: m.user_id, value: !m.is_developer })}>{m.is_developer ? "برداشتن نقش توسعه‌دهنده" : "توسعه‌دهنده کردن"}</button>
        </div>
      )}
    </div>
  );
}

/** The one-time link, shown once. It is the account until it is used. */
function LinkBox({ link, onClose }) {
  const url = typeof window !== "undefined" ? `${window.location.origin}/setup?token=${link.token}` : "";
  const [copied, setCopied] = useState(false);
  return (
    <div className="card" style={{ borderColor: "var(--warn)" }}>
      <h2>{link.purpose === "reset" ? "لینک بازنشانی رمز" : "لینک تنظیم رمز"} — {link.who}</h2>
      <p className="sm">این لینک را فقط برای خود او بفرستید. یک بار کار می‌کند و تا {new Date(link.expiresAt).toLocaleString("fa-IR")} معتبر است.
        پس از بستن این کادر دوباره نشان داده نمی‌شود؛ در صورت نیاز لینک تازه بسازید.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input readOnly dir="ltr" value={url} onFocus={(e) => e.target.select()} style={{ flex: "1 1 360px", background: "var(--surf2)", border: "1px solid var(--rule)",
          borderRadius: 6, color: "var(--ink)", padding: "8px 10px", fontFamily: "var(--mono)", fontSize: 12 }} aria-label="لینک" />
        <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { /* select and copy by hand */ } }}>
          {copied ? "کپی شد ✓" : "کپی"}</button>
        <button className="btn ghost" onClick={onClose}>بستن</button>
      </div>
    </div>
  );
}

function RoleSelect({ id, value, on, roles }) {
  return (
    <div className="field"><label htmlFor={id}>نقش</label>
      <select id={id} value={value} onChange={(e) => on(e.target.value)}>
        {roles.map((r) => <option key={r} value={r}>{ROLE_FA[r]} — {ROLE_HINT[r]}</option>)}
      </select></div>
  );
}

function PartySelect({ id, value, on }) {
  return (
    <div className="field"><label htmlFor={id}>طرف بازرسی (امضا از طرف)</label>
      <select id={id} value={value || ""} onChange={(e) => on(e.target.value)}>
        <option value="">— هیچ —</option>{Object.entries(PARTY_FA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select></div>
  );
}

/** Work areas: none ticked means all. An admin always works in all. */
function AreaPicker({ value, on, disabled }) {
  const toggle = (a) => on(value.includes(a) ? value.filter((x) => x !== a) : [...value, a]);
  return (
    <fieldset style={{ border: "1px solid var(--rule)", borderRadius: 8, padding: "8px 12px", margin: 0 }} disabled={disabled}>
      <legend className="sm muted" style={{ padding: "0 6px" }}>
        حوزه‌های کاری {disabled ? "— مدیر پروژه در همهٔ حوزه‌هاست" : value.length ? `(${value.length})` : "— هیچ‌کدام علامت نخورده: همهٔ حوزه‌ها"}
      </legend>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 6 }}>
        {Object.entries(AREAS).map(([k, v]) => (
          <label key={k} className="sm" style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={value.includes(k)} onChange={() => toggle(k)} /> {v}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Roles({ role }) {
  return (
    <div className="card">
      <h2>اختیارات هر نقش</h2>
      <p className="muted sm">این جدول از <code className="mono">lib/authz.mjs</code> ساخته می‌شود، نه دستی — پس با قاعده‌ای که سرور اعمال می‌کند اختلاف پیدا نمی‌کند.
        نقش شما: <b>{ROLE_FA[role] || role || "—"}</b>. حوزهٔ کاری جدا از نقش است: نقش می‌گوید چه کاری، حوزه می‌گوید در کدام رشته.</p>
      <TableKit name="roles">
        <table className="dtable">
          <thead><tr><th>اختیار</th>{[...ROLES, "developer"].map((r) => <th key={r}>{ROLE_FA[r]}</th>)}</tr></thead>
          <tbody>{Object.entries(ACTIONS).map(([key, value]) => (
            <tr key={key}>
              <td>{ACTION_FA[key] || key}</td>
              {[...ROLES, "developer"].map((r) => <td key={r} className="mono">{can({ role: r }, value) ? <span style={{ color: "var(--ok)" }}>✓</span> : <span className="muted">—</span>}</td>)}
            </tr>
          ))}</tbody>
        </table>
      </TableKit>
    </div>
  );
}

function Kpi({ v, l, b, tone = "" }) {
  return <div className={`kpi ${tone}`}><span className="v">{v}</span><span className="l">{l}</span>{b && <span className="b">{b}</span>}</div>;
}
