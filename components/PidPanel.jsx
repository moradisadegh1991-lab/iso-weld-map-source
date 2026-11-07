"use client";
import { useMemo, useState } from "react";
import TableKit from "./ui/TableKit";
import FormDialog from "./ui/FormDialog";
import ValidationPanel from "./ValidationPanel";
import { STATUS_FA } from "../lib/pid/review.mjs";
import { SYMBOLS } from "../lib/pid/vocab.mjs";

/**
 * The engineering panel of the P&ID workspace: Overview · Equipment · Instruments · Lines · Valves · Connectivity · Validation · Revision comparison.
 * Every record can be viewed (evidence, relationships, original vs corrected value, asset-link proposal), edited (a correction: the extracted value is kept
 * beside it), approved, rejected (with a reason) and located on the drawing. Nothing here approves by itself: each button is one person's explicit action,
 * and the server re-checks it (lib/db/repos/pid.mjs).
 */
const CLS_FA = { equipment: "تجهیز", instrument: "ابزار", line: "خط", valve: "شیر", inline: "قطعهٔ خط", connector: "اتصال بین‌برگی" };
const short = (u) => String(u || "").slice(0, 8);
const LOCKED = new Set(["approved"]);

function Status({ s }) { return <span className={`pill sm ${s === "approved" ? "ok" : s === "rejected" || s === "superseded" ? "" : s === "ambiguous" || s === "unresolved" ? "warn" : ""}`} data-status={s}>{STATUS_FA[s] || s}</span>; }

export default function PidPanel({ pid, data, selectedUid, onSelect, onGo, locked, docs, docId, onOpenDoc, canSign, onIngestFile }) {
  const [tab, setTab] = useState("overview"), [form, setForm] = useState(null), [reject, setReject] = useState(null), [err, setErr] = useState(""), [cmp, setCmp] = useState({ to: "", res: null, busy: false });
  const draft = data.draft, regs = data.registers, byUid = useMemo(() => new Map(draft.items.map((i) => [i.uid, i])), [draft]);
  const sel = byUid.get(selectedUid) || draft.edges.find((e) => e.uid === selectedUid) || null;
  const findingsOf = (uid) => data.validation.findings.filter((f) => f.entityUid === uid);
  const summ = data.validation.summary, rs = data.reviewSummary || {};
  const undecided = (rs.extracted || 0) + (rs.needs_review || 0) + (rs.unresolved || 0) + (rs.ambiguous || 0);

  const run = async (uid, action, extra) => { setErr(""); const r = await pid.act(uid, action, extra); if (r.error) setErr(r.error); return r; };
  const Row = ({ r, cells }) => {
    const rejected = r.status === "rejected", done = LOCKED.has(r.status) || locked;
    return (
      <tr data-pid-row={r.uid} data-pid-status={r.status} aria-selected={selectedUid === r.uid} className={selectedUid === r.uid ? "sel" : ""} onClick={() => onSelect(r.uid)} style={rejected ? { opacity: 0.55 } : undefined}>
        {cells}
        <td data-cell="status"><Status s={r.status} /></td>
        <td className="mono sm" dir="ltr" data-cell="conf">{r.confidence != null ? `${Math.round(r.confidence * 100)}%` : "—"}</td>
        <td className="mono sm" data-cell="findings">{r.findings?.length ? r.findings.length : "—"}</td>
        <td style={{ whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
          <button type="button" className="ghost sm" data-pid-go={r.uid} onClick={() => { onSelect(r.uid); onGo(r.uid); }}>روی نقشه</button>
          {!done && <button type="button" className="ghost sm" data-pid-edit={r.uid} onClick={() => setForm({ uid: r.uid })}>اصلاح</button>}
          {!done && !rejected && <button type="button" className="ghost sm" data-pid-approve={r.uid} disabled={pid.busy} onClick={() => run(r.uid, "approve")}>تأیید</button>}
          {!done && !rejected && <button type="button" className="ghost sm" data-pid-reject={r.uid} onClick={() => setReject({ uid: r.uid, reason: "" })}>رد</button>}
          {rejected && !locked && <button type="button" className="ghost sm" data-pid-reopen={r.uid} onClick={() => run(r.uid, "reopen")}>بازگشایی</button>}
        </td>
      </tr>);
  };
  const Head = ({ cols }) => <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}<th>وضعیت</th><th>اطمینان</th><th>یافته</th><th></th></tr></thead>;
  const Table = ({ name, cols, rows, cells }) => (rows.length === 0 ? <p className="muted sm" data-pid-empty={name}>رکوردی نیست.</p>
    : <TableKit name={`pid-${name}`}><table className="dtable" data-pid-table={name}><Head cols={cols} /><tbody>{rows.map((r) => <Row key={r.uid} r={r} cells={cells(r)} />)}</tbody></table></TableKit>);
  const link = (r) => (r.link ? ({ unique: "پیشنهاد اتصال به دارایی موجود", multiple: "چند دارایی؛ تعیین شخص", none: "دارایی موجود ندارد" }[r.link.state]) : "—");

  const Detail = () => {
    if (!sel) return <p className="muted sm" data-pid-detail="none">یک رکورد را روی نقشه یا از جدول انتخاب کنید.</p>;
    const isItem = byUid.has(sel.uid), rv = sel.review || {};
    const rels = isItem ? regs.connectivity.filter((c) => c.from === sel.uid || c.to === sel.uid) : [];
    return (
      <section className="pid-detail" data-pid-detail={sel.uid} style={{ borderTop: "1px solid var(--line)", marginTop: 8, paddingTop: 6 }}>
        <b>{isItem ? `${CLS_FA[sel.cls] || sel.cls} ${sel.tag || sel.printed || ""}` : `یال ${sel.type}`}</b> <Status s={rv.status || "extracted"} />
        <p className="mono sm muted" dir="ltr" style={{ margin: "2px 0" }}>uid {sel.uid} · {isItem ? `page ${sel.page} · symbol ${sel.symbol} · source ${sel.source?.kind}/${sel.source?.ref || "—"} · rev ${sel.source?.revision ?? "—"}` : sel.status}</p>
        {rv.original && <p className="sm" data-pid-original>مقدار استخراج‌شده: {Object.entries(rv.original).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v ?? "—"}`).join("، ")} ← اصلاح: {Object.entries(rv.corrected || {}).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join("، ")}</p>}
        {rv.by && <p className="muted sm" data-pid-by>{rv.status === "approved" ? "تأییدکننده" : "اقدام‌کننده"}: {short(rv.by)} · {rv.at}{rv.reason ? ` · ${rv.reason}` : ""}</p>}
        <b className="sm">شواهد</b>
        <ul className="sm" data-pid-evidence style={{ margin: "2px 0", paddingInlineStart: 18 }}>
          {(sel.evidence || []).length ? sel.evidence.map((e, i) => <li key={i}><span className="mono" dir="ltr">{e.kind}</span> «{e.text || "—"}»{e.confidence != null ? ` · ${Math.round(e.confidence * 100)}%` : ""}{e.bbox ? " · جعبه" : ""}</li>) : <li className="warnish">مدرکی ثبت نشده</li>}
        </ul>
        {isItem && (<><b className="sm">روابط</b>
          <ul className="sm" data-pid-relations style={{ margin: "2px 0", paddingInlineStart: 18 }}>
            {rels.length ? rels.map((c) => { const other = c.from === sel.uid ? c.to : c.from; return <li key={c.uid}>{c.type} ← <button type="button" className="ghost sm" data-pid-rel-go={other} onClick={() => { onSelect(other); onGo(other); }}>{(c.from === sel.uid ? c.toTag : c.fromTag) || short(other)}</button></li>; }) : <li className="muted">رابطهٔ مصرحی خوانده نشده</li>}
          </ul>
          <p className="sm" data-pid-link>اتصال به دارایی موجود: {link(regs[{ equipment: "equipment", instrument: "instruments", line: "lines", valve: "valves", inline: "valves" }[sel.cls]]?.find((r) => r.uid === sel.uid) || {})}</p></>)}
        {findingsOf(sel.uid).length > 0 && <ul className="sm" data-pid-findings style={{ margin: "2px 0", paddingInlineStart: 18 }}>{findingsOf(sel.uid).map((f) => <li key={f.id} className={f.severity === "error" ? "err" : ""} data-finding={f.code}>{f.message}</li>)}</ul>}
      </section>);
  };

  const compare = async () => {
    if (!cmp.to) return; setCmp((c) => ({ ...c, busy: true }));
    try { const r = await pid.session.call(`/api/pid?projectId=${pid.session.projectId}&documentId=${docId}&compareTo=${cmp.to}`); setCmp((c) => ({ ...c, res: r, busy: false, err: "" })); } catch (e) { setCmp((c) => ({ ...c, res: null, busy: false, err: e.message })); }
  };
  const siblings = docs.filter((d) => d.docNo === data.document.docNo && d.sheetNo === data.document.sheetNo && d.documentId !== docId && d.runId);

  const tabs = [
    ["overview", "نمای کلی"], ["equipment", `تجهیزات (${regs.equipment.length})`], ["instruments", `ابزار (${regs.instruments.length})`], ["lines", `خطوط (${regs.lines.length})`], ["valves", `شیرها (${regs.valves.length})`],
    ["connectivity", `اتصال‌ها (${regs.connectivity.length + regs.offpage.length})`], ["validation", `اعتبارسنجی (${summ.errors + summ.warnings})`], ["compare", "مقایسهٔ رویژن"],
  ];
  const editing = form && byUid.get(form.uid);
  return (
    <div className="pid-panel" data-pid-panel>
      <div className="row" role="tablist" style={{ gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
        {tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on sm" : "ghost sm"} data-pid-tab={k} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {err && <p className="err sm" data-pid-error>{err}</p>}
      {pid.notice && <p className="err sm" data-pid-notice>{pid.notice}</p>}

      {tab === "overview" && (
        <div data-pid-overview>
          <p className="sm"><b className="mono" dir="ltr">{data.document.docNo}</b> · رویژن {data.document.revision} · برگ {data.document.sheetNo} · صفحهٔ PDF {draft.page?.number}</p>
          <p className="sm">وضعیت پیش‌نویس: <b data-pid-run-status>{{ extracted: "استخراج‌شده (تأیید نشده)", approved: "تأییدشدهٔ نهایی", superseded: "جایگزین‌شده با رویژن" }[data.run.status] || data.run.status}</b>
            {data.run.approvedAt ? ` · ${short(data.run.approvedBy)} · ${data.run.approvedAt}` : ""}</p>
          <table className="dtable" data-pid-counts><tbody>
            {[["تجهیز", regs.equipment.length], ["ابزار", regs.instruments.length], ["خط", regs.lines.length], ["شیر/قطعهٔ خط", regs.valves.length], ["اتصال مصرح", regs.connectivity.length], ["اتصال بین‌برگی", regs.offpage.length]].map(([l, n]) => <tr key={l}><td>{l}</td><td className="mono">{n}</td></tr>)}
          </tbody></table>
          <p className="sm" data-pid-review-summary>بازبینی: {Object.entries(rs).map(([k, n]) => `${STATUS_FA[k] || k} ${n}`).join(" · ") || "—"}</p>
          <p className="sm" data-pid-validation-summary>اعتبارسنجی: {summ.errors} خطا · {summ.warnings} هشدار · {summ.info} اطلاع</p>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {canSign && !locked && <button type="button" data-pid-sign disabled={pid.busy || undecided > 0} title={undecided > 0 ? `${undecided} رکورد هنوز تعیین تکلیف نشده` : ""} onClick={async () => { const r = await pid.approveDraft(); if (r.error) setErr(r.error); }}>تأیید نهایی پیش‌نویس</button>}
            {undecided > 0 && <span className="muted sm" data-pid-undecided>{undecided} رکورد هنوز تعیین تکلیف نشده؛ هیچ‌چیز خودکار تأیید نمی‌شود.</span>}
          </div>
          <details style={{ marginTop: 8 }}><summary className="sm">ثبت خواندن (JSON خروجی OCR)</summary>
            <p className="muted sm" style={{ margin: "4px 0" }}>فایل <span className="mono" dir="ltr">pNNN.json</span> خروجی <span className="mono" dir="ltr">tools/pid-ocr.py</span> برای همین برگ؛ همان خواندن دوباره ثبت نمی‌شود.</p>
            <input type="file" accept="application/json" data-pid-ocr-file disabled={locked} onChange={(e) => onIngestFile(e.target.files?.[0])} />
          </details>
        </div>)}

      {tab === "equipment" && <Table name="equipment" cols={["تگ", "نماد", "اتصال دارایی"]} rows={regs.equipment} cells={(r) => [<td key="t" className="mono b" dir="ltr">{r.tag || "—"}</td>, <td key="s" className="sm" dir="ltr">{r.equipmentType}{r.legendType ? ` (لجند: ${r.legendType})` : ""}</td>, <td key="l" className="sm">{link(r)}</td>]} />}
      {tab === "instruments" && <Table name="instruments" cols={["تگ", "حروف", "حلقه"]} rows={regs.instruments} cells={(r) => [<td key="t" className="mono b" dir="ltr">{r.tag || "—"}</td>, <td key="a" className="mono sm" dir="ltr">{r.letters ?? "—"}</td>, <td key="b" className="mono sm" dir="ltr">{r.loop ?? "—"}</td>]} />}
      {tab === "lines" && <Table name="lines" cols={["شمارهٔ خط", "سایز", "کلاس", "سیال", "عایق"]} rows={regs.lines} cells={(r) => [<td key="t" className="mono b" dir="ltr">{r.lineNo || "—"}</td>, <td key="a" className="mono sm">{r.size ?? "—"}</td>, <td key="b" className="mono sm" dir="ltr">{r.pipingClass ?? "—"}</td>, <td key="c" className="mono sm" dir="ltr">{r.fluid ?? "—"}</td>, <td key="d" className="mono sm" dir="ltr">{r.insulation ?? "—"}</td>]} />}
      {tab === "valves" && <Table name="valves" cols={["تگ", "نوع (از نماد)", "سایز"]} rows={regs.valves} cells={(r) => [<td key="t" className="mono b" dir="ltr">{r.tag || "—"}</td>, <td key="a" className="sm" dir="ltr">{r.valveType}</td>, <td key="b" className="mono sm">{r.size ?? "—"}</td>]} />}

      {tab === "connectivity" && (
        <div data-pid-connectivity>
          <b className="sm">اتصال‌های مصرح (با مدرک)</b>
          {regs.connectivity.length === 0 ? <p className="muted sm" data-pid-empty="edges">هیچ اتصالی خوانده نشده؛ نزدیکی نمادها اتصال نیست.</p> :
            <TableKit name="pid-edges"><table className="dtable" data-pid-table="edges"><thead><tr><th>نوع</th><th>از</th><th>به</th><th>وضعیت</th><th>مدرک</th><th></th></tr></thead><tbody>
              {regs.connectivity.map((e) => (
                <tr key={e.uid} data-pid-row={e.uid} data-pid-edge-status={e.edgeStatus} aria-selected={selectedUid === e.uid} className={selectedUid === e.uid ? "sel" : ""} onClick={() => onSelect(e.uid)}>
                  <td className="mono sm" dir="ltr">{e.type}</td><td className="mono sm" dir="ltr">{e.fromTag || short(e.from)}</td><td className="mono sm" dir="ltr">{e.toTag || (e.to ? short(e.to) : "—")}</td>
                  <td><Status s={e.status} />{e.edgeStatus !== "explicit" && <span className="warnish sm"> {e.edgeStatus === "ambiguous" ? "مبهم" : "انتهای دوم نامعلوم"}</span>}</td>
                  <td className="sm">{(e.evidence || [])[0]?.text || <span className="warnish">—</span>}</td>
                  <td onClick={(ev) => ev.stopPropagation()}>{!locked && !LOCKED.has(e.status) && e.edgeStatus === "explicit" && <button type="button" className="ghost sm" data-pid-approve={e.uid} onClick={() => run(e.uid, "approve")}>تأیید</button>}
                    {!locked && !LOCKED.has(e.status) && e.status !== "rejected" && <button type="button" className="ghost sm" data-pid-reject={e.uid} onClick={() => setReject({ uid: e.uid, reason: "" })}>رد</button>}</td>
                </tr>))}</tbody></table></TableKit>}
          <b className="sm" style={{ display: "block", marginTop: 8 }}>اتصال‌های بین‌برگی</b>
          {regs.offpage.length === 0 ? <p className="muted sm" data-pid-empty="offpage">اتصال بین‌برگی خوانده نشده.</p> :
            <TableKit name="pid-offpage"><table className="dtable" data-pid-table="offpage"><thead><tr><th>مرجع چاپی</th><th>وضعیت حل</th><th>توضیح</th><th></th></tr></thead><tbody>
              {regs.offpage.map((o) => (<tr key={o.uid} data-pid-row={o.uid} data-offpage-status={o.status} aria-selected={selectedUid === o.uid} className={selectedUid === o.uid ? "sel" : ""} onClick={() => onSelect(o.uid)}>
                <td className="mono sm" dir="ltr">{o.ref || "—"}</td><td className={o.status === "resolved" ? "ok sm" : "warnish sm"}>{{ resolved: "حل‌شده", unresolved: "حل‌نشده", ambiguous: "مبهم", unconfirmed: "تأییدنشده توسط طرف مقابل" }[o.status]}</td><td className="sm">{o.why}</td>
                <td onClick={(ev) => ev.stopPropagation()}><button type="button" className="ghost sm" data-pid-go={o.uid} onClick={() => { onSelect(o.uid); onGo(o.uid); }}>روی نقشه</button></td></tr>))}</tbody></table></TableKit>}
        </div>)}

      {tab === "validation" && (
        <ValidationPanel draft={data.validation} saved={data.validation} source="saved" onSource={() => {}} onRefresh={pid.refresh} loading={pid.loading} error="" selectedUid={selectedUid}
          onSelect={(uid) => { onSelect(uid); onGo(uid); }} onOpen={(f) => { if (f.entityUid) { onSelect(f.entityUid); onGo(f.entityUid); } }} onResolve={null} locked resolveBusy={false} />)}

      {tab === "compare" && (
        <div data-pid-compare>
          {siblings.length === 0 ? <p className="muted sm" data-pid-empty="compare">رویژن دیگری از همین برگ با پیش‌نویس ثبت نشده است.</p> : (<>
            <div className="row" style={{ gap: 6, alignItems: "center" }}>
              <label className="sm">با رویژن <select data-pid-compare-to value={cmp.to} onChange={(e) => setCmp({ to: e.target.value, res: null, busy: false })}><option value="">—</option>{siblings.map((d) => <option key={d.documentId} value={d.documentId}>REV {d.revision}</option>)}</select></label>
              <button type="button" className="ghost sm" data-pid-compare-run disabled={!cmp.to || cmp.busy} onClick={compare}>مقایسه</button>
            </div>
            {cmp.err && <p className="err sm">{cmp.err}</p>}
            {cmp.res && (<>
              <p className="sm" data-pid-compare-summary>{Object.entries(cmp.res.summary).map(([k, n]) => `${k} ${n}`).join(" · ") || "بدون تغییر"} · مبدأ REV {cmp.res.from.revision} ← مقصد REV {cmp.res.to.revision}</p>
              <TableKit name="pid-compare"><table className="dtable" data-pid-table="compare"><thead><tr><th>تغییر</th><th>کلاس</th><th>مرجع</th><th>جزئیات</th><th></th></tr></thead><tbody>
                {cmp.res.changes.filter((c) => c.kind !== "unchanged").map((c, i) => (
                  <tr key={i} data-compare-kind={c.kind}><td className="mono sm" dir="ltr">{c.kind}</td><td className="sm">{CLS_FA[c.cls] || c.cls}</td><td className="mono sm" dir="ltr">{c.tag || "—"}</td>
                    <td className="sm">{c.reason || (c.fields || []).map((f) => `${f.field}: ${f.from ?? "—"} → ${f.to ?? "—"}`).join("، ") || (c.lost || c.gained ? `اتصال: ${(c.lost || []).length} کم، ${(c.gained || []).length} زیاد` : "")}</td>
                    <td>{c.kind === "candidate" && c.toUid && c.fromUid && !locked && !cmp.res.to.locked && <button type="button" className="ghost sm" data-compare-confirm={c.toUid} disabled={pid.busy} onClick={async () => { const r = await pid.confirmMapping(cmp.res.from.runId, c.fromUid, c.toUid); if (r.error) setErr(r.error); else compare(); }}>تأیید تطبیق</button>}</td></tr>))}
              </tbody></table></TableKit>
              <p className="muted sm">تطبیق خودکار انجام نمی‌شود: «کاندید» فقط وقتی به هم وصل می‌شود که شخص تأیید کند؛ نگاشت روی پیش‌نویس رویژن مقصد ذخیره می‌شود و هیچ شناسهٔ رویژن قبلی به مقصد کپی نمی‌شود.</p>
            </>)}</>)}
        </div>)}

      {["equipment", "instruments", "lines", "valves", "connectivity"].includes(tab) && <Detail />}

      {editing && (
        <FormDialog title={`اصلاح ${CLS_FA[editing.cls] || editing.cls} ${editing.tag || ""}`} mode="edit" dirty onSave={async () => { const v = {}; if (form.tag !== undefined && form.tag !== (editing.tag || "")) v.tag = form.tag.trim() || null; if (form.symbol !== undefined && form.symbol !== editing.symbol) v.symbol = form.symbol; if (!Object.keys(v).length) { setForm(null); return; } const r = await run(editing.uid, "correct", { value: v, reason: form.reason || null }); if (!r.error) setForm(null); }} onClose={() => setForm(null)} canEdit data-pid-form>
          <p className="muted sm">مقدار استخراج‌شده کنار مقدار اصلاح‌شده نگه داشته می‌شود و اصلاح ثبت (audit) می‌شود.</p>
          <div className="mk-grid">
            <label className="mk-f" data-form-field="tag"><span className="muted sm">تگ / شمارهٔ چاپی</span><input data-input="tag" dir="ltr" value={form.tag ?? editing.tag ?? ""} onChange={(e) => setForm({ ...form, tag: e.target.value })} /></label>
            <label className="mk-f" data-form-field="symbol"><span className="muted sm">نماد (فقط از روی نقشه؛ نه از حروف تگ)</span>
              <select data-input="symbol" dir="ltr" value={form.symbol ?? editing.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })}><option value="UNKNOWN">UNKNOWN</option>{(SYMBOLS[editing.cls] || []).map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
            <label className="mk-f" data-form-field="reason"><span className="muted sm">دلیل</span><input data-input="reason" value={form.reason ?? ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
          </div>
        </FormDialog>)}
      {reject && (
        <FormDialog title="ردکردن رکورد" mode="edit" dirty onSave={async () => { if (!reject.reason.trim()) return; const r = await run(reject.uid, "reject", { reason: reject.reason.trim() }); if (!r.error) setReject(null); }} onClose={() => setReject(null)} canEdit data-pid-reject-form>
          <label className="mk-f" data-form-field="reason"><span className="muted sm">دلیل (لازم)</span><input data-input="reason" data-autofocus value={reject.reason} onChange={(e) => setReject({ ...reject, reason: e.target.value })} /></label>
        </FormDialog>)}
    </div>
  );
}
