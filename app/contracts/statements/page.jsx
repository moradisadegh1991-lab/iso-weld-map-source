"use client";
import { useEffect, useState } from "react";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../../lib/authz.mjs";
import { localToday, DayHint } from "../../../components/ui/WorkDate";
import EntityLog from "../../../components/ui/EntityLog";
import { money } from "../../../components/contracts/ui";

import TableKit from "../../../components/ui/TableKit";
/**
 * Contractors' payment statements (صورت وضعیت): measured to a period end,
 * prepared by the site, verified by the supervising engineer, approved by
 * the contracts department, paid by finance — each by a different person,
 * each step in the statement's trail with whoever took it.
 */
export default function StatementsPage() {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/contracts?projectId=${id}`, []);
  const [contractId, setContractId] = useState("");
  const [statementId, setStatementId] = useState(null);
  const [periodTo, setPeriodTo] = useState(localToday());
  const [msg, setMsg] = useState(null);
  const mayPrepare = can({ role }, ACTIONS.PREPARE_STATEMENT);

  const signed = data?.contracts.filter((c) => c.status === "signed" || c.status === "closed") || [];
  useEffect(() => { if (!contractId && signed.length) setContractId(signed[0].id); }, [signed.length]);   // eslint-disable-line react-hooks/exhaustive-deps
  const c = signed.find((x) => x.id === contractId);

  async function create(e) {
    e.preventDefault(); setMsg(null);
    try {
      const r = await call("/api/contracts", { method: "POST", body: JSON.stringify({ projectId, kind: "statement-create", contractId, periodTo }) });
      await reload(); setStatementId(r.statement.id);
    } catch (err) { setMsg(err.message); }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  return (
    <div className="page">
      <div className="pagehead">
        <h1>صورت وضعیت‌ها</h1>
        <span className="sub">{signed.reduce((n, x) => n + x.statements.length, 0)} صورت وضعیت · {signed.length} قرارداد جاری</span>
      </div>
      {msg && <p className="err" role="alert">{msg}</p>}
      {signed.length === 0 ? <p className="empty-note">قرارداد امضاشده‌ای نیست — صورت وضعیت فقط برای قرارداد امضاشده ثبت می‌شود.</p> : (
        <div className="card">
          <h2>قرارداد و صورت وضعیت‌هایش</h2>
          <div className="field" style={{ maxWidth: 480 }}><label htmlFor="ps-contract">قرارداد</label>
            <select id="ps-contract" value={contractId} onChange={(e) => { setContractId(e.target.value); setStatementId(null); }}>
              {signed.map((x) => <option key={x.id} value={x.id}>{x.no} — {x.title} ({x.contractor})</option>)}
            </select></div>
          {c && (
            <>
              <TableKit name="contracts-statements-1"><table className="dtable">
                <thead><tr><th>شماره</th><th>تا تاریخ</th><th>کارکرد این دوره</th><th>خالص قابل پرداخت</th><th>وضعیت</th><th /></tr></thead>
                <tbody>{c.statements.length === 0 ? <tr><td colSpan={6} className="muted">هنوز صورت وضعیتی نیست.</td></tr> : c.statements.map((s) => (
                  <tr key={s.id}>
                    <td className="mono">{s.seq}</td><td className="mono">{new Date(s.periodTo).toLocaleDateString("fa-IR")}</td>
                    <td className="mono">{money(s.grossThis, c.currency)}</td><td className="mono">{money(s.net, c.currency)}</td>
                    <td><span className={`pill ${s.status === "paid" ? "ok" : s.status === "draft" ? "" : "warn"}`}>{s.statusFa}</span></td>
                    <td><button className="btn ghost" onClick={() => setStatementId(statementId === s.id ? null : s.id)}>{statementId === s.id ? "بستن" : "باز کردن"}</button></td>
                  </tr>
                ))}</tbody>
              </table></TableKit>
              {mayPrepare && c.status === "signed" && (
                <form onSubmit={create} style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap", marginTop: 8 }}>
                  <div className="field"><label htmlFor="ps-to">پایان دوره</label>
                    <input id="ps-to" type="date" dir="ltr" max={localToday()} value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} />
                    <DayHint date={periodTo} /></div>
                  <button className="btn" type="submit">صورت وضعیت جدید (اندازه‌گیری تا این تاریخ)</button>
                </form>
              )}
            </>
          )}
        </div>
      )}
      {statementId && <Statement key={statementId} id={statementId} onChange={reload} />}
    </div>
  );
}

function Statement({ id, onChange }) {
  const { projectId, role, call, user } = usePlatform();
  const [d, setD] = useState(null);
  const [msg, setMsg] = useState(null);
  const [note, setNote] = useState("");
  const [refresh, setRefresh] = useState(0);
  const load = () => call(`/api/contracts?projectId=${projectId}&statement=${id}`).then((r) => setD(r.statement)).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function act(body) {
    setMsg(null);
    try {
      const r = await call("/api/contracts", { method: "POST", body: JSON.stringify({ projectId, statementId: id, ...body }) });
      setD(r.statement); setNote(""); setRefresh((n) => n + 1); onChange?.();
    } catch (e) { setMsg(e.message); }
  }
  if (!d) return msg ? <p className="err">{msg}</p> : <p className="muted">در حال بارگذاری…</p>;
  const cur = d.contract.currency;
  const m = d.money;
  const blocks = d.flags.filter((f) => f.level === "block");
  const may = (a) => can({ role }, a);
  const me = user?.id;

  return (
    <div className="card" data-keep>
      <h2>صورت وضعیت {d.seq} — {d.contract.no} · تا {new Date(d.periodTo).toLocaleDateString("fa-IR")}</h2>
      <p><span className={`pill ${d.status === "paid" ? "ok" : d.status === "draft" ? "" : "warn"}`} data-status={d.status}>{d.statusFa}</span></p>
      {msg && <p className="err" role="alert">{msg}</p>}

      <TableKit name="contracts-statements-2"><table className="dtable">
        <thead><tr><th>ردیف</th><th>شرح</th><th>WBS</th><th>تا قبل</th><th>تجمعی</th><th>این دوره</th><th>بها</th><th>مبلغ تجمعی</th><th>از کجا</th></tr></thead>
        <tbody>{d.lines.map((l) => (
          <tr key={l.lineId}>
            <td className="mono">{l.itemNo}</td><td>{l.description}<div className="muted sm">{l.unit}</div></td>
            <td className="mono sm">{l.wbs || "—"}</td>
            <td className="mono">{l.prevQty}</td>
            <td className="mono">{d.status === "draft" && l.method === "measured" && may(ACTIONS.PREPARE_STATEMENT)
              ? <MeasuredCell l={l} onSave={(cumQty, sheetRef) => act({ kind: "statement-set", lineId: l.lineId, cumQty, sheetRef })} />
              : l.cumQty ?? <span className="pill bad">نامعلوم</span>}</td>
            <td className="mono">{l.thisQty ?? "—"}</td><td className="mono sm">{money(l.rate)}</td><td className="mono">{money(l.amountCum)}</td>
            <td className="sm"><Evidence l={l} />{l.flags.map((f) => <div key={f.text} className={`pill ${f.level === "block" ? "bad" : "warn"} sm`} style={{ marginTop: 2 }}>{f.text}</div>)}</td>
          </tr>
        ))}</tbody>
      </table></TableKit>

      <div className="moneyrow">
        <div><span>کارکرد تجمعی</span><b>{money(m.grossCum, cur)}</b></div>
        <div><span>تا صورت وضعیت قبل</span><b>{money(m.grossPrev, cur)}</b></div>
        <div><span>کارکرد این دوره</span><b>{money(m.grossThis, cur)}</b></div>
        <div><span>استهلاک پیش‌پرداخت</span><b>− {money(m.advanceRecovery)}</b></div>
        <div><span>حسن انجام کار</span><b>− {money(m.retention)}</b></div>
        <div><span>بیمه</span><b>− {money(m.insurance)}</b></div>
        <div><span>مالیات تکلیفی</span><b>− {money(m.withholding)}</b></div>
        <div><span>ارزش افزوده</span><b>+ {money(m.vat)}</b></div>
        <div style={{ borderColor: "#2e9e6b" }}><span>خالص قابل پرداخت</span><b data-net>{money(m.net, cur)}</b></div>
        <div><span>پرداخت‌شده</span><b>{money(d.paid, cur)}</b></div>
      </div>
      {d.status === "draft" && <p className="muted sm">در پیش‌نویس، مبالغ با هر تغییر دوباره حساب می‌شوند؛ با «ارسال» ثابت می‌شوند.</p>}

      <div className="sigs">
        {[["prepared", "تهیه"], ["submitted", "ارسال"], ["verified", "تأیید فنی (نظارت)"], ["approved", "تأیید امور قراردادها"]].map(([k, t]) => (
          <div key={k} className={d.signatures[k].by ? "done" : ""}><b>{t}</b><div>{d.signatures[k].by || "—"}</div>
            <div className="muted mono">{d.signatures[k].at ? new Date(d.signatures[k].at).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" }) : ""}</div></div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {d.status === "draft" && may(ACTIONS.PREPARE_STATEMENT) && <>
          <button className="btn ghost" onClick={() => act({ kind: "statement-measure" })}>اندازه‌گیری دوباره</button>
          <button className="btn" disabled={blocks.length > 0} title={blocks.map((b) => b.text).join("\n")} onClick={() => act({ kind: "statement-transition", action: "submit" })}>ارسال برای تأیید</button>
        </>}
        {d.status === "submitted" && may(ACTIONS.VERIFY_STATEMENT) && d.ids.submitted !== me &&
          <button className="btn" onClick={() => act({ kind: "statement-transition", action: "verify" })}>تأیید فنی</button>}
        {d.status === "verified" && may(ACTIONS.APPROVE_STATEMENT) && d.ids.verified !== me && d.ids.prepared !== me && d.ids.submitted !== me &&
          <button className="btn" onClick={() => act({ kind: "statement-transition", action: "approve" })}>تأیید نهایی (امور قراردادها)</button>}
        {["submitted", "verified"].includes(d.status) && (may(ACTIONS.VERIFY_STATEMENT) || may(ACTIONS.APPROVE_STATEMENT)) && <>
          <input aria-label="دلیل برگشت صورت وضعیت" placeholder="دلیل برگشت…" value={note} onChange={(e) => setNote(e.target.value)} style={{ minWidth: 220 }} />
          <button className="btn ghost" disabled={!note.trim()} onClick={() => act({ kind: "statement-transition", action: "return", comment: note })}>برگشت به پیش‌نویس</button>
        </>}
        {d.status === "approved" && <span className="muted sm">منتظر پرداخت — بخش «مالی».</span>}
      </div>

      <h3>گردش و کامنت‌ها</h3>
      <EntityLog section="contracts" entityType="statement" entityId={d.id} label={`صورت وضعیت ${d.seq} — ${d.contract.no}`} refreshKey={refresh} />
    </div>
  );
}

function MeasuredCell({ l, onSave }) {
  const [q, setQ] = useState(l.cumQty ?? "");
  const [s, setS] = useState(l.sheetRef ?? "");
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(q, s); }} style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      <input aria-label={`مقدار تجمعی ردیف ${l.itemNo}`} type="number" step="any" dir="ltr" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 80 }} />
      <input aria-label={`صورت‌جلسهٔ ردیف ${l.itemNo}`} dir="ltr" placeholder="صورت‌جلسه" value={s} onChange={(e) => setS(e.target.value)} style={{ width: 100 }} />
      <button className="btn ghost" type="submit">ثبت</button>
    </form>
  );
}

function Evidence({ l }) {
  const e = l.evidence || {};
  if (l.method === "platform") return <div>پلتفرم: {e.title} · {e.items} مورد تا {e.asOf}{e.missing ? ` · ${e.missing} بدون مقدار` : ""}</div>;
  if (l.method === "design") return <div>{e.design ? `${e.design.source} Rev.${e.design.rev}: ${e.design.qty}` : "مدل؟"} × پیشرفت WBS {e.wbsPct ?? "؟"}٪</div>;
  if (l.method === "lump_sum") return <div>مقطوع × پیشرفت WBS {e.wbsPct ?? "؟"}٪</div>;
  return <div>صورت‌جلسه: {l.sheetRef || "—"}</div>;
}
