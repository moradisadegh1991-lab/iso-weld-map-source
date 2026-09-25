"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import { PREP_GRADES, INSULATION, dewPoint, minReadings } from "../../lib/coating/coating.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";

/**
 * Painting and insulation: the systems from the painting specification, the
 * items they are applied to, and what the inspector measured.
 *
 * Nothing the gauge answers is ticked here. Preparation, every coat and the
 * insulation thickness come from the readings (ISO 8501-1, ISO 19840, the
 * dew point), and a spool's insulation waits for its leak test (B31.3
 * §345.3.1). The dew point is computed as the inspector types, so a coat is
 * not applied into condensation that nobody calculated.
 */
export default function CoatingPage() {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/coating?projectId=${id}`, []);
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  const [msg, setMsg] = useState(null);
  const mayRecord = can({ role }, ACTIONS.ASSIGN_WELD);
  const mayRegister = can({ role }, ACTIONS.EDIT_EXTRACTION);

  const load = async (id) => setDetail(await call(`/api/coating?projectId=${projectId}&itemId=${id}`));
  async function expand(id) {
    if (open === id) { setOpen(null); setDetail(null); return; }
    setOpen(id); setDetail(null);
    try { await load(id); } catch (e) { setMsg(e.message); }
  }
  async function post(body) {
    setMsg(null);
    try {
      const r = await call("/api/coating", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      if (open) await load(open);
      reload();
      return r || true;
    } catch (e) { setMsg(e.message); return false; }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;

  const items = data.items;
  const ready = items.filter((i) => i.ready).length;
  const bad = items.filter((i) => [i.prep, i.coats, i.insul].some((x) => x.note?.level === "bad")).length;
  const held = items.filter((i) => i.insul.note?.level === "hold").length;

  return (
    <div className="page">
      <div className="pagehead">
        <h1>رنگ و عایق</h1>
        <span className="sub">
          {items.length} آیتم · {ready} تحویل‌شده
          {bad > 0 && ` · ${bad} با بازرسی ردشده`}
          {held > 0 && ` · ${held} عایق منتظر تست فشار`}
          {` · ${data.unassigned.spools.length} اسپول بدون سیستم رنگ`}
        </span>
      </div>
      {msg && <p className="err">{msg}</p>}

      <Systems systems={data.systems} mayRegister={mayRegister} post={post} spec={data.spec} />

      <div className="card">
        <h2>آیتم‌ها</h2>
        {items.length === 0 ? <p className="empty-note">هنوز به هیچ اسپول یا سازه‌ای سیستم رنگ داده نشده است.</p> : (
          <TableKit name="coating">
            <table className="dtable">
              <thead>
                <tr><th>آیتم</th><th>سیستم</th><th>عایق</th><th>مساحت m²</th><th>پیشرفت</th><th>امروز می‌شود</th>
                    <th>آماده‌سازی</th><th>لایه‌ها</th><th>عایق</th><th /></tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <ItemRow key={i.id} i={i} open={open === i.id} detail={open === i.id ? detail : null}
                           onToggle={() => expand(i.id)} mayRecord={mayRecord} mayRegister={mayRegister}
                           post={post} spec={data.spec} />
                ))}
              </tbody>
            </table>
          </TableKit>
        )}
      </div>

      {mayRegister && data.systems.length > 0 && <Fold title="تخصیص سیستم رنگ و عایق"><Assign data={data} post={post} /></Fold>}
    </div>
  );
}

function Systems({ systems, mayRegister, post, spec }) {
  const blank = { code: "", title: "", prepGrade: "Sa 2½", profileMinUm: "", profileMaxUm: "", coats: "", maxDftUm: "" };
  const [f, setF] = useState(blank);
  return (
    <div className="card">
      <h2>سیستم‌های رنگ (از مشخصات رنگ پروژه)</h2>
      <p className="muted sm">
        شرایط اعمال: فولاد دست‌کم {spec.marginC} °C بالای نقطهٔ شبنم{spec.marginStated ? " (مشخصات پروژه)" : " (ISO 8502-4)"}
        {spec.maxRh !== null ? ` · رطوبت حداکثر ${spec.maxRh}%` : " · حد رطوبت در مشخصات پروژه ثبت نشده — سنجیده نمی‌شود"}.
        DFT طبق ISO 19840 (قاعدهٔ ۸۰/۲۰) و روی قرائت تجمعی پس از هر لایه.
      </p>
      {systems.length > 0 && (
        <TableKit name="coating">
          <table className="dtable">
            <thead><tr><th>کد</th><th>شرح</th><th>آماده‌سازی</th><th>پروفیل µm</th><th>لایه‌ها (DFT اسمی µm)</th><th>حداکثر DFT</th></tr></thead>
            <tbody>
              {systems.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.code}</td>
                  <td className="sm">{s.title || "—"}</td>
                  <td className="mono">{s.prep_grade}</td>
                  <td className="mono">{s.profile_min_um != null ? `${Number(s.profile_min_um)}–${Number(s.profile_max_um)}` : "—"}</td>
                  <td className="sm">{s.coats.map((c) => `${c.name} ${c.ndft_um}`).join(" + ")}
                    <span className="muted"> = {s.coats.reduce((a, c) => a + Number(c.ndft_um), 0)}</span></td>
                  <td className="mono">{s.max_dft_um != null ? Number(s.max_dft_um) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableKit>
      )}
      {mayRegister && (
        <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => {
          e.preventDefault();
          const coats = f.coats.split(/\n|؛|;/).map((l) => l.trim()).filter(Boolean).map((l) => {
            const m = l.match(/^(.*?)[:：]\s*(\d+(?:\.\d+)?)$/);
            return m ? { name: m[1].trim(), ndftUm: Number(m[2]) } : { name: l, ndftUm: NaN };
          });
          if (await post({ kind: "system", ...f, coats })) setF(blank);
        }}>
          <Field id="cs-code" label="کد سیستم" value={f.code} on={(v) => setF({ ...f, code: v })} required />
          <Field id="cs-title" label="شرح" value={f.title} on={(v) => setF({ ...f, title: v })} />
          <Select id="cs-prep" label="آماده‌سازی الزامی (ISO 8501-1)" value={f.prepGrade} on={(v) => setF({ ...f, prepGrade: v })}
                  options={PREP_GRADES.map((g) => [g, g])} />
          <Field id="cs-pmin" label="پروفیل حداقل µm" type="number" value={f.profileMinUm} on={(v) => setF({ ...f, profileMinUm: v })} />
          <Field id="cs-pmax" label="پروفیل حداکثر µm" type="number" value={f.profileMaxUm} on={(v) => setF({ ...f, profileMaxUm: v })} />
          <Field id="cs-max" label="حداکثر DFT کل µm" type="number" value={f.maxDftUm} on={(v) => setF({ ...f, maxDftUm: v })} />
          <div className="field">
            <label htmlFor="cs-coats">لایه‌ها، هر خط «نام: DFT اسمی»</label>
            <textarea id="cs-coats" dir="ltr" rows={3} value={f.coats} onChange={(e) => setF({ ...f, coats: e.target.value })}
                      placeholder={"Zinc-rich epoxy primer: 75\nEpoxy MIO: 125\nPolyurethane finish: 50"} required />
          </div>
          <div><button className="btn" type="submit" disabled={!f.code}>ثبت سیستم</button></div>
        </form>
      )}
    </div>
  );
}

function Verdict({ v, na }) {
  if (!v) return <span className="muted sm">—</span>;
  if (v.na) return <span className="pill">{na || "ندارد"}</span>;
  if (v.status === "done") return <span className="pill ok">پذیرفته</span>;
  if (v.note?.level === "bad") return <span className="pill bad">رد</span>;
  if (v.status === "in_progress") return <span className="pill">در جریان</span>;
  if (v.note?.level === "warn") return <span className="pill">بدون حکم</span>;
  return <span className="muted sm">—</span>;
}

function ItemRow({ i, open, detail, onToggle, mayRecord, mayRegister, post, spec }) {
  return (
    <>
      <tr>
        <td className="mono">{i.label}</td>
        <td className="mono">{i.system}</td>
        <td className="sm">{INSULATION[i.insulation]}{i.insulationThkMm ? ` ${i.insulationThkMm} mm` : ""}</td>
        <td className="mono">{i.areaM2 ?? <span className="pill bad">ندارد</span>}</td>
        <td><Bar pct={i.pct} /></td>
        <td className="sm">
          {i.ready ? <span className="pill ok">تحویل‌شده</span> : i.next.map((n) => n.title).join("، ") || "—"}
          {i.outOfOrder.length > 0 && <div><span className="pill bad">خارج از ترتیب: {i.outOfOrder.join("، ")}</span></div>}
        </td>
        <td><Verdict v={i.prep} /></td>
        <td><Verdict v={i.coats} /></td>
        <td>{i.insul.note?.level === "hold"
          ? <span className="pill">منتظر تست فشار</span> : <Verdict v={i.insul} na="بدون عایق" />}</td>
        <td><button className="btn ghost" style={{ padding: "4px 10px" }} onClick={onToggle}>
          {open ? "بستن" : "جزئیات"}</button></td>
      </tr>
      {open && (
        <tr>
          <td colSpan={10} style={{ background: "rgba(255,255,255,.02)" }}>
            {!detail ? <span className="muted sm">در حال بارگذاری…</span>
              : <Detail i={i} s={detail.status} mayRecord={mayRecord} mayRegister={mayRegister} post={post} spec={spec} />}
          </td>
        </tr>
      )}
    </>
  );
}

function Detail({ i, s, mayRecord, mayRegister, post, spec }) {
  const it = s.item;
  const need = minReadings(it.area_m2);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))" }}>
        {s.steps.map((x) => (
          <div key={x.code} className="card" style={{ padding: 10, gap: 6,
            borderColor: x.note?.level === "bad" ? "rgba(226,87,76,.6)"
              : x.status === "done" ? "rgba(63,178,127,.5)"
              : x.blocked ? undefined : "rgba(67,160,180,.6)" }}>
            <span className="sm"><b>{x.derived ? "⚙ " : ""}{x.title}</b></span>
            <span className="sm muted">
              {x.na ? "این آیتم عایق ندارد"
                : x.status === "done" ? `انجام شد${x.doneAt ? " · " + fa(x.doneAt) : ""}`
                : x.note?.level === "bad" ? "رد — اصلاح لازم است"
                : x.note?.level === "hold" ? "منتظر تست فشار اسپول"
                : x.status === "in_progress" ? "در حال انجام"
                : x.derived && x.note?.level === "warn" ? "بدون حکم"
                : x.blocked ? `منتظر: ${x.waitingOn.map((w) => w.title).join("، ")}`
                : "آمادهٔ شروع"}
            </span>
            {x.note && <span className={"sm " + (x.note.level === "bad" ? "err" : "muted")}>{x.note.text}</span>}
            {x.outOfOrder && <span className="pill bad">خارج از ترتیب ثبت شده</span>}
            {mayRecord && !x.derived && !x.na && x.status !== "done" && !x.blocked && (
              <button className="btn" style={{ padding: "4px 10px" }}
                      onClick={() => post({ kind: "activity", itemId: i.id, code: x.code, doneAt: today() })}>
                ثبت انجام (امروز)</button>
            )}
          </div>
        ))}
      </div>
      <p className="muted sm">
        سیستم {it.system_code}: {it.prep_grade}
        {it.profile_min_um != null && ` · پروفیل ${Number(it.profile_min_um)}–${Number(it.profile_max_um)} µm`}
        {" · "}مساحت {it.area_m2 != null ? `${Number(it.area_m2)} m² → دست‌کم ${need} قرائت DFT برای هر لایه (ISO 19840)` : "ثبت نشده — DFT حکم نمی‌گیرد"}
        {s.spoolTested === false && " · تست فشار اسپول هنوز ثبت نشده"}
      </p>

      <Coats i={i} s={s} mayRecord={mayRecord} post={post} spec={spec} need={need} />
      {mayRecord && <Prep i={i} s={s} post={post} />}
      {mayRecord && it.insulation !== "none" && <Insulation i={i} s={s} post={post} />}
      {mayRegister && <Area i={i} post={post} />}
    </div>
  );
}

function Coats({ i, s, mayRecord, post, spec, need }) {
  const [c, setC] = useState({ coatNo: String((s.coats.find((x) => !x.ok)?.no) || 1), airC: "", rh: "", steelC: "", readings: "" });
  const air = c.airC === "" ? NaN : Number(c.airC), rh = c.rh === "" ? NaN : Number(c.rh);
  const td = Number.isFinite(air) && rh > 0 && rh <= 100 ? dewPoint(air, rh) : null;
  const margin = td !== null && c.steelC !== "" ? Number(c.steelC) - td : null;
  const count = c.readings.split(/[\s,،]+/).filter(Boolean).length;
  return (
    <div className="card" style={{ padding: 12 }}>
      <h2>لایه‌ها — DFT و شرایط اعمال</h2>
      <TableKit name="coating">
        <table className="dtable">
          <thead><tr><th>لایه</th><th>DFT اسمی تجمعی</th><th>نقطهٔ شبنم / فاصلهٔ فولاد</th><th>میانگین / کمینه / بیشینه</th><th>قرائت</th><th>حکم</th></tr></thead>
          <tbody>
            {s.coats.map((k) => (
              <tr key={k.no}>
                <td className="sm">{k.no}. {k.name}</td>
                <td className="mono">{k.nominal}</td>
                <td className="mono">{k.cond?.valid ? `${k.cond.dewPointC} °C / ${k.cond.marginC} °C` : "—"}</td>
                <td className="mono">{k.dft?.valid ? `${k.dft.mean} / ${k.dft.min} / ${k.dft.max}` : "—"}</td>
                <td className="mono">{k.dft ? (k.dft.valid ? `${k.dft.n} (≥${k.dft.required})` : "—") : "—"}</td>
                <td>{!k.record ? <span className="muted sm">اعمال نشده</span>
                  : k.ok ? <span className="pill ok">پذیرفته</span>
                  : <span className="pill bad" title={[k.cond?.reason, k.dft?.reason].filter(Boolean).join(" · ")}>
                      {[k.cond && !k.cond.ok ? "شرایط" : null, k.dft && !(k.dft.valid && k.dft.ok) ? "DFT" : null].filter(Boolean).join(" + ") || "رد"}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableKit>
      {mayRecord && (
        <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => {
          e.preventDefault();
          if (await post({ kind: "record", recordKind: "coat", itemId: i.id, recordedOn: today(), ...c })) {
            setC({ ...c, readings: "" });
          }
        }}>
          <Select id="ct-no" label="لایه" value={c.coatNo} on={(v) => setC({ ...c, coatNo: v })}
                  options={s.coats.map((k) => [String(k.no), `${k.no}. ${k.name}`])} />
          <Field id="ct-air" label="دمای هوا °C" type="number" value={c.airC} on={(v) => setC({ ...c, airC: v })} required />
          <Field id="ct-rh" label="رطوبت نسبی %" type="number" value={c.rh} on={(v) => setC({ ...c, rh: v })} required />
          <Field id="ct-steel" label="دمای سطح فولاد °C" type="number" value={c.steelC} on={(v) => setC({ ...c, steelC: v })} required
                 hint={td === null ? "نقطهٔ شبنم پس از ورود دما و رطوبت حساب می‌شود"
                   : `نقطهٔ شبنم ${round1(td)} °C${margin !== null ? ` · فولاد ${round1(margin)} °C بالاتر — ${margin >= spec.marginC ? "مجاز" : `کمتر از ${spec.marginC} °C، اعمال نکنید`}` : ""}`} />
          <Field id="ct-dft" label="قرائت‌های DFT تجمعی (µm)، با فاصله" value={c.readings} on={(v) => setC({ ...c, readings: v })}
                 required hint={`${count} قرائت${need ? ` — دست‌کم ${need} لازم است` : ""}`} />
          <div><button className="btn" type="submit">ثبت لایه</button></div>
        </form>
      )}
    </div>
  );
}

function Prep({ i, s, post }) {
  const [p, setP] = useState({ grade: s.item.prep_grade, profile: "" });
  return (
    <form className="card grid2" style={{ padding: 12, alignItems: "end" }} onSubmit={async (e) => {
      e.preventDefault();
      if (await post({ kind: "record", recordKind: "prep", itemId: i.id, recordedOn: today(), ...p })) setP({ ...p, profile: "" });
    }}>
      <h2 style={{ gridColumn: "1 / -1" }}>آماده‌سازی سطح {s.prep && (s.prep.ok ? <span className="pill ok">پذیرفته</span> : <span className="pill bad">رد</span>)}</h2>
      <Select id="pp-grade" label="درجهٔ حاصل (ISO 8501-1)" value={p.grade} on={(v) => setP({ ...p, grade: v })}
              options={PREP_GRADES.map((g) => [g, g])} />
      <Field id="pp-prof" label="پروفیل (µm)، با فاصله" value={p.profile} on={(v) => setP({ ...p, profile: v })} />
      <div><button className="btn" type="submit">ثبت آماده‌سازی</button></div>
    </form>
  );
}

function Insulation({ i, s, post }) {
  const [t, setT] = useState("");
  return (
    <form className="card grid2" style={{ padding: 12, alignItems: "end" }} onSubmit={async (e) => {
      e.preventDefault();
      if (await post({ kind: "record", recordKind: "insulation", itemId: i.id, recordedOn: today(), thicknessMm: t })) setT("");
    }}>
      <h2 style={{ gridColumn: "1 / -1" }}>عایق‌کاری — {INSULATION[s.item.insulation]} {Number(s.item.insulation_thk_mm)} mm</h2>
      <Field id="in-t" label="ضخامت‌های اندازه‌گیری‌شده (mm)" value={t} on={setT} required
             hint={s.spoolTested === false ? "تست فشار اسپول ثبت نشده — عایق تا پس از تست تأیید نمی‌شود (B31.3 §345.3.1)" : null} />
      <div><button className="btn" type="submit">ثبت ضخامت</button></div>
    </form>
  );
}

function Area({ i, post }) {
  const [a, setA] = useState(i.areaM2 ?? "");
  return (
    <form className="card grid2" style={{ padding: 12, alignItems: "end" }} onSubmit={async (e) => {
      e.preventDefault(); await post({ kind: "area", itemId: i.id, areaM2: a });
    }}>
      <Field id="ar" label="مساحت سطح (m²)" type="number" value={a} on={setA}
             hint="برای اسپول از π·OD·L خودکار حساب شده؛ برای سازه و تجهیز از نقشه وارد کنید" />
      <div><button className="btn ghost" type="submit">ذخیرهٔ مساحت</button></div>
    </form>
  );
}

function Assign({ data, post }) {
  const [f, setF] = useState({ systemId: data.systems[0].id, insulation: "none", insulationThkMm: "", areaM2: "" });
  const [pick, setPick] = useState(new Set());
  const [res, setRes] = useState(null);
  const toggle = (k) => { const n = new Set(pick); n.has(k) ? n.delete(k) : n.add(k); setPick(n); };
  const spoolIds = [...pick].filter((k) => k.startsWith("s:")).map((k) => k.slice(2));
  const tagIds = [...pick].filter((k) => k.startsWith("t:")).map((k) => k.slice(2));
  return (
    <form className="card" onSubmit={async (e) => {
      e.preventDefault();
      const r = await post({ kind: "assign", ...f, spoolIds, tagIds });
      if (r) { setRes(r); setPick(new Set()); }
    }}>
      <h2>تخصیص سیستم رنگ و عایق</h2>
      <div className="grid2">
        <Select id="as-sys" label="سیستم رنگ" value={f.systemId} on={(v) => setF({ ...f, systemId: v })}
                options={data.systems.map((s) => [s.id, `${s.code} — ${s.title || ""}`])} />
        <Select id="as-ins" label="عایق" value={f.insulation} on={(v) => setF({ ...f, insulation: v })}
                options={Object.entries(INSULATION)} />
        {f.insulation !== "none" && (
          <Field id="as-thk" label="ضخامت عایق (mm)" type="number" value={f.insulationThkMm}
                 on={(v) => setF({ ...f, insulationThkMm: v })} required />
        )}
        <Field id="as-area" label="مساحت (m²) — برای سازه و تجهیز" type="number" value={f.areaM2}
               on={(v) => setF({ ...f, areaM2: v })} hint="برای اسپول خالی بگذارید؛ از OD و طول حساب می‌شود" />
      </div>
      <div className="grid2">
        <div className="sm">
          <b>اسپول‌های بدون سیستم ({data.unassigned.spools.length})</b>
          {data.unassigned.spools.map((s) => (
            <label key={s.id} style={{ display: "flex", gap: 6 }}>
              <input type="checkbox" checked={pick.has(`s:${s.id}`)} onChange={() => toggle(`s:${s.id}`)} />
              <span className="mono">{s.line_no} / {s.spool_no}</span>
            </label>
          ))}
        </div>
        <div className="sm">
          <b>سازه و تجهیز بدون سیستم ({data.unassigned.tags.length})</b>
          {data.unassigned.tags.map((t) => (
            <label key={t.id} style={{ display: "flex", gap: 6 }}>
              <input type="checkbox" checked={pick.has(`t:${t.id}`)} onChange={() => toggle(`t:${t.id}`)} />
              <span className="mono">{t.tag_no}</span>
            </label>
          ))}
        </div>
      </div>
      <div><button className="btn" type="submit" disabled={!pick.size}>تخصیص به {pick.size} آیتم</button></div>
      {res && <p className="sm">{res.assigned} آیتم تخصیص یافت
        {res.noArea.length > 0 && <span className="err"> · بدون مساحت (DFT حکم نمی‌گیرد): {res.noArea.join("، ")}</span>}</p>}
    </form>
  );
}

function Field({ id, label, value, on, type = "text", required, hint }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} step={type === "number" ? "any" : undefined}
             dir={type === "text" ? "auto" : "ltr"} required={required}
             value={value} onChange={(e) => on(e.target.value)} />
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

function Select({ id, label, value, on, options, hint }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => on(e.target.value)}>
        {options.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

function Bar({ pct }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span className="bar"><i style={{ width: `${pct}%` }} /></span>
      <span className="mono sm">{pct}%</span>
    </span>
  );
}

const round1 = (n) => Math.round(n * 10) / 10;
const today = () => new Date().toISOString().slice(0, 10);
const fa = (d) => (d ? new Date(d).toLocaleDateString("fa-IR") : "—");
