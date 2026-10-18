"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";
import FormNo from "../../components/ui/FormNo";
import { usePrefs } from "../../lib/client/prefs.mjs";

/**
 * Before the PO and after it: the material requisition and its tender, and
 * the vendor's structured data per tag. Rules: lib/procurement/tender.mjs.
 */
// tones; the words are pu.mr.<status>
const MR_STATUS = { draft: "warn", issued: "", awarded: "ok", cancelled: "" };
const TECH = { pending: "", acceptable: "ok", not_acceptable: "bad" };
const VDT = { no_class: "bad", no_template: "warn", awaiting: "", incomplete: "bad", review: "warn", returned: "warn", accepted: "ok" };

export default function Tender({ tab, bar, goVendors }) {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/procurement/tender?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  const { t } = usePrefs();

  async function post(body, { quiet = false } = {}) {
    setMsg(null);
    try {
      const r = await call("/api/procurement/tender", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      reload();
      return r || true;
    } catch (e) { if (quiet) throw e; setMsg(e.message); return false; }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">{t("common.loading")}</p>;
  const ctx = { data, post, goVendors, mayBuy: can({ role }, ACTIONS.MANAGE_PROCUREMENT), mayHandover: can({ role }, ACTIONS.MANAGE_HANDOVER) };
  const open = data.mrs.filter((m) => m.status === "issued").length;
  const vdtOpen = data.vdt.tags.filter((x) => ["incomplete", "review"].includes(x.state.code)).length;

  return (
    <div className="page">
      <div className="pagehead">
        <h1>{t("pu.title")}</h1>
        <span className="sub">
          {tab === "tender" ? t("pu.mr.sub", { n: data.mrs.length, open }) : t("pu.vdt.sub", { n: data.vdt.tags.length, open: vdtOpen })}
        </span>
      </div>
      {bar}
      {msg && <p className="err">{msg}</p>}
      {tab === "tender" ? <Requisitions {...ctx} /> : <VendorData {...ctx} />}
    </div>
  );
}

// ── MR and tender ────────────────────────────────────────────────────────

function Requisitions({ data, post, mayBuy, goVendors }) {
  const [open, setOpen] = useState(null);
  const { t } = usePrefs();
  return (
    <div className="card">
      <h2>{t("pu.mr.title")}</h2>
      <p className="muted sm">{t("pu.mr.note")}</p>
      {data.mrs.length === 0 ? <p className="empty-note">{t("pu.mr.empty")}</p> : (
        <TableKit name="mr">
          <table className="dtable">
            <thead><tr><th>MR</th><th>{t("c.title")}</th><th>{t("c.status")}</th><th>{t("c.revision")}</th><th>{t("pu.mr.lines")}</th><th>{t("pu.mr.bids")}</th><th>PO</th><th /></tr></thead>
            <tbody>
              {data.mrs.map((m) => (
                <tr key={m.id}>
                  <td className="mono">{m.mr_no}</td><td>{m.title}</td>
                  <td><span className={`pill ${MR_STATUS[m.status]}`}>{t(`pu.mr.${m.status}`)}</span></td>
                  <td className="mono">{m.current_rev ?? "—"}</td><td className="mono">{m.line_count}</td><td className="mono">{m.bid_count}</td>
                  <td className="mono">{m.po_no ? `${m.po_no} · ${m.awarded_vendor}` : "—"}</td>
                  <td><button className="btn ghost" onClick={() => setOpen(open === m.id ? null : m.id)}>{open === m.id ? t("common.close") : t("pu.details")}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableKit>
      )}
      {data.mrs.filter((m) => m.id === open).map((m) => <MrDetail key={m.id} m={m} data={data} post={post} may={mayBuy} goVendors={goVendors} />)}
      {mayBuy && <Fold title={t("pu.mr.new")}><NewMr post={post} /></Fold>}
    </div>
  );
}

function MrDetail({ m, data, post, may, goVendors }) {
  const td = m.tender;
  const draft = m.status === "draft";
  const { t, L, date, num } = usePrefs();
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3>{m.mr_no} — {m.title}</h3>
      <TableKit name="mr-lines" onDelete={may ? (lineId) => post({ kind: "mr-line-remove", lineId }) : undefined}
                canDelete={() => (draft ? true : t("pu.mr.issuedLocked"))}>
        <table className="dtable">
          <thead><tr><th>#</th><th>{t("pu.mr.itemTag")}</th><th>{t("c.description")}</th><th>{t("pu.h.qty")}</th><th>{t("pu.h.need")}</th><th>FAT</th></tr></thead>
          <tbody>
            {m.lines.map((l) => (
              <tr key={l.id} data-key={l.id}>
                <td className="mono">{l.line_no}</td><td className="mono">{l.item_code || l.tag_no}</td><td>{l.description || "—"}</td>
                <td className="mono">{l.qty} {l.uom}</td><td className="mono">{l.need_on ? date(l.need_on) : "—"}</td>
                <td className="sm">{l.fat_required ? <span className="pill">{t("pu.required")}</span> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableKit>
      {m.revisions.length > 0 && (
        <ul className="sm">{m.revisions.map((r) => <li key={r.rev}>Rev {r.rev} — {date(r.issued_at)}{r.by_name && ` — ${r.by_name}`}: «{r.reason}»</li>)}</ul>
      )}
      {may && draft && <><MrLineForm m={m} data={data} post={post} /><IssueForm m={m} post={post} /></>}
      {may && m.status === "issued" && (
        <p><button className="btn ghost" onClick={() => post({ kind: "mr-revise", mrId: m.id })}>{t("pu.mr.revise")}</button>
          <span className="muted sm"> {t("pu.mr.reviseNote", { rev: m.current_rev })}</span></p>
      )}

      <h3>{t("pu.bid.title")}</h3>
      {td.bids.length === 0 ? <p className="empty-note">{t("pu.bid.empty")}</p> : (
        <TableKit name="bids">
          <table className="dtable">
            <thead><tr><th>{t("pu.f.vendor")}</th><th>Rev</th><th>{t("pu.bid.received")}</th><th>{t("pu.bid.validUntil")}</th><th>{t("pu.bid.price")}</th><th>{t("pu.bid.weeks")}</th><th>{t("pu.bid.tech")}</th><th>{t("pu.bid.rank")}</th><th>{t("pu.bid.whyNot")}</th><th /></tr></thead>
            <tbody>
              {td.bids.map((b) => (
                <tr key={b.id}>
                  <td>{b.vendorCode}<div className="muted sm">{b.bidRef || ""}</div></td>
                  <td className="mono">{b.mrRev}</td><td className="mono">{date(b.receivedOn)}</td><td className="mono">{b.validUntil ? date(b.validUntil) : "?"}</td>
                  <td className="mono">{b.totalPrice === null ? "—" : `${num(b.totalPrice)} ${b.currency || "?"}`}</td>
                  <td className="mono">{b.deliveryWeeks ?? "—"}</td>
                  <td><span className={`pill ${TECH[b.techStatus]}`}>{L(`proc.tech.${b.techStatus}`, data.techStatus[b.techStatus])}</span>{b.techNote && <div className="muted sm">{b.techNote}</div>}</td>
                  <td className="mono">{b.rank ?? "—"}{b.lowest && <span className="pill ok"> {t("pu.bid.lowest")}</span>}</td>
                  <td className="sm">{b.problems.join(" · ") || "—"}</td>
                  <td>{may && m.status !== "awarded" && <BidEval b={b} post={post} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableKit>
      )}
      {td.ranking.reason && td.bids.length > 0 && <p className="muted sm">{t("pu.bid.ranking")} {td.ranking.reason}</p>}
      {m.status === "awarded" && <p className="sm"><span className="pill ok">{t("pu.mr.awarded")}</span> {t("pu.mr.awardedTo", { po: m.po_no, vendor: m.awarded_vendor, on: date(m.awarded_at) })}{m.justification && ` — ${t("pu.mr.reason")} «${m.justification}»`}</p>}
      {may && m.status === "issued" && <>
        <Fold title={t("pu.bid.record")}><BidForm m={m} data={data} post={post} goVendors={goVendors} /></Fold>
        <Fold title={t("pu.award.title")}><AwardForm m={m} post={post} /></Fold>
      </>}
    </div>
  );
}

function BidEval({ b, post }) {
  const [note, setNote] = useState("");
  const { t } = usePrefs();
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      <button className="btn ghost" onClick={() => post({ kind: "bid-eval", bidId: b.id, techStatus: "acceptable" })}>{t("pu.bid.acceptable")}</button>
      <input aria-label={t("pu.bid.rejectWhy")} placeholder={t("pu.bid.rejectWhy")} value={note} onChange={(e) => setNote(e.target.value)} style={{ width: 140 }} />
      <button className="btn ghost" onClick={() => post({ kind: "bid-eval", bidId: b.id, techStatus: "not_acceptable", note })}>{t("pu.bid.reject")}</button>
    </div>
  );
}

function NewMr({ post }) {
  const blank = { mrNo: "", title: "", discipline: "" };
  const [f, setF] = useState(blank);
  const { t } = usePrefs();
  return (
    <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "mr", ...f })) setF(blank); }}>
      <div className="grid2">
        <FormNo id="mr-no" form="mr" label={t("pu.mr.no")} value={f.mrNo} on={(v) => setF({ ...f, mrNo: v })} />
        <Field id="mr-title" label={t("c.title")} value={f.title} on={(v) => setF({ ...f, title: v })} />
        <Field id="mr-disc" label={t("pu.mr.discipline")} value={f.discipline} on={(v) => setF({ ...f, discipline: v })} />
      </div>
      <button className="btn">{t("pu.mr.saveDraft")}</button>
    </form>
  );
}

function MrLineForm({ m, data, post }) {
  const blank = { what: "", qty: "", needOn: "", description: "", fatRequired: false };
  const [f, setF] = useState(blank);
  const { t } = usePrefs();
  const opts = [...data.items.map((i) => [`i:${i.id}`, `${i.code} — ${i.description} (${i.uom})`]), ...data.tags.map((x) => [`t:${x.id}`, t("pu.tagNo", { no: x.tag_no })])];
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      const [k, id] = f.what.split(":");
      if (await post({ kind: "mr-line", mrId: m.id, itemId: k === "i" ? id : null, tagId: k === "t" ? id : null, qty: f.qty, needOn: f.needOn || null, description: f.description, fatRequired: f.fatRequired })) setF(blank);
    }}>
      <div className="grid2">
        <Select id={`ml-w-${m.id}`} label={t("pu.mr.itemOrTag")} value={f.what} on={(v) => setF({ ...f, what: v })} opts={opts} blank="—" />
        <Field id={`ml-q-${m.id}`} label={t("pu.h.qty")} type="number" value={f.qty} on={(v) => setF({ ...f, qty: v })} />
        <Field id={`ml-n-${m.id}`} label={t("pu.h.need")} type="date" value={f.needOn} on={(v) => setF({ ...f, needOn: v })} />
        <Field id={`ml-d-${m.id}`} label={t("c.description")} value={f.description} on={(v) => setF({ ...f, description: v })} />
        <label className="sm" style={{ alignSelf: "end" }}><input type="checkbox" checked={f.fatRequired} onChange={(e) => setF({ ...f, fatRequired: e.target.checked })} /> {t("pu.mr.fatReq")}</label>
      </div>
      <button className="btn ghost">{t("pu.f.addLine")}</button>
    </form>
  );
}

function IssueForm({ m, post }) {
  const [reason, setReason] = useState("");
  const { t } = usePrefs();
  return (
    <form style={{ marginTop: 8 }} onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "mr-issue", mrId: m.id, reason })) setReason(""); }}>
      <Field id={`mi-${m.id}`} label={m.current_rev === null ? t("pu.mr.issueWhy") : t("pu.mr.changedSince", { rev: m.current_rev })} value={reason} on={setReason} />
      <button className="btn">{t("pu.mr.issue", { rev: m.current_rev === null ? 0 : m.current_rev + 1 })}</button>
    </form>
  );
}

function BidForm({ m, data, post, goVendors }) {
  const blank = { vendorId: "", bidRef: "", receivedOn: today(), validUntil: "", currency: "", totalPrice: "", deliveryWeeks: "" };
  const [f, setF] = useState(blank);
  const on = (k) => (v) => setF({ ...f, [k]: v });
  const { t } = usePrefs();
  return (
    <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "bid", mrId: m.id, ...f })) setF(blank); }}>
      <p className="muted sm">{t("pu.bid.toRev", { rev: m.current_rev })}</p>
      <div className="grid2">
        <Select id={`b-v-${m.id}`} label={t("pu.f.vendor")} value={f.vendorId} on={on("vendorId")} opts={data.vendors.map((v) => [v.id, `${v.code} — ${v.name}`])} blank="—" />
        <Field id={`b-r-${m.id}`} label={t("pu.bid.ref")} value={f.bidRef} on={on("bidRef")} />
        <Field id={`b-d-${m.id}`} label={t("pu.bid.receivedOn")} type="date" value={f.receivedOn} on={on("receivedOn")} />
        <Field id={`b-u-${m.id}`} label={t("pu.bid.validUntil")} type="date" value={f.validUntil} on={on("validUntil")} />
        <Field id={`b-c-${m.id}`} label={t("pu.bid.currency")} value={f.currency} on={on("currency")} />
        <Field id={`b-p-${m.id}`} label={t("pu.bid.total")} type="number" value={f.totalPrice} on={on("totalPrice")} />
        <Field id={`b-w-${m.id}`} label={t("pu.bid.weeks")} type="number" value={f.deliveryWeeks} on={on("deliveryWeeks")} />
      </div>
      <p className="muted sm">{t("pu.f.noVendor")} <button type="button" className="linkish" onClick={goVendors}>{t("pu.f.goVendors")}</button> — {t("pu.bid.vendorOnce")}</p>
      <button className="btn">{t("pu.bid.record")}</button>
    </form>
  );
}

function AwardForm({ m, post }) {
  const blank = { bidId: "", poNo: "", placedOn: today(), justification: "" };
  const [f, setF] = useState(blank);
  const on = (k) => (v) => setF({ ...f, [k]: v });
  const ok = m.tender.bids.filter((b) => b.problems.length === 0);
  const chosen = ok.find((b) => b.id === f.bidId);
  const { t, num } = usePrefs();
  return (
    <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "award", mrId: m.id, ...f })) setF(blank); }}>
      <p className="muted sm">{t("pu.award.note", { rev: m.current_rev })}</p>
      <div className="grid2">
        <Select id={`a-b-${m.id}`} label={t("pu.award.bid")} value={f.bidId} on={on("bidId")}
                opts={ok.map((b) => [b.id, `${b.vendorCode} — ${num(b.totalPrice)} ${b.currency}${b.lowest ? ` (${t("pu.bid.lowest")})` : ""}`])} blank="—" />
        <FormNo id={`a-p-${m.id}`} form="po" label={t("pu.f.poNo")} value={f.poNo} on={on("poNo")} />
        <Field id={`a-d-${m.id}`} label={t("pu.award.poDate")} type="date" value={f.placedOn} on={on("placedOn")} />
      </div>
      {chosen && !chosen.lowest && <Field id={`a-j-${m.id}`} label={t("pu.award.why")} value={f.justification} on={on("justification")} />}
      <button className="btn">{t("pu.award.title")}</button>
    </form>
  );
}

// ── Vendor Data Template ─────────────────────────────────────────────────

function VendorData({ data, post, mayBuy, mayHandover }) {
  const [open, setOpen] = useState(null);
  const v = data.vdt;
  const { t, date } = usePrefs();
  return (
    <>
      <div className="card">
        <h2>{t("pu.vdt.templates")}</h2>
        <p className="muted sm">{t("pu.vdt.templatesNote")}</p>
        {v.templates.length === 0 ? <p className="empty-note">{t("pu.vdt.noTemplate")}</p> : (
          <TableKit name="vdt-templates">
            <table className="dtable">
              <thead><tr><th>{t("pu.vdt.class")}</th><th>Rev</th><th>{t("pu.vdt.attrs")}</th><th>{t("pu.vdt.reason")}</th></tr></thead>
              <tbody>
                {v.templates.map((x) => (
                  <tr key={x.id}>
                    <td className="mono">{x.iso_class}<div className="muted sm">{data.isoClasses[x.iso_class] || ""}</div></td>
                    <td className="mono">{x.rev}</td>
                    <td className="sm">{x.attributes.map((a) => `${a.label}${a.unit ? ` (${a.unit})` : ""}${a.required ? " *" : ""}`).join(t("c.sep"))}</td>
                    <td className="sm">{x.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableKit>
        )}
        {mayHandover && <Fold title={t("pu.vdt.defineFold")}><TemplateForm data={data} post={post} /></Fold>}
      </div>

      <div className="card">
        <h2>{t("pu.vdt.byTag")}</h2>
        <TableKit name="vdt-tags">
          <table className="dtable">
            <thead><tr><th>{t("c.tag")}</th><th>{t("pu.vdt.class")}</th><th>PO</th><th>{t("c.status")}</th><th>{t("pu.h.lastSub")}</th><th /></tr></thead>
            <tbody>
              {v.tags.map((x) => (
                <tr key={x.id}>
                  <td className="mono">{x.tag_no}</td><td className="mono">{x.iso_class || "?"}</td><td className="mono">{x.po_no || "—"}</td>
                  <td><span className={`pill ${VDT[x.state.code]}`}>{t(`pu.vdt.st.${x.state.code}`, { cls: x.iso_class, n: x.state.problems?.length || 0 })}</span>
                    {x.outdated && <div className="muted sm">{t("pu.vdt.outdated", { was: x.latest.template_rev, now: x.templateRev })}</div>}
                    {x.state.problems && <div className="muted sm">{x.state.problems.join(" · ")}</div>}</td>
                  <td className="sm">{x.latest ? `${x.latest.submitted_on ? date(x.latest.submitted_on) : ""} ${x.latest.vendor_ref || ""}` : "—"}
                    {x.latest?.review_note && <div className="muted">{x.latest.review_note}</div>}</td>
                  <td>{x.templateRev !== null && (mayBuy || mayHandover) &&
                    <button className="btn ghost" onClick={() => setOpen(open === x.id ? null : x.id)}>{open === x.id ? t("common.close") : t("pu.vdt.open")}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableKit>
        {v.tags.filter((x) => x.id === open).map((x) => (
          <div key={x.id} className="card" style={{ marginTop: 12 }}>
            <h3>{x.tag_no}</h3>
            {x.latest && x.latest.status === "submitted" && mayHandover && <Review t={x} post={post} />}
            {mayBuy && <SubmitForm t={x} template={v.templates.find((y) => y.iso_class === x.iso_class)} post={post} />}
          </div>
        ))}
      </div>
    </>
  );
}

function TemplateForm({ data, post }) {
  const blank = { isoClass: "", rows: "", reason: "" };
  const [f, setF] = useState(blank);
  const { t } = usePrefs();
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      const attributes = f.rows.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
        const [key, label, unit, type, required] = l.split("|").map((x) => x.trim());
        return { key, label, unit, type: type || "text", required: /^(1|yes|y|true|\*|بله)$/i.test(required || "") };   // i18n: «بله» is what a Persian user types for yes
      });
      if (await post({ kind: "vdt-template", isoClass: f.isoClass, attributes, reason: f.reason })) setF(blank);
    }}>
      <Select id="vt-c" label={t("pu.vdt.isoClass")} value={f.isoClass} on={(v) => setF({ ...f, isoClass: v })}
              opts={Object.entries(data.isoClasses).map(([k, t]) => [k, `${k} — ${t}`])} blank="—" />
      <div className="field"><label htmlFor="vt-r">{t("pu.vdt.rowsHelp")}</label>
        <textarea id="vt-r" dir="ltr" rows={6} value={f.rows} onChange={(e) => setF({ ...f, rows: e.target.value })}
                  placeholder={"manufacturer | Manufacturer | | text | *\nrated_flow | Rated flow | m3/h | number | *"} /></div>
      <Field id="vt-reason" label={t("pu.vdt.reasonHelp")} value={f.reason} on={(v) => setF({ ...f, reason: v })} />
      <button className="btn">{t("pu.vdt.saveTemplate")}</button>
    </form>
  );
}

function SubmitForm({ t, template, post }) {
  const [vals, setVals] = useState({});
  const [meta, setMeta] = useState({ vendorRef: "", submittedOn: today() });
  const { t: tr } = usePrefs();
  if (!template) return null;
  return (
    <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "vdt-submit", tagId: t.id, values: vals, ...meta })) setVals({}); }}>
      <p className="muted sm">{tr("pu.vdt.partialNote", { rev: template.rev })}</p>
      <div className="grid2">
        {template.attributes.map((a) => (
          <Field key={a.key} id={`vs-${t.id}-${a.key}`} label={`${a.label}${a.unit ? ` (${a.unit})` : ""}${a.required ? " *" : ""}`}
                 type={a.type === "number" ? "text" : "text"} value={vals[a.key] || ""} on={(v) => setVals({ ...vals, [a.key]: v })} />
        ))}
        <Field id={`vs-${t.id}-ref`} label={tr("pu.vdt.transmittal")} value={meta.vendorRef} on={(v) => setMeta({ ...meta, vendorRef: v })} />
        <Field id={`vs-${t.id}-on`} label={tr("pu.bid.receivedOn")} type="date" value={meta.submittedOn} on={(v) => setMeta({ ...meta, submittedOn: v })} />
      </div>
      <button className="btn">{tr("pu.vdt.saveSubmission")}</button>
    </form>
  );
}

function Review({ t, post }) {
  const [note, setNote] = useState("");
  const [diff, setDiff] = useState(null);
  const [err, setErr] = useState(null);
  const { t: tr } = usePrefs();
  async function accept(confirmDifferences = false) {
    setErr(null);
    try { await post({ kind: "vdt-review", submissionId: t.latest.id, decision: "accepted", confirmDifferences }, { quiet: true }); setDiff(null); }
    catch (e) { if (e.body?.code === "VDT_DIFFERS" || /فرق دارد/.test(e.message)) setDiff(e.message); else setErr(e.message); }   // i18n: matches the server's Persian message
  }
  return (
    <div style={{ marginBottom: 12 }}>
      <p className="sm">{tr("pu.vdt.submission", { ref: t.latest.vendor_ref || "" })} {Object.entries(t.latest.values).map(([k, v]) => `${k}=${v}`).join(" · ")}</p>
      {err && <p className="err">{err}</p>}
      {diff ? <>
        <p className="err">{diff}</p>
        <button className="btn" onClick={() => accept(true)}>{tr("pu.vdt.confirmAccept")}</button>
      </> : <button className="btn" onClick={() => accept(false)}>{tr("pu.vdt.accept")}</button>}
      <span style={{ marginInlineStart: 12 }}>
        <input aria-label={tr("pu.vdt.returnWhy")} placeholder={tr("pu.vdt.returnWhy")} value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn ghost" onClick={() => post({ kind: "vdt-review", submissionId: t.latest.id, decision: "returned", note })}>{tr("pu.vdt.returnToVendor")}</button>
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
