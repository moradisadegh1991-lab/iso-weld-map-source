"use client";
import { useState } from "react";
import Link from "next/link";
import { usePlatform } from "../../../lib/client/platform.mjs";
import TableKit from "../../../components/ui/TableKit";
import { useValueLists, refreshValueLists } from "../../../components/ui/Pick";
import { LIST_KEYS, COLUMN_LIST } from "../../../lib/register/value-lists.mjs";

/**
 * The project's picking lists (lib/register/value-lists.mjs): the values the
 * isometric and weld-list tables offer to pick — joint type, size, schedule,
 * material, WPS, support type, BOM group and the line-data values — so a
 * person picks rather than types. Each list starts from the usual values;
 * the project's own, saved here, replace them. Numbers, measured values and
 * free text are typed in the tables and have no list.
 */
const COLS_OF = Object.fromEntries(LIST_KEYS.map((k) => [k, Object.entries(COLUMN_LIST).filter(([, l]) => l === k).map(([c]) => c)]));

export default function DefaultsPage() {
  const { projectId, call } = usePlatform();
  const lists = useValueLists();
  const may = Boolean(lists._may);
  const [key, setKey] = useState("jointType");
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  const [bulk, setBulk] = useState("");
  const cur = lists[key];
  const items = cur?.items || [];

  async function save(next, done) {
    setMsg(null); setOk(null);
    try {
      await call("/api/value-lists", { method: "POST", body: JSON.stringify({ projectId, key, items: next }) });
      refreshValueLists(projectId); setOk(done); return true;
    } catch (e) { setMsg(e.message); return false; }
  }
  async function reset() {
    if (!window.confirm(`فهرست «${cur.label}» به مقادیر پیش‌فرض سامانه برگردد؟ مقادیری که پروژه ذخیره کرده پاک می‌شود.`)) return;
    setMsg(null); setOk(null);
    try {
      await call(`/api/value-lists?projectId=${encodeURIComponent(projectId)}&key=${key}`, { method: "DELETE" });
      refreshValueLists(projectId); setOk("به مقادیر پیش‌فرض سامانه برگشت.");
    } catch (e) { setMsg(e.message); }
  }
  const editable = may && cur && !cur.fixed;
  const rowEdit = editable ? {
    fields: [{ col: "مقدار", name: "value" }],
    value: (k) => ({ value: items[Number(k)] ?? "" }),
    onSave: (k, v) => save(items.map((x, i) => (i === Number(k) ? v.value : x)), "ذخیره شد."),
    onAdd: (v) => save([...items, v.value], `«${v.value}» افزوده شد.`),
  } : undefined;

  // many values pasted at once (from Excel, or rows of this table): one save, the list's values first
  async function pasteMany(data) {
    const got = (Array.isArray(data) ? data : []).map((row, k) => {
      if (data.from === "value-list-items" && data.values?.[k]) return data.values[k].value;
      const cells = (Array.isArray(row) ? row : [row]).map((c) => String(c ?? "").trim());
      return cells.length > 1 && /^\d+$/.test(cells[0]) ? cells[1] : cells[0];
    }).filter(Boolean);
    if (!got.length) return false;
    if (!window.confirm(`${got.length} مقدار به فهرست «${cur.label}» افزوده شود؟`)) return false;
    return save([...items, ...got], `${got.length} مقدار افزوده شد (تکراری‌ها یک بار).`);
  }

  if (!projectId) return <div className="page"><div className="pagehead"><h1>مقادیر پیش‌فرض</h1></div><p className="empty-note">یک پروژه انتخاب کنید.</p></div>;
  return (
    <div className="page" data-defaults-page>
      <div className="pagehead">
        <h1>مقادیر پیش‌فرض جدول‌ها</h1>
        <p className="muted">مقادیری که در جدول‌های <Link href="/piping">ایزومتریک و رجیستر جوش</Link> انتخاب می‌شوند. هر فهرست با مقادیر معمول شروع می‌شود و مقادیر پروژه جای آن را می‌گیرد.
          شماره‌ها (جوش، اسپول، ساپورت، PT، نقشه، شیت، رویژن، خط)، اندازه‌ها (طول، تعداد، فشار، دما، ضخامت عایق) و متن آزاد (شرح، توضیح، کد کالا، مرجع Tie-in) دستی وارد می‌شوند و فهرست ندارند.</p>
        {!may && <p className="note sm">ویرایش این فهرست‌ها با مدیر داده‌های پایپینگ است (همان دسترسی کلاس‌های لوله)؛ شما فقط آن‌ها را می‌بینید.</p>}
      </div>

      <div className="card">
        <h2>فهرست‌ها</h2>
        <TableKit name="value-lists" onEdit={(k) => setKey(k)} editLabel="مقادیر">
          <table className="dtable" data-value-lists>
            <thead><tr><th>فهرست</th><th>کجا انتخاب می‌شود</th><th>ستون‌ها</th><th>تعداد مقدار</th><th>منبع</th></tr></thead>
            <tbody>{LIST_KEYS.map((k) => { const l = lists[k]; return (
              <tr key={k} data-key={k} data-list={k} className={k === key ? "sel" : undefined}>
                <td><button type="button" className={k === key ? "on sm" : "ghost sm"} onClick={() => setKey(k)}>{l.label}</button></td>
                <td className="sm">{l.used}</td>
                <td className="mono sm" dir="ltr">{COLS_OF[k].join(", ")}</td>
                <td className="mono">{l.items.length}</td>
                <td className="sm">{l.fixed ? <span className="pill">ثابت (موتور)</span> : l.own ? <span className="pill ok">پروژه</span> : "پیش‌فرض سامانه"}</td>
              </tr>); })}</tbody>
          </table>
        </TableKit>
      </div>

      {cur && (
        <div className="card" data-list-items={key}>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <h2 style={{ margin: 0 }}>{cur.label}</h2>
            <span className="muted sm">{cur.used}</span>
            <span className="grow" />
            {editable && cur.own && <button type="button" className="ghost sm" data-list-reset onClick={reset}>بازگشت به مقادیر پیش‌فرض سامانه</button>}
          </div>
          {cur.fixed && <p className="note sm">این فهرست ثابت است: موتور و رجیستر فقط همین مقادیر را می‌شناسند.</p>}
          {editable && <p className="muted sm">روی یک ردیف بزنید تا همان‌جا ویرایش شود؛ «+» زیر جدول مقدار تازه می‌افزاید. چند مقدار را می‌توانید یکجا در کادر زیر جدول بچسبانید (از اکسل، هر مقدار در یک سطر). مقدار تکراری یک بار نگه داشته می‌شود.</p>}
          {msg && <p className="err" role="alert">{msg}</p>}
          {ok && <p className="ok sm" role="status">{ok}</p>}
          <TableKit key={key} name="value-list-items" rowEdit={rowEdit} onPaste={editable ? pasteMany : undefined}
            onDelete={editable ? (k) => save(items.filter((_, i) => i !== Number(k)), "حذف شد.") : undefined}>
            <table className="dtable" data-items={items.length}>
              <thead><tr><th>#</th><th>مقدار</th></tr></thead>
              <tbody>{items.map((v, i) => (
                <tr key={`${i}-${v}`} data-key={String(i)} data-item={v}><td className="mono sm">{i + 1}</td><td className="mono" dir="ltr">{v}</td></tr>))}
                {!items.length && <tr><td colSpan={2} className="muted sm">هنوز مقداری ندارد — تا پر نشود، این ستون در جدول‌ها دستی وارد می‌شود.</td></tr>}
              </tbody>
            </table>
          </TableKit>
          {editable && (
            <form className="row" style={{ alignItems: "flex-end", gap: 8, flexWrap: "wrap", marginTop: 8 }}
              onSubmit={async (e) => {
                e.preventDefault();
                const got = bulk.split(/\r?\n/).map((l) => l.split("\t")[0].trim()).filter(Boolean);
                if (got.length && await save([...items, ...got], `${got.length} مقدار افزوده شد (تکراری‌ها یک بار).`)) setBulk("");
              }}>
              <label className="field" style={{ flex: "1 1 260px" }}>
                <span className="muted sm">افزودن چند مقدار — هر مقدار در یک سطر (ستون اول آنچه از اکسل چسبانده شود)</span>
                <textarea data-list-bulk dir="ltr" rows={4} value={bulk} onChange={(e) => setBulk(e.target.value)} />
              </label>
              <button type="submit" disabled={!bulk.trim()}>افزودن به فهرست</button>
            </form>)}
        </div>)}
    </div>
  );
}
