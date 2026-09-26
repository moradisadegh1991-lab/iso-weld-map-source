"use client";
import { useState } from "react";
import { useProjectData } from "../../lib/client/platform.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";

/**
 * MESC numbers of the stock items, checked against the owner's catalogue.
 * Rules: lib/warehouse/mesc.mjs — the platform holds no MESC numbers of its own.
 */
const TONE = { none: "", unverified: "warn", unknown: "bad", uom: "bad", ok: "ok" };

export default function Mesc({ projectId, call, may }) {
  const { data, error, reload } = useProjectData((id) => `/api/warehouse/mesc?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  const [open, setOpen] = useState(null);

  async function post(body) {
    setMsg(null);
    try {
      const r = await call("/api/warehouse/mesc", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      reload();
      return r || true;
    } catch (e) { setMsg(e.message); return false; }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return null;
  const coded = data.items.filter((i) => i.mesc_code).length;
  const bad = data.items.filter((i) => ["unknown", "uom"].includes(i.state.code)).length;

  return (
    <div className="card">
      <h2>کد MESC کالاها</h2>
      <p className="muted sm">
        کد ده‌رقمی: گروه اصلی (۲) · زیرگروه (۲) · زیرگروه فرعی (۲) · کالا (۳) · رقم آخر (۱). کدها و عنوان گروه‌ها از کاتالوگ MESC کارفرما خوانده
        می‌شوند؛ پلتفرم کدی نمی‌سازد و حدس نمی‌زند.{" "}
        {data.entries ? `کاتالوگ: ${data.edition} — ${data.entries} کد.` : "کاتالوگی بارگذاری نشده؛ کدهای ثبت‌شده «بررسی‌نشده» می‌مانند."}
        {" "}{coded} از {data.items.length} کالا کد دارند{bad > 0 && `؛ ${bad} کد مغایر`}.
      </p>
      {msg && <p className="err">{msg}</p>}
      <TableKit name="mesc">
        <table className="dtable">
          <thead><tr><th>کالا</th><th>شرح</th><th>واحد</th><th>MESC</th><th>وضعیت</th><th>گروه</th><th /></tr></thead>
          <tbody>
            {data.items.map((i) => (
              <tr key={i.id}>
                <td className="mono">{i.code}</td><td>{i.description}</td><td className="mono">{i.uom}</td>
                <td className="mono" dir="ltr">{i.formatted || "—"}{i.mesc_description && <div className="muted sm">{i.mesc_description}</div>}</td>
                <td><span className={`pill ${TONE[i.state.code]}`}>{i.state.text}</span></td>
                <td className="sm">{i.path ? i.path.map((p) => p.title || `${p.prefix} (؟)`).join(" › ") : "—"}</td>
                <td>{may && <button className="btn ghost" onClick={() => setOpen(open === i.id ? null : i.id)}>{open === i.id ? "بستن" : "تعیین کد"}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableKit>
      {data.items.filter((i) => i.id === open).map((i) => <Assign key={i.id} i={i} projectId={projectId} call={call} post={post} />)}
      {may && <Fold title="بارگذاری کاتالوگ MESC"><Catalogue post={post} imports={data.imports} /></Fold>}
    </div>
  );
}

function Assign({ i, projectId, call, post }) {
  const [code, setCode] = useState(i.formatted || "");
  const [q, setQ] = useState(i.description);
  const [found, setFound] = useState(null);
  async function search(e) {
    e.preventDefault();
    const r = await call(`/api/warehouse/mesc?projectId=${projectId}&q=${encodeURIComponent(q)}`);
    setFound(r.matches);
  }
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3>{i.code} — {i.description}</h3>
      <form onSubmit={search} style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
        <div className="field" style={{ flex: 1 }}><label htmlFor={`mq-${i.id}`}>جست‌وجو در کاتالوگ (شرح یا ابتدای کد)</label>
          <input id={`mq-${i.id}`} dir="auto" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <button className="btn ghost">جست‌وجو</button>
      </form>
      {found && (found.length === 0 ? <p className="muted sm">چیزی پیدا نشد.</p> : (
        <table className="dtable">
          <thead><tr><th>MESC</th><th>شرح کاتالوگ</th><th>واحد</th><th /></tr></thead>
          <tbody>
            {found.map((f) => (
              <tr key={f.code}>
                <td className="mono" dir="ltr">{f.formatted}</td><td>{f.description}</td><td className="mono">{f.uom || "—"}</td>
                <td>{f.usedBy ? <span className="muted sm">کالای {f.usedBy}</span>
                  : <button className="btn ghost" onClick={() => setCode(f.formatted)}>انتخاب</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      <form style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap", marginTop: 8 }}
            onSubmit={async (e) => { e.preventDefault(); await post({ kind: "item", itemId: i.id, mescCode: code }); }}>
        <div className="field"><label htmlFor={`mc-${i.id}`}>کد MESC</label>
          <input id={`mc-${i.id}`} dir="ltr" placeholder="XX.XX.XX.XXX.X" value={code} onChange={(e) => setCode(e.target.value)} /></div>
        <button className="btn">ثبت کد</button>
        {i.mesc_code && <button type="button" className="btn ghost" onClick={() => post({ kind: "item", itemId: i.id, mescCode: "" })}>حذف کد</button>}
      </form>
    </div>
  );
}

function Catalogue({ post, imports }) {
  const [f, setF] = useState({ edition: "", text: "" });
  async function file(e) {
    const fl = e.target.files?.[0];
    if (fl) setF({ ...f, text: await fl.text() });
  }
  return (
    <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "catalogue", ...f })) setF({ edition: "", text: "" }); }}>
      <p className="muted sm">CSV با سه ستون: کد، شرح، واحد (جداکننده ویرگول، ; یا Tab). کد ۲، ۴ یا ۶ رقمی عنوان گروه است و ۱۰ رقمی کالا.
        شرحی که ویرگول دارد داخل "…" بیاید. فایلی که حتی یک خط نامعتبر داشته باشد کامل رد می‌شود.</p>
      <div className="field"><label htmlFor="mesc-ed">ویرایش کاتالوگ</label>
        <input id="mesc-ed" dir="auto" value={f.edition} onChange={(e) => setF({ ...f, edition: e.target.value })} /></div>
      <div className="field"><label htmlFor="mesc-file">فایل CSV</label><input id="mesc-file" type="file" accept=".csv,.txt,.tsv" onChange={file} /></div>
      <div className="field"><label htmlFor="mesc-text">یا متن کاتالوگ</label>
        <textarea id="mesc-text" dir="ltr" rows={5} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></div>
      <button className="btn">بارگذاری</button>
      {imports.length > 0 && <ul className="sm">{imports.map((m, k) => <li key={k}>{m.edition} — {m.entries} کد، {m.groups} گروه — {new Date(m.at).toLocaleDateString("fa-IR")}{m.by_name && ` — ${m.by_name}`}</li>)}</ul>}
    </form>
  );
}
