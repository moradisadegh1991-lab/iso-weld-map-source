"use client";
import { useMemo, useState } from "react";

/**
 * The Revisions tab (docs/audit/phase-8-revision-lifecycle.md): the drawing sheet's timeline, the comparison of a source revision with the open
 * one, and the controlled carry-forward. Nothing is carried unless a person selects it here; the server plans again and refuses what the plan
 * does not allow. The source revision is read-only throughout.
 */
const KIND = { added: "اضافه", removed: "حذف", modified: "تغییر", unchanged: "بدون تغییر", ambiguous: "مبهم", candidate: "پیشنهاد تطبیق" };
const CAT = { metadata: "مشخصات", weld: "سرجوش", bom: "BOM", equipment: "تجهیز", spool: "اسپول", support: "ساپورت", geometry: "هندسه", identity: "هویت", allocation: "اثر تخصیص" };
const STATUS = { approved: "تأییدشده", extracted: "در بازبینی", superseded: "جایگزین‌شده", failed: "ناموفق", "no-run": "بدون رجیستر" };
const REASON = { TARGET_HAS_VALUE: "مقدار در رویژن جدید هست و دست نمی‌خورد", PT_NOT_IN_TARGET: "PT در BOM رویژن جدید نیست", NO_MAPPED_WELD: "سرجوش معادل صریح ندارد", PARTIAL_LINKS: "بخشی از پیوندها معادل ندارد", SPOOL_NOT_IN_TARGET: "اسپول روی برگ جدید نیست" };
const when = (d) => (d ? new Date(d).toLocaleDateString("fa-IR") : "—");
const short = (u) => (u ? String(u).slice(0, 8) : "—");

export default function RevisionPanel({ rc, current, onOpenRun, onSelect, selectedUid, onValidate, locked, session }) {
  const { lineage, compare, ui, patch } = rc;
  const [newRev, setNewRev] = useState(""), [note, setNote] = useState(""), [msg, setMsg] = useState(""), [confirmOpen, setConfirmOpen] = useState(false);
  const changes = compare?.changes || [];
  const shown = useMemo(() => changes.filter((c) => {
    const k = ui.kind;
    const okKind = k === "all" || (k === "review" ? c.requiresReview : c.kind === k);
    const needle = ui.q.trim().toLowerCase();
    return okKind && (ui.category === "all" || c.category === ui.category) && (!needle || [c.label, c.fromNo, c.toNo, c.fromUid, c.toUid, c.reason].some((x) => String(x ?? "").toLowerCase().includes(needle)));
  }), [changes, ui.kind, ui.category, ui.q]);
  const pick = changes.find((c) => c.id === ui.pick) || null;
  const dec = ui.decisions;
  const setDec = (key, v) => patch({ decisions: { ...dec, [key]: { ...(dec[key] || {}), ...v } } });
  const selUid = selectedUid ? String(selectedUid).toLowerCase() : null;
  const chosen = Object.entries(dec).filter(([, d]) => d.status === "carry" && ((d.fields || []).length || d.pair));
  const summary = chosen.map(([key, d]) => ({ key, c: changes.find((x) => x.id === key), d })).filter((x) => x.c);
  const decisions = summary.map(({ key, d, c }) => ({ key, ...(d.pair ? { pair: d.pair } : {}), fields: d.fields || [] }));
  const me = lineage?.chain.find((c) => c.documentId === current);
  const canCarry = compare && !compare.to.locked && compare.linked && !locked;

  const create = async () => { setMsg(""); const r = await rc.create(newRev.trim(), note.trim()); if (r.error) setMsg(r.error); else { setMsg(`رویژن ${newRev.trim()} ساخته و به این رویژن وصل شد. اطلاعاتش را با همان شمارهٔ نقشه و رویژن در یک فهرست جدید ثبت کنید، بعد اینجا مقایسه کنید.`); setNewRev(""); setNote(""); } };
  const apply = async () => { setMsg(""); const r = await rc.apply(decisions); setConfirmOpen(false); setMsg(r.error ? r.error : `انتقال انجام شد: ${r.result.op.summary.fields} فیلد در ${r.result.op.summary.carried} مورد، ${r.result.op.summary.mappingsConfirmed} تطبیق تأییدشده.${r.result.repeated ? " (همین درخواست قبلاً انجام شده بود)" : ""}`); if (!r.error) onOpenRun?.(me?.runId, true); };

  return (
    <div className="rv" data-revisions>
      <section className="rv-timeline" data-rv-timeline aria-label="revision timeline">
        <b>زمان‌بندی رویژن‌های این برگ ({lineage?.docNo || "…"})</b>
        <ol className="rv-chain">
          {(lineage?.chain || []).map((c) => (
            <li key={c.documentId} data-rv-rev={c.revision} className={c.documentId === current ? "on" : ""}>
              <div className="row" style={{ gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
                <b className="mono" dir="ltr">REV {c.revision}</b><span className="chip">{STATUS[c.status] || c.status}</span>
                {c.documentId === current && <span className="chip cy">رویژن باز</span>}
                {!c.parentDocumentId && (lineage.unlinked || []).includes(c.documentId) && <span className="chip" title="به هیچ رویژنی وصل نیست">بدون مبدأ</span>}
              </div>
              <div className="muted sm">ثبت: {when(c.createdAt)} · {c.createdBy || "—"}{c.approvedAt ? ` · تأیید: ${when(c.approvedAt)} ${c.approvedBy || ""}` : ""}</div>
              <div className="muted sm">مبدأ: {c.parentDocumentId ? `REV ${lineage.chain.find((x) => x.documentId === c.parentDocumentId)?.revision ?? "؟"}` : "—"}{c.changeNote ? ` · ${c.changeNote}` : ""}{c.carryOps.length ? ` · ${c.carryOps.length} انتقال` : ""}</div>
              <div className="row" style={{ gap: 6, marginTop: 4 }}>
                {c.runId && c.documentId !== current && <button type="button" className="ghost sm" data-rv-open={c.revision} onClick={() => onOpenRun?.(c.runId)}>باز کردن</button>}
                {c.documentId !== current && <button type="button" className={`ghost sm ${rc.fromId === c.documentId ? "on" : ""}`} data-rv-from={c.revision} onClick={() => rc.setFromId(c.documentId)}>مقایسه با این رویژن</button>}
              </div>
            </li>))}
        </ol>
        {!locked && session && (
          <div className="rv-new row" style={{ gap: 6, flexWrap: "wrap" }}>
            <input value={newRev} onChange={(e) => setNewRev(e.target.value)} placeholder="شمارهٔ رویژن جدید (مثلاً 1)" aria-label="new revision" data-rv-new-rev dir="ltr" />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="توضیح تغییر" aria-label="change note" data-rv-new-note />
            <button type="button" data-rv-create disabled={rc.busy || !newRev.trim()} onClick={create}>ایجاد رویژن جدید از این رویژن</button>
          </div>)}
      </section>
      {rc.error && <p className="note bad" role="alert" data-rv-error>{rc.error}</p>}
      {msg && <p className="note" role="status" data-rv-msg>{msg}</p>}

      {!compare ? <p className="muted" data-rv-none>{rc.loading ? "در حال مقایسه…" : rc.fromId ? "مقایسه ممکن نشد." : "این رویژن مبدأ ندارد؛ یک رویژن را برای مقایسه از زمان‌بندی انتخاب کنید (رویژن مبدأ و رجیستر ذخیره‌شده لازم است)."}</p> : (
        <>
          <div className="rv-head row" style={{ gap: 8, alignItems: "baseline", flexWrap: "wrap" }} data-rv-compare-head>
            <b dir="ltr" className="mono">REV {compare.from.revision} ⟶ REV {compare.to.revision}</b>
            {!compare.linked && <span className="chip bad">مبدأ این رویژن نیست</span>}{compare.to.locked && <span className="chip">رویژن مقصد تأییدشده: فقط مشاهده</span>}
            <button type="button" className="ghost sm" data-rv-refresh onClick={rc.refresh}>↻ تازه‌سازی</button>
            <button type="button" className="ghost sm" data-rv-validate onClick={onValidate}>اعتبارسنجی این رویژن</button>
            <span className="muted sm" data-rv-summary>{compare.summary.total} مورد · {compare.summary.requiresReview} نیازمند بررسی · {Object.entries(compare.summary.byKind).map(([k, n]) => `${KIND[k]} ${n}`).join(" · ")}</span>
          </div>
          <div className="vc-filters">
            <input type="search" value={ui.q} onChange={(e) => patch({ q: e.target.value })} placeholder="جست‌وجو" aria-label="search changes" data-rv-search />
            <select value={ui.kind} onChange={(e) => patch({ kind: e.target.value })} aria-label="kind" data-rv-kind>
              <option value="all">همهٔ تغییرات</option>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}<option value="review">نیازمند بررسی</option></select>
            <select value={ui.category} onChange={(e) => patch({ category: e.target.value })} aria-label="category" data-rv-category>
              <option value="all">همهٔ دسته‌ها</option>{Object.entries(CAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </div>
          <p className="muted sm" data-rv-count>{shown.length} از {changes.length}</p>
          <div className="vc-scroll"><table className="vc-table" data-rv-table>
            <thead><tr><th>نوع</th><th>دسته</th><th>مورد</th><th>قبلی</th><th>جدید</th><th>انتقال</th></tr></thead>
            <tbody>{shown.map((c) => {
              const d = dec[c.id] || {};
              return (
                <tr key={c.id} tabIndex={0} data-change={c.id} data-kind={c.kind} data-category={c.category} className={`${ui.pick === c.id ? "on" : ""} ${selUid && (String(c.toUid).toLowerCase() === selUid) ? "sel" : ""}`}
                  onClick={() => { patch({ pick: c.id }); if (c.toUid) onSelect?.(c.toUid); }} onKeyDown={(e) => { if (e.key === "Enter") { patch({ pick: c.id }); if (c.toUid) onSelect?.(c.toUid); } }}>
                  <td><span className={`vc-sev ${c.kind === "removed" || c.kind === "ambiguous" ? "error" : c.kind === "modified" || c.kind === "candidate" ? "warning" : "info"}`}>{KIND[c.kind]}</span>{c.requiresReview && <span className="vc-block" style={{ background: "var(--warn)" }}>بررسی</span>}</td>
                  <td>{CAT[c.category]}</td><td>{c.label}</td>
                  <td className="mono sm" dir="ltr">{c.fromNo ?? "—"}</td><td className="mono sm" dir="ltr">{c.toNo ?? "—"}</td>
                  <td className="sm">{d.status === "carry" ? "✓ انتخاب" : d.status === "hold" ? "نگه‌داشته" : d.status === "exclude" ? "خارج" : c.carry?.ready?.length ? `${c.carry.ready.length} قابل` : "—"}</td>
                </tr>); })}</tbody></table></div>

          {pick && (
            <section className="vc-detail" data-rv-detail aria-label="change details">
              <div className="row" style={{ justifyContent: "space-between" }}><b>{pick.label}</b><button type="button" className="ghost sm" onClick={() => patch({ pick: null })} aria-label="close">×</button></div>
              <dl className="vc-dl sm">
                <dt>نوع تغییر</dt><dd>{KIND[pick.kind]} · {CAT[pick.category]}</dd>
                <dt>UID قبلی</dt><dd className="mono" dir="ltr" data-rv-uid-from>{pick.fromUid || "—"}</dd>
                <dt>UID جدید</dt><dd className="mono" dir="ltr" data-rv-uid-to>{pick.toUid || "—"}</dd>
                {pick.reason && (<><dt>دلیل / توضیح</dt><dd>{pick.reason}</dd></>)}
                {pick.deps?.length > 0 && (<><dt>وابستگی‌ها</dt><dd>{pick.deps.map((x, i) => <div key={i}>{x}</div>)}</dd></>)}
              </dl>
              {pick.fields.length > 0 && <table className="vc-table"><thead><tr><th>فیلد</th><th>مقدار قبلی</th><th>مقدار جدید</th></tr></thead><tbody>{pick.fields.map((f) => <tr key={f.field}><td>{f.label}</td><td className="mono sm" dir="ltr">{f.from ?? "—"}</td><td className="mono sm" dir="ltr">{f.to ?? "—"}</td></tr>)}</tbody></table>}
              {pick.kind === "ambiguous" && (
                <div data-rv-ambiguous className="rv-amb">
                  <p className="muted sm">هیچ‌کدام خودکار تطبیق نمی‌شوند. اگر می‌دانید کدام مورد قدیمی همان مورد جدید است، همین‌جا صریحاً انتخاب کنید.</p>
                  <label>قدیمی <select data-rv-amb-from value={dec[pick.id]?.pair?.fromUid || ""} onChange={(e) => setDec(pick.id, { status: "carry", fields: [], pair: { fromUid: e.target.value, toUid: dec[pick.id]?.pair?.toUid || "" } })}><option value="">—</option>{pick.candidates.from.map((x) => <option key={x.uid} value={x.uid}>{x.no} · {x.view.loc || x.view.type || ""} · {short(x.uid)}</option>)}</select></label>
                  <label>جدید <select data-rv-amb-to value={dec[pick.id]?.pair?.toUid || ""} onChange={(e) => setDec(pick.id, { status: "carry", fields: [], pair: { fromUid: dec[pick.id]?.pair?.fromUid || "", toUid: e.target.value } })}><option value="">—</option>{pick.candidates.to.map((x) => <option key={x.uid} value={x.uid}>{x.no} · {x.view.loc || x.view.type || ""} · {short(x.uid)}</option>)}</select></label>
                </div>)}
              {pick.kind === "candidate" && canCarry && (
                <label className="rv-confirm"><input type="checkbox" data-rv-confirm checked={Boolean(dec[pick.id]?.pair)} onChange={(e) => setDec(pick.id, { status: e.target.checked ? "carry" : "hold", pair: e.target.checked ? { fromUid: pick.fromUid, toUid: pick.toUid } : null })} /> این دو یک مورد هستند (تأیید صریح تطبیق؛ شمارهٔ چاپی یکسان به‌تنهایی کافی نیست)</label>)}
              {pick.carry && (pick.carry.ready.length > 0 || pick.carry.blocked.length > 0) && (
                <div className="rv-carry" data-rv-carry>
                  <b className="sm">انتقال به رویژن جدید</b>
                  {pick.carry.ready.map((r) => (
                    <label key={r.field} className="rv-field" data-rv-field={r.field}>
                      <input type="checkbox" disabled={!canCarry || (pick.kind === "candidate" && !dec[pick.id]?.pair)} checked={(dec[pick.id]?.fields || []).includes(r.field)}
                        onChange={(e) => { const cur = new Set(dec[pick.id]?.fields || []); if (e.target.checked) cur.add(r.field); else cur.delete(r.field); setDec(pick.id, { status: cur.size || dec[pick.id]?.pair ? "carry" : "hold", fields: [...cur] }); }} />
                      {" "}{r.field}: <span className="mono" dir="ltr">{r.value}</span>{r.state === "needs_decision" ? " ⚠ نیازمند انتخاب صریح" : ""}{r.note ? ` — ${r.note}` : ""}
                    </label>))}
                  {pick.carry.blocked.map((b, i) => <div key={i} className="muted sm" data-rv-blocked={b.field}>✗ {b.field}: {REASON[b.reason] || b.reason}{b.from ? ` (${b.from})` : ""}</div>)}
                  <div className="row" style={{ gap: 6, marginTop: 4 }}>
                    <button type="button" className="ghost sm" data-rv-hold onClick={() => setDec(pick.id, { status: "hold", fields: [], pair: null })}>نگه‌دار برای بررسی</button>
                    <button type="button" className="ghost sm" data-rv-exclude onClick={() => setDec(pick.id, { status: "exclude", fields: [], pair: null })}>خارج از انتقال</button>
                  </div>
                </div>)}
            </section>)}

          <section className="rv-apply" data-rv-apply>
            <b>انتقال انتخاب‌شده</b>
            <p className="muted sm">فقط توصیفات خالیِ رویژن جدید پر می‌شود؛ وضعیت نصب/تست، تخصیص‌ها، تاریخچه، تأیید و هندسه هیچ‌وقت منتقل نمی‌شوند. رویژن مبدأ دست نمی‌خورد. روی نسخهٔ ذخیره‌شدهٔ رویژن باز انجام می‌شود؛ تغییرات ذخیره‌نشدهٔ صفحه را اول ذخیره کنید.</p>
            {!canCarry && <p className="muted sm" data-rv-cannot>{compare.to.locked || locked ? "رویژن مقصد تأییدشده است؛ انتقال ممکن نیست." : !compare.linked ? "این رویژن از رویژن مبدأ ساخته نشده؛ ابتدا پیوند را برقرار کنید." : ""}</p>}
            <button type="button" data-rv-review disabled={!canCarry || !summary.length || rc.busy} onClick={() => setConfirmOpen(true)}>مرور و اعمال انتقال ({summary.length})</button>
            {confirmOpen && (
              <div className="vc-detail" data-rv-confirm-box role="dialog" aria-label="carry-forward summary">
                <b>خلاصهٔ نهایی</b>
                <ul className="sm">{summary.map(({ key, c, d }) => <li key={key}>{c.label}{d.pair ? ` — تأیید تطبیق ${short(d.pair.fromUid)} ⟶ ${short(d.pair.toUid)}` : ""}{(d.fields || []).length ? ` — فیلدها: ${d.fields.join("، ")}` : ""}</li>)}</ul>
                <p className="muted sm">پیامد: {summary.some((x) => (x.d.fields || []).some((f) => ["c1", "c2", "acc"].includes(f))) ? "ارجاع‌های BOM در رویژن جدید ثبت می‌شود و رزرو تازهٔ خود همین رویژن مطابق قواعد همیشگی ساخته می‌شود؛ هیچ تخصیص رویژن قبلی منتقل یا آزاد نمی‌شود. " : ""}{summary.some((x) => (x.d.fields || []).includes("weldRefs")) ? "پیوند تجهیز به سرجوش فقط با uid سرجوشِ معادلِ تأییدشده ثبت می‌شود. " : ""}همه‌چیز در یک تراکنش است: یا کامل انجام می‌شود یا هیچ.</p>
                <div className="row" style={{ gap: 6 }}><button type="button" data-rv-apply-btn disabled={rc.busy} onClick={apply}>{rc.busy ? "…" : "اعمال انتقال"}</button><button type="button" className="ghost" data-rv-cancel onClick={() => setConfirmOpen(false)}>انصراف</button></div>
              </div>)}
          </section>
        </>)}
    </div>
  );
}
