"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";

/**
 * Before the PO and after it: the material requisition and its tender, and
 * the vendor's structured data per tag. Rules: lib/procurement/tender.mjs.
 */
const MR_STATUS = { draft: ["warn", "پیش‌نویس"], issued: ["", "صادرشده — استعلام"], awarded: ["ok", "واگذار شد"], cancelled: ["", "لغو"] };
const TECH = { pending: "", acceptable: "ok", not_acceptable: "bad" };
const VDT = { no_class: "bad", no_template: "warn", awaiting: "", incomplete: "bad", review: "warn", returned: "warn", accepted: "ok" };

export default function Tender({ tab, bar }) {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/procurement/tender?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);

  async function post(body, { quiet = false } = {}) {
    setMsg(null);
    try {
      const r = await call("/api/procurement/tender", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      reload();
      return r || true;
    } catch (e) { if (quiet) throw e; setMsg(e.message); return false; }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const ctx = { data, post, mayBuy: can({ role }, ACTIONS.MANAGE_PROCUREMENT), mayHandover: can({ role }, ACTIONS.MANAGE_HANDOVER) };
  const open = data.mrs.filter((m) => m.status === "issued").length;
  const vdtOpen = data.vdt.tags.filter((t) => ["incomplete", "review"].includes(t.state.code)).length;

  return (
    <div className="page">
      <div className="pagehead">
        <h1>خرید و پیگیری</h1>
        <span className="sub">
          {tab === "tender" ? `${data.mrs.length} درخواست خرید · ${open} در استعلام` : `${data.vdt.tags.length} تگ تجهیز · ${vdtOpen} ارسال منتظر بررسی`}
        </span>
      </div>
      {bar}
      {msg && <p className="err">{msg}</p>}
      {tab === "tender" ? <Requisitions {...ctx} /> : <VendorData {...ctx} />}
    </div>
  );
}

// ── MR and tender ────────────────────────────────────────────────────────

function Requisitions({ data, post, mayBuy }) {
  const [open, setOpen] = useState(null);
  return (
    <div className="card">
      <h2>درخواست‌های خرید (MR)</h2>
      <p className="muted sm">ردیف‌ها فقط در پیش‌نویس تغییر می‌کنند؛ صدور، آن‌ها را به‌عنوان یک رویژن با دلیل ثابت می‌کند. پیشنهادی که به رویژن قبلی پاسخ داده، در رتبه‌بندی نمی‌آید.</p>
      {data.mrs.length === 0 ? <p className="empty-note">درخواست خریدی ثبت نشده.</p> : (
        <TableKit name="mr">
          <table className="dtable">
            <thead><tr><th>MR</th><th>عنوان</th><th>وضعیت</th><th>رویژن</th><th>ردیف</th><th>پیشنهاد</th><th>PO</th><th /></tr></thead>
            <tbody>
              {data.mrs.map((m) => (
                <tr key={m.id}>
                  <td className="mono">{m.mr_no}</td><td>{m.title}</td>
                  <td><span className={`pill ${MR_STATUS[m.status][0]}`}>{MR_STATUS[m.status][1]}</span></td>
                  <td className="mono">{m.current_rev ?? "—"}</td><td className="mono">{m.line_count}</td><td className="mono">{m.bid_count}</td>
                  <td className="mono">{m.po_no ? `${m.po_no} · ${m.awarded_vendor}` : "—"}</td>
                  <td><button className="btn ghost" onClick={() => setOpen(open === m.id ? null : m.id)}>{open === m.id ? "بستن" : "جزئیات"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableKit>
      )}
      {data.mrs.filter((m) => m.id === open).map((m) => <MrDetail key={m.id} m={m} data={data} post={post} may={mayBuy} />)}
      {mayBuy && <Fold title="درخواست خرید جدید"><NewMr post={post} /></Fold>}
    </div>
  );
}

function MrDetail({ m, data, post, may }) {
  const t = m.tender;
  const draft = m.status === "draft";
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3>{m.mr_no} — {m.title}</h3>
      <TableKit name="mr-lines" onDelete={may ? (lineId) => post({ kind: "mr-line-remove", lineId }) : undefined}
                canDelete={() => (draft ? true : "درخواست صادر شده؛ تغییر یعنی رویژن جدید")}>
        <table className="dtable">
          <thead><tr><th>#</th><th>کالا / تگ</th><th>شرح</th><th>مقدار</th><th>نیاز سایت</th></tr></thead>
          <tbody>
            {m.lines.map((l) => (
              <tr key={l.id} data-key={l.id}>
                <td className="mono">{l.line_no}</td><td className="mono">{l.item_code || l.tag_no}</td><td>{l.description || "—"}</td>
                <td className="mono">{l.qty} {l.uom}</td><td className="mono">{l.need_on || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableKit>
      {m.revisions.length > 0 && (
        <ul className="sm">{m.revisions.map((r) => <li key={r.rev}>Rev {r.rev} — {fa(r.issued_at)}{r.by_name && ` — ${r.by_name}`}: «{r.reason}»</li>)}</ul>
      )}
      {may && draft && <><MrLineForm m={m} data={data} post={post} /><IssueForm m={m} post={post} /></>}
      {may && m.status === "issued" && (
        <p><button className="btn ghost" onClick={() => post({ kind: "mr-revise", mrId: m.id })}>بازنگری (رویژن جدید)</button>
          <span className="muted sm"> پیشنهادهای Rev {m.current_rev} می‌مانند، ولی با صدور رویژن بعد دیگر رتبه نمی‌گیرند.</span></p>
      )}

      <h3>پیشنهادها</h3>
      {t.bids.length === 0 ? <p className="empty-note">پیشنهادی ثبت نشده.</p> : (
        <TableKit name="bids">
          <table className="dtable">
            <thead><tr><th>فروشنده</th><th>Rev</th><th>دریافت</th><th>اعتبار تا</th><th>قیمت</th><th>تحویل (هفته)</th><th>فنی</th><th>رتبه</th><th>چرا ارزیابی نمی‌شود</th><th /></tr></thead>
            <tbody>
              {t.bids.map((b) => (
                <tr key={b.id}>
                  <td>{b.vendorCode}<div className="muted sm">{b.bidRef || ""}</div></td>
                  <td className="mono">{b.mrRev}</td><td className="mono">{b.receivedOn}</td><td className="mono">{b.validUntil || "؟"}</td>
                  <td className="mono">{b.totalPrice === null ? "—" : `${b.totalPrice.toLocaleString("en-US")} ${b.currency || "؟"}`}</td>
                  <td className="mono">{b.deliveryWeeks ?? "—"}</td>
                  <td><span className={`pill ${TECH[b.techStatus]}`}>{data.techStatus[b.techStatus]}</span>{b.techNote && <div className="muted sm">{b.techNote}</div>}</td>
                  <td className="mono">{b.rank ?? "—"}{b.lowest && <span className="pill ok"> کمترین</span>}</td>
                  <td className="sm">{b.problems.join(" · ") || "—"}</td>
                  <td>{may && m.status !== "awarded" && <BidEval b={b} post={post} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableKit>
      )}
      {t.ranking.reason && t.bids.length > 0 && <p className="muted sm">رتبه‌بندی: {t.ranking.reason}</p>}
      {m.status === "awarded" && <p className="sm"><span className="pill ok">واگذار شد</span> PO {m.po_no} به {m.awarded_vendor} — {fa(m.awarded_at)}{m.justification && ` — دلیل: «${m.justification}»`}</p>}
      {may && m.status === "issued" && <>
        <Fold title="ثبت پیشنهاد"><BidForm m={m} data={data} post={post} /></Fold>
        <Fold title="واگذاری و صدور PO"><AwardForm m={m} post={post} /></Fold>
      </>}
    </div>
  );
}

function BidEval({ b, post }) {
  const [note, setNote] = useState("");
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      <button className="btn ghost" onClick={() => post({ kind: "bid-eval", bidId: b.id, techStatus: "acceptable" })}>قابل‌قبول</button>
      <input aria-label="دلیل مردودی" placeholder="دلیل مردودی" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: 140 }} />
      <button className="btn ghost" onClick={() => post({ kind: "bid-eval", bidId: b.id, techStatus: "not_acceptable", note })}>مردود</button>
    </div>
  );
}

function NewMr({ post }) {
  const blank = { mrNo: "", title: "", discipline: "" };
  const [f, setF] = useState(blank);
  return (
    <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "mr", ...f })) setF(blank); }}>
      <div className="grid2">
        <Field id="mr-no" label="شمارهٔ MR" value={f.mrNo} on={(v) => setF({ ...f, mrNo: v })} />
        <Field id="mr-title" label="عنوان" value={f.title} on={(v) => setF({ ...f, title: v })} />
        <Field id="mr-disc" label="رشته (اختیاری)" value={f.discipline} on={(v) => setF({ ...f, discipline: v })} />
      </div>
      <button className="btn">ثبت پیش‌نویس</button>
    </form>
  );
}

function MrLineForm({ m, data, post }) {
  const blank = { what: "", qty: "", needOn: "", description: "" };
  const [f, setF] = useState(blank);
  const opts = [...data.items.map((i) => [`i:${i.id}`, `${i.code} — ${i.description} (${i.uom})`]), ...data.tags.map((t) => [`t:${t.id}`, `تگ ${t.tag_no}`])];
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      const [k, id] = f.what.split(":");
      if (await post({ kind: "mr-line", mrId: m.id, itemId: k === "i" ? id : null, tagId: k === "t" ? id : null, qty: f.qty, needOn: f.needOn || null, description: f.description })) setF(blank);
    }}>
      <div className="grid2">
        <Select id={`ml-w-${m.id}`} label="کالا یا تگ" value={f.what} on={(v) => setF({ ...f, what: v })} opts={opts} blank="—" />
        <Field id={`ml-q-${m.id}`} label="مقدار" type="number" value={f.qty} on={(v) => setF({ ...f, qty: v })} />
        <Field id={`ml-n-${m.id}`} label="نیاز سایت" type="date" value={f.needOn} on={(v) => setF({ ...f, needOn: v })} />
        <Field id={`ml-d-${m.id}`} label="شرح" value={f.description} on={(v) => setF({ ...f, description: v })} />
      </div>
      <button className="btn ghost">افزودن ردیف</button>
    </form>
  );
}

function IssueForm({ m, post }) {
  const [reason, setReason] = useState("");
  return (
    <form style={{ marginTop: 8 }} onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "mr-issue", mrId: m.id, reason })) setReason(""); }}>
      <Field id={`mi-${m.id}`} label={m.current_rev === null ? "دلیل صدور (مثلاً «برای استعلام»)" : `چه چیزی نسبت به Rev ${m.current_rev} تغییر کرد`} value={reason} on={setReason} />
      <button className="btn">صدور Rev {m.current_rev === null ? 0 : m.current_rev + 1}</button>
    </form>
  );
}

function BidForm({ m, data, post }) {
  const blank = { vendorId: "", bidRef: "", receivedOn: today(), validUntil: "", currency: "", totalPrice: "", deliveryWeeks: "" };
  const [f, setF] = useState(blank);
  const on = (k) => (v) => setF({ ...f, [k]: v });
  return (
    <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "bid", mrId: m.id, ...f })) setF(blank); }}>
      <p className="muted sm">پیشنهاد به Rev {m.current_rev} ثبت می‌شود.</p>
      <div className="grid2">
        <Select id={`b-v-${m.id}`} label="فروشنده" value={f.vendorId} on={on("vendorId")} opts={data.vendors.map((v) => [v.id, `${v.code} — ${v.name}`])} blank="—" />
        <Field id={`b-r-${m.id}`} label="شمارهٔ پیشنهاد" value={f.bidRef} on={on("bidRef")} />
        <Field id={`b-d-${m.id}`} label="تاریخ دریافت" type="date" value={f.receivedOn} on={on("receivedOn")} />
        <Field id={`b-u-${m.id}`} label="اعتبار تا" type="date" value={f.validUntil} on={on("validUntil")} />
        <Field id={`b-c-${m.id}`} label="ارز" value={f.currency} on={on("currency")} />
        <Field id={`b-p-${m.id}`} label="قیمت کل" type="number" value={f.totalPrice} on={on("totalPrice")} />
        <Field id={`b-w-${m.id}`} label="زمان تحویل (هفته)" type="number" value={f.deliveryWeeks} on={on("deliveryWeeks")} />
      </div>
      <button className="btn">ثبت پیشنهاد</button>
    </form>
  );
}

function AwardForm({ m, post }) {
  const blank = { bidId: "", poNo: "", placedOn: today(), justification: "" };
  const [f, setF] = useState(blank);
  const on = (k) => (v) => setF({ ...f, [k]: v });
  const ok = m.tender.bids.filter((b) => b.problems.length === 0);
  const chosen = ok.find((b) => b.id === f.bidId);
  return (
    <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "award", mrId: m.id, ...f })) setF(blank); }}>
      <p className="muted sm">فقط پیشنهاد قابل‌ارزیابی برنده می‌شود. اگر کمترین قیمت نیست — یا رتبه‌بندی ممکن نیست — دلیل لازم است. PO از ردیف‌های Rev {m.current_rev} ساخته می‌شود.</p>
      <div className="grid2">
        <Select id={`a-b-${m.id}`} label="پیشنهاد برنده" value={f.bidId} on={on("bidId")}
                opts={ok.map((b) => [b.id, `${b.vendorCode} — ${b.totalPrice?.toLocaleString("en-US")} ${b.currency}${b.lowest ? " (کمترین)" : ""}`])} blank="—" />
        <Field id={`a-p-${m.id}`} label="شمارهٔ PO" value={f.poNo} on={on("poNo")} />
        <Field id={`a-d-${m.id}`} label="تاریخ PO" type="date" value={f.placedOn} on={on("placedOn")} />
      </div>
      {chosen && !chosen.lowest && <Field id={`a-j-${m.id}`} label="دلیل انتخاب (کمترین قیمت نیست)" value={f.justification} on={on("justification")} />}
      <button className="btn">واگذاری و صدور PO</button>
    </form>
  );
}

// ── Vendor Data Template ─────────────────────────────────────────────────

function VendorData({ data, post, mayBuy, mayHandover }) {
  const [open, setOpen] = useState(null);
  const v = data.vdt;
  return (
    <>
      <div className="card">
        <h2>قالب‌های VDT</h2>
        <p className="muted sm">فهرست مشخصات هر کلاس ISO 14224 را پروژه تعیین می‌کند — در پلتفرم فهرست پیش‌فرضی نیست. کلیدهای manufacturer، model، serial_no و year_built پس از پذیرش به شناسنامهٔ نگهداری می‌روند.</p>
        {v.templates.length === 0 ? <p className="empty-note">قالبی تعریف نشده.</p> : (
          <TableKit name="vdt-templates">
            <table className="dtable">
              <thead><tr><th>کلاس</th><th>Rev</th><th>مشخصات</th><th>دلیل</th></tr></thead>
              <tbody>
                {v.templates.map((t) => (
                  <tr key={t.id}>
                    <td className="mono">{t.iso_class}<div className="muted sm">{data.isoClasses[t.iso_class] || ""}</div></td>
                    <td className="mono">{t.rev}</td>
                    <td className="sm">{t.attributes.map((a) => `${a.label}${a.unit ? ` (${a.unit})` : ""}${a.required ? " *" : ""}`).join("، ")}</td>
                    <td className="sm">{t.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableKit>
        )}
        {mayHandover && <Fold title="تعریف یا بازنگری قالب"><TemplateForm data={data} post={post} /></Fold>}
      </div>

      <div className="card">
        <h2>دادهٔ فنی وندور به تفکیک تگ</h2>
        <TableKit name="vdt-tags">
          <table className="dtable">
            <thead><tr><th>تگ</th><th>کلاس</th><th>PO</th><th>وضعیت</th><th>آخرین ارسال</th><th /></tr></thead>
            <tbody>
              {v.tags.map((t) => (
                <tr key={t.id}>
                  <td className="mono">{t.tag_no}</td><td className="mono">{t.iso_class || "؟"}</td><td className="mono">{t.po_no || "—"}</td>
                  <td><span className={`pill ${VDT[t.state.code]}`}>{t.state.text}</span>
                    {t.outdated && <div className="muted sm">به Rev {t.latest.template_rev} قالب پاسخ داده؛ قالب جاری Rev {t.templateRev}</div>}
                    {t.state.problems && <div className="muted sm">{t.state.problems.join(" · ")}</div>}</td>
                  <td className="sm">{t.latest ? `${t.latest.submitted_on?.slice?.(0, 10) || ""} ${t.latest.vendor_ref || ""}` : "—"}
                    {t.latest?.review_note && <div className="muted">{t.latest.review_note}</div>}</td>
                  <td>{t.templateRev !== null && (mayBuy || mayHandover) &&
                    <button className="btn ghost" onClick={() => setOpen(open === t.id ? null : t.id)}>{open === t.id ? "بستن" : "ثبت / بررسی"}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableKit>
        {v.tags.filter((t) => t.id === open).map((t) => (
          <div key={t.id} className="card" style={{ marginTop: 12 }}>
            <h3>{t.tag_no}</h3>
            {t.latest && t.latest.status === "submitted" && mayHandover && <Review t={t} post={post} />}
            {mayBuy && <SubmitForm t={t} template={v.templates.find((x) => x.iso_class === t.iso_class)} post={post} />}
          </div>
        ))}
      </div>
    </>
  );
}

function TemplateForm({ data, post }) {
  const blank = { isoClass: "", rows: "", reason: "" };
  const [f, setF] = useState(blank);
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      const attributes = f.rows.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
        const [key, label, unit, type, required] = l.split("|").map((x) => x.trim());
        return { key, label, unit, type: type || "text", required: /^(1|yes|y|true|\*|بله)$/i.test(required || "") };
      });
      if (await post({ kind: "vdt-template", isoClass: f.isoClass, attributes, reason: f.reason })) setF(blank);
    }}>
      <Select id="vt-c" label="کلاس ISO 14224" value={f.isoClass} on={(v) => setF({ ...f, isoClass: v })}
              opts={Object.entries(data.isoClasses).map(([k, t]) => [k, `${k} — ${t}`])} blank="—" />
      <div className="field"><label htmlFor="vt-r">مشخصات — هر خط: key | عنوان | واحد | number یا text | * برای اجباری</label>
        <textarea id="vt-r" dir="ltr" rows={6} value={f.rows} onChange={(e) => setF({ ...f, rows: e.target.value })}
                  placeholder={"manufacturer | Manufacturer | | text | *\nrated_flow | Rated flow | m3/h | number | *"} /></div>
      <Field id="vt-reason" label="دلیل (قالب شرکت، تغییر نسبت به رویژن قبل…)" value={f.reason} on={(v) => setF({ ...f, reason: v })} />
      <button className="btn">ثبت رویژن قالب</button>
    </form>
  );
}

function SubmitForm({ t, template, post }) {
  const [vals, setVals] = useState({});
  const [meta, setMeta] = useState({ vendorRef: "", submittedOn: today() });
  if (!template) return null;
  return (
    <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "vdt-submit", tagId: t.id, values: vals, ...meta })) setVals({}); }}>
      <p className="muted sm">دادهٔ ناقص هم ثبت می‌شود — ولی تا کامل نشود پذیرفته نمی‌شود. قالب Rev {template.rev}.</p>
      <div className="grid2">
        {template.attributes.map((a) => (
          <Field key={a.key} id={`vs-${t.id}-${a.key}`} label={`${a.label}${a.unit ? ` (${a.unit})` : ""}${a.required ? " *" : ""}`}
                 type={a.type === "number" ? "text" : "text"} value={vals[a.key] || ""} on={(v) => setVals({ ...vals, [a.key]: v })} />
        ))}
        <Field id={`vs-${t.id}-ref`} label="شمارهٔ ترنسمیتال وندور" value={meta.vendorRef} on={(v) => setMeta({ ...meta, vendorRef: v })} />
        <Field id={`vs-${t.id}-on`} label="تاریخ دریافت" type="date" value={meta.submittedOn} on={(v) => setMeta({ ...meta, submittedOn: v })} />
      </div>
      <button className="btn">ثبت ارسال وندور</button>
    </form>
  );
}

function Review({ t, post }) {
  const [note, setNote] = useState("");
  const [diff, setDiff] = useState(null);
  const [err, setErr] = useState(null);
  async function accept(confirmDifferences = false) {
    setErr(null);
    try { await post({ kind: "vdt-review", submissionId: t.latest.id, decision: "accepted", confirmDifferences }, { quiet: true }); setDiff(null); }
    catch (e) { if (e.body?.code === "VDT_DIFFERS" || /فرق دارد/.test(e.message)) setDiff(e.message); else setErr(e.message); }
  }
  return (
    <div style={{ marginBottom: 12 }}>
      <p className="sm">ارسال {t.latest.vendor_ref || ""}: {Object.entries(t.latest.values).map(([k, v]) => `${k}=${v}`).join(" · ")}</p>
      {err && <p className="err">{err}</p>}
      {diff ? <>
        <p className="err">{diff}</p>
        <button className="btn" onClick={() => accept(true)}>تأیید تغییرات و پذیرش</button>
      </> : <button className="btn" onClick={() => accept(false)}>پذیرش</button>}
      <span style={{ marginInlineStart: 12 }}>
        <input aria-label="دلیل برگشت" placeholder="دلیل برگشت" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn ghost" onClick={() => post({ kind: "vdt-review", submissionId: t.latest.id, decision: "returned", note })}>برگشت به وندور</button>
      </span>
    </div>
  );
}

// ── small parts ──────────────────────────────────────────────────────────

function Select({ id, label, value, on, opts, blank }) {
  return (
    <div className="field"><label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => on(e.target.value)}>
        {blank !== undefined && <option value="">{blank}</option>}
        {opts.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
      </select></div>
  );
}

function Field({ id, label, value, on, type = "text" }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} step={type === "number" ? "any" : undefined} dir={type === "text" ? "auto" : "ltr"} value={value} onChange={(e) => on(e.target.value)} />
    </div>
  );
}

const today = () => new Date().toISOString().slice(0, 10);
const fa = (d) => (d ? new Date(d).toLocaleDateString("fa-IR") : "—");
