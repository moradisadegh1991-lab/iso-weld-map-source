"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import TableKit from "../../components/ui/TableKit";
import Tabs from "../../components/ui/Tabs";
import Fold from "../../components/ui/Fold";
import { localToday, DayHint } from "../../components/ui/WorkDate";
import { money } from "../../components/contracts/ui";

/**
 * Finance: what is committed, certified and paid — by contract, by WBS
 * element and by month — and the queue of statements waiting to be paid.
 * Every figure is read from where it was recorded; the only thing typed
 * here is a payment, against an approved statement, an advance or a
 * retention release, never more than is owed.
 */
const KIND_FA = { advance: "پیش‌پرداخت", statement: "صورت وضعیت", retention_release: "آزادسازی حسن انجام کار" };

export default function FinancePage() {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/finance?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  const may = can({ role }, ACTIONS.MANAGE_FINANCE);

  async function pay(body) {
    setMsg(null);
    try { await call("/api/finance", { method: "POST", body: JSON.stringify({ projectId, kind: "payment", ...body }) }); reload(); return true; }
    catch (e) { setMsg(e.message); return false; }
  }
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const toPay = data.queue.filter((s) => s.status === "approved");
  return (
    <div className="page">
      <div className="pagehead"><h1>مالی</h1><span className="sub">{data.contracts.length} قرارداد · {toPay.length} صورت وضعیت منتظر پرداخت</span></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      {data.totals.map((t) => (
        <div className="moneyrow" key={t.currency}>
          <div><span>مبلغ قراردادهای جاری ({t.currency})</span><b>{money(t.contractValue)}</b></div>
          <div><span>تأییدشده (کارکرد تجمعی)</span><b>{money(t.certified)}</b></div>
          <div><span>خالص تأییدشده</span><b>{money(t.netApproved)}</b></div>
          <div><span>پرداخت‌شده (صورت وضعیت و حسن انجام کار)</span><b>{money(t.paid)}</b></div>
          <div style={{ borderColor: t.due > 0 ? "#d9a13b" : undefined }}><span>بدهی (تأییدشده، پرداخت‌نشده)</span><b>{money(t.due)}</b></div>
          <div><span>حسن انجام کار نگه‌داشته</span><b>{money(t.retentionHeld)}</b></div>
          <div><span>سفارش‌های خرید</span><b>{money(t.poValue)}</b></div>
        </div>
      ))}

      <Tabs name="finance">
        <div className="card" data-badge={toPay.length} data-tone={toPay.length ? "warn" : ""}>
          <h2>منتظر پرداخت</h2>
          {data.queue.length === 0 ? <p className="empty-note">صورت وضعیتی در جریان نیست.</p> : (
            <table className="dtable">
              <thead><tr><th>قرارداد</th><th>پیمانکار</th><th>صورت وضعیت</th><th>وضعیت</th><th>خالص</th><th>پرداخت‌شده</th><th /></tr></thead>
              <tbody>{data.queue.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.contractNo}</td><td className="sm">{s.contractor}</td><td className="mono">{s.seq}</td>
                  <td className="sm">{s.statusFa}</td><td className="mono">{money(s.net, s.currency)}</td><td className="mono">{money(s.paidSoFar)}</td>
                  <td>{may && s.status === "approved" && <PayForm label={`پرداخت صورت وضعیت ${s.seq} ${s.contractNo}`} max={Math.round((s.net - s.paidSoFar) * 100) / 100}
                    onPay={(p) => pay({ ...p, paymentKind: "statement", contractId: s.contractId, statementId: s.id })} />}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          <p className="muted sm">صورت وضعیت پس از تأیید فنی و تأیید امور قراردادها به اینجا می‌رسد؛ پرداخت از خالص تأییدشده بیشتر نمی‌شود.</p>
        </div>

        <div className="card">
          <h2>به تفکیک قرارداد</h2>
          <TableKit name="finance-contracts">
            <table className="dtable">
              <thead><tr><th>قرارداد</th><th>پیمانکار</th><th>مبلغ</th><th>تأییدشده</th><th>خالص تأییدشده</th><th>پیش‌پرداخت / مستهلک</th><th>حسن انجام کار</th><th>پرداخت‌شده</th><th>بدهی</th></tr></thead>
              <tbody>{data.contracts.map((c) => (
                <tr key={c.id}>
                  <td className="mono">{c.no}<div className="muted sm">{c.statusFa}</div></td><td className="sm">{c.contractor}</td>
                  <td className="mono sm">{money(c.value, c.currency)}</td><td className="mono sm">{money(c.certified)}</td><td className="mono sm">{money(c.netApproved)}</td>
                  <td className="mono sm">{money(c.advancePaid)} / {money(c.advanceRecovered)}</td><td className="mono sm">{money(c.retentionHeld)}</td>
                  <td className="mono sm">{money(c.paid)}</td><td className="mono sm">{money(c.due)}</td>
                </tr>
              ))}</tbody>
            </table>
          </TableKit>
          {may && <OtherPayment contracts={data.contracts.filter((c) => c.status === "signed" || c.status === "closed")} pay={pay} />}
        </div>

        <div className="card">
          <h2>به تفکیک WBS</h2>
          <TableKit name="finance-wbs">
            <table className="dtable">
              <thead><tr><th>WBS</th><th>عنوان</th><th>بودجه (BAC)</th><th>تعهد در قراردادها</th><th>باقی‌ماندهٔ بودجه</th><th>هزینهٔ واقعی</th></tr></thead>
              <tbody>{data.wbs.map((w) => (
                <tr key={w.id}><td className="mono">{w.code}</td><td>{w.title}</td><td className="mono sm">{money(w.bac)}</td>
                  <td className="mono sm">{money(w.committed)}</td>
                  <td className="mono sm">{w.remaining === null ? "—" : <span className={w.remaining < 0 ? "pill bad" : ""}>{money(w.remaining)}</span>}</td>
                  <td className="mono sm">{money(w.actual)}{w.fromStatements ? <div className="muted">{w.fromStatements} از صورت وضعیت</div> : null}</td></tr>
              ))}</tbody>
            </table>
          </TableKit>
          <p className="muted sm">هزینهٔ واقعی همان ثبت‌های «کنترل پروژه» است؛ صورت وضعیت تأییدشده کارکرد دوره را روی WBS هر ردیف ثبت می‌کند، پس AC در EVM همان مبلغ تأییدشده است.</p>
        </div>

        <div className="card">
          <h2>پرداخت‌ها و جریان نقدی</h2>
          {data.cash.length === 0 ? <p className="empty-note">پرداختی ثبت نشده است.</p> : (
            <table className="dtable"><thead><tr><th>ماه</th><th>نوع</th><th>مبلغ</th></tr></thead>
              <tbody>{data.cash.map((c, i) => <tr key={i}><td className="mono">{c.month}</td><td className="sm">{KIND_FA[c.kind]}</td><td className="mono">{money(c.amount, c.currency)}</td></tr>)}</tbody></table>
          )}
          <h3>همهٔ پرداخت‌ها</h3>
          <table className="dtable"><thead><tr><th>تاریخ</th><th>قرارداد</th><th>نوع</th><th>مبلغ</th><th>سند</th></tr></thead>
            <tbody>{data.contracts.flatMap((c) => c.payments.map((p) => ({ ...p, no: c.no, cur: c.currency }))).sort((a, b) => b.paidOn.localeCompare(a.paidOn)).map((p) => (
              <tr key={p.id}><td className="mono">{new Date(p.paidOn).toLocaleDateString("fa-IR")}</td><td className="mono">{p.no}</td><td className="sm">{KIND_FA[p.kind]}</td>
                <td className="mono">{money(p.amount, p.cur)}</td><td className="mono sm">{p.refNo}</td></tr>
            ))}</tbody></table>
        </div>

        <div className="card">
          <h2>سفارش‌های خرید</h2>
          {data.purchaseOrders.length === 0 ? <p className="empty-note">سفارش خریدی نیست.</p> : (
            <table className="dtable"><thead><tr><th>PO</th><th>فروشنده</th><th>مبلغ</th></tr></thead>
              <tbody>{data.purchaseOrders.map((p) => <tr key={p.poNo}><td className="mono">{p.poNo}</td><td className="sm">{p.vendor}</td>
                <td className="mono">{money(p.value, p.currency)}{p.unpriced ? <span className="pill warn"> {p.unpriced} ردیف بی‌قیمت</span> : null}</td></tr>)}</tbody></table>
          )}
        </div>
      </Tabs>
    </div>
  );
}

function PayForm({ label, max, onPay }) {
  const [amount, setAmount] = useState(String(max));
  const [paidOn, setPaidOn] = useState(localToday());
  const [refNo, setRefNo] = useState("");
  return (
    <Fold title="ثبت پرداخت">
      <form onSubmit={async (e) => { e.preventDefault(); if (await onPay({ amount, paidOn, refNo })) setRefNo(""); }} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "end" }}>
        <div className="field"><label htmlFor={`pay-amt-${label}`}>مبلغ (حداکثر {money(max)})</label>
          <input id={`pay-amt-${label}`} aria-label={`مبلغ ${label}`} type="number" step="any" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div className="field"><label htmlFor={`pay-on-${label}`}>تاریخ</label>
          <input id={`pay-on-${label}`} type="date" dir="ltr" max={localToday()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /><DayHint date={paidOn} /></div>
        <div className="field"><label htmlFor={`pay-ref-${label}`}>شمارهٔ سند</label>
          <input id={`pay-ref-${label}`} aria-label={`سند ${label}`} dir="ltr" value={refNo} onChange={(e) => setRefNo(e.target.value)} required /></div>
        <button className="btn" type="submit">ثبت پرداخت</button>
      </form>
    </Fold>
  );
}

function OtherPayment({ contracts, pay }) {
  const [f, setF] = useState({ contractId: "", paymentKind: "advance", amount: "", paidOn: localToday(), refNo: "", note: "" });
  const on = (k) => (e) => setF({ ...f, [k]: e.target.value });
  if (!contracts.length) return null;
  return (
    <Fold title="پیش‌پرداخت یا آزادسازی حسن انجام کار">
      <form onSubmit={async (e) => { e.preventDefault(); if (await pay(f)) setF({ ...f, amount: "", refNo: "", note: "" }); }}>
        <div className="grid2">
          <div className="field"><label htmlFor="op-c">قرارداد</label>
            <select id="op-c" value={f.contractId} onChange={on("contractId")} required><option value="">—</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.no} — {c.contractor}</option>)}</select></div>
          <div className="field"><label htmlFor="op-k">نوع</label>
            <select id="op-k" value={f.paymentKind} onChange={on("paymentKind")}>
              <option value="advance">پیش‌پرداخت</option><option value="retention_release">آزادسازی حسن انجام کار</option></select></div>
          <div className="field"><label htmlFor="op-a">مبلغ</label><input id="op-a" type="number" step="any" dir="ltr" value={f.amount} onChange={on("amount")} required /></div>
          <div className="field"><label htmlFor="op-d">تاریخ</label><input id="op-d" type="date" dir="ltr" max={localToday()} value={f.paidOn} onChange={on("paidOn")} /></div>
          <div className="field"><label htmlFor="op-r">شمارهٔ سند</label><input id="op-r" dir="ltr" value={f.refNo} onChange={on("refNo")} required /></div>
          <div className="field"><label htmlFor="op-n">یادداشت</label><input id="op-n" value={f.note} onChange={on("note")} /></div>
        </div>
        <button className="btn" type="submit">ثبت</button>
      </form>
    </Fold>
  );
}
