"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import { PREP_GRADES, INSULATION, dewPoint, minReadings } from "../../lib/coating/coating.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";
import { useRemove } from "../../lib/client/remove.mjs";
import Tabs from "../../components/ui/Tabs";
import { WorkDateScope, WorkDateField, useWorkDate } from "../../components/ui/WorkDate";
import { usePrefs } from "../../lib/client/prefs.mjs";

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
function CoatingPageBody() {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/coating?projectId=${id}`, []);
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  const [msg, setMsg] = useState(null);
  const mayRecord = can({ role }, ACTIONS.ASSIGN_WELD);
  const mayRegister = can({ role }, ACTIONS.EDIT_EXTRACTION);
  const { t } = usePrefs();

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
  if (!data) return <p className="muted">{t("common.loading")}</p>;

  const items = data.items;
  const ready = items.filter((i) => i.ready).length;
  const bad = items.filter((i) => [i.prep, i.coats, i.insul].some((x) => x.note?.level === "bad")).length;
  const held = items.filter((i) => i.insul.note?.level === "hold").length;

  return (
    <div className="page">
      <div className="pagehead">
        <h1>{t("co.title")}</h1>
        <span className="sub">
          {t("co.sub", { n: items.length, ready })}
          {bad > 0 && ` · ${t("co.subBad", { n: bad })}`}
          {held > 0 && ` · ${t("co.subHeld", { n: held })}`}
          {` · ${t("co.subUnassigned", { n: data.unassigned.spools.length })}`}
        </span>
      </div>
      <WorkDateField />
      <Tabs name="coating">
      {msg && <p className="err">{msg}</p>}

      <div className="card">
        <h2>{t("co.items")}</h2>
        {items.length === 0 ? <p className="empty-note">{t("co.itemsEmpty")}</p> : (
          <TableKit name="coating-1">
            <table className="dtable">
              <thead>
                <tr><th>{t("c.item")}</th><th>{t("co.system")}</th><th>{t("co.insulation")}</th><th>{t("co.areaM2")}</th><th>{t("eq.progress")}</th><th>{t("co.canToday")}</th>
                    <th>{t("co.prep")}</th><th>{t("co.coats")}</th><th>{t("co.insulation")}</th><th /></tr>
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
        {mayRegister && data.systems.length > 0 && <Fold title={t("co.assign")}><Assign data={data} post={post} /></Fold>}
      </div>

      <Systems systems={data.systems} mayRegister={mayRegister} post={post} spec={data.spec} reload={reload} />
      </Tabs>
    </div>
  );
}

function Systems({ systems, mayRegister, post, spec, reload }) {
  const [editing, setEditing] = useState(null);
  const removal = useRemove("coating-system", reload);
  const { t } = usePrefs();
  return (
    <div className="card">
      <h2>{t("co.systems")}</h2>
      <p className="muted sm">
        {t("co.cond", { margin: spec.marginC, src: spec.marginStated ? t("co.condProject") : "ISO 8502-4" })}
        {spec.maxRh !== null ? ` · ${t("co.maxRh", { rh: spec.maxRh })}` : ` · ${t("co.noRh")}`}.
        {" "}{t("co.dftNote")}
      </p>
      {systems.length > 0 && (
        <TableKit name="coating-2" {...(mayRegister ? removal : {})}
                  onEdit={mayRegister ? (id) => setEditing(systems.find((x) => x.id === id)) : undefined}
                  rowEdit={mayRegister ? { fields: [{ col: t("c.description"), name: "title" }, { col: t("co.prep"), name: "prepGrade", type: "select", options: PREP_GRADES.map((g) => [g, g]) },
                    { col: t("co.maxDft"), name: "maxDftUm", type: "number" }],
                    value: (id) => systemOf(systems.find((x) => x.id === id)), onSave: (id, v) => post({ kind: "system", ...v, coats: coatsOf(v.coats) }) } : undefined}>
          <table className="dtable">
            <thead><tr><th>{t("pu.h.code")}</th><th>{t("c.description")}</th><th>{t("co.prep")}</th><th>{t("co.profileUm")}</th><th>{t("co.coatsNdft")}</th><th>{t("co.maxDft")}</th></tr></thead>
            <tbody>
              {systems.map((s) => (
                <tr key={s.id} data-key={s.id}>
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
      {mayRegister && <Fold title={t("co.newSystem")}><SystemForm post={post} /></Fold>}
      {mayRegister && (
        <Fold title={t("co.editSystem", { code: editing?.code || "" })} button={false} open={!!editing} onClose={() => setEditing(null)}>
          {editing && <SystemForm key={editing.id} post={post} initial={editing} onDone={() => setEditing(null)} />}
        </Fold>
      )}
    </div>
  );
}

/** New, or the same form filled with a system to amend (its code is the key and stays). */
/** A system as its form holds it — the whole form, and the row edited in place. */
const s0 = (v) => (v === null || v === undefined ? "" : String(Number(v)));
const systemOf = (x) => ({ code: x.code, title: x.title || "", prepGrade: x.prep_grade,
  profileMinUm: s0(x.profile_min_um), profileMaxUm: s0(x.profile_max_um), maxDftUm: s0(x.max_dft_um),
  coats: x.coats.map((c) => `${c.name}: ${Number(c.ndft_um)}`).join("\n") });
/** "name: nominal DFT", one coat a line, as the server takes them. */
const coatsOf = (text) => text.split(/\n|؛|;/).map((l) => l.trim()).filter(Boolean).map((l) => {   // i18n: Persian separators accepted as typed
  const m = l.match(/^(.*?)[:：]\s*(\d+(?:\.\d+)?)$/);
  return m ? { name: m[1].trim(), ndftUm: Number(m[2]) } : { name: l, ndftUm: NaN };
});

function SystemForm({ post, initial = null, onDone }) {
  const blank = { code: "", title: "", prepGrade: "Sa 2½", profileMinUm: "", profileMaxUm: "", coats: "", maxDftUm: "" };
  const [f, setF] = useState(initial ? systemOf(initial) : blank);
  const x = initial ? "ce" : "cs";
  const { t } = usePrefs();
  return (
        <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => {
          e.preventDefault();
          if (await post({ kind: "system", ...f, coats: coatsOf(f.coats) })) { if (initial) onDone?.(); else setF(blank); }
        }}>
          <Field id={`${x}-code`} label={t("co.f.code")} value={f.code} on={(v) => setF({ ...f, code: v })} required readOnly={!!initial} />
          <Field id={`${x}-title`} label={t("c.description")} value={f.title} on={(v) => setF({ ...f, title: v })} />
          <Select id={`${x}-prep`} label={t("co.f.prep")} value={f.prepGrade} on={(v) => setF({ ...f, prepGrade: v })}
                  options={PREP_GRADES.map((g) => [g, g])} />
          <Field id={`${x}-pmin`} label={t("co.f.pmin")} type="number" value={f.profileMinUm} on={(v) => setF({ ...f, profileMinUm: v })} />
          <Field id={`${x}-pmax`} label={t("co.f.pmax")} type="number" value={f.profileMaxUm} on={(v) => setF({ ...f, profileMaxUm: v })} />
          <Field id={`${x}-max`} label={t("co.f.max")} type="number" value={f.maxDftUm} on={(v) => setF({ ...f, maxDftUm: v })} />
          <div className="field">
            <label htmlFor={`${x}-coats`}>{t("co.f.coats")}</label>
            <textarea id={`${x}-coats`} dir="ltr" rows={3} value={f.coats} onChange={(e) => setF({ ...f, coats: e.target.value })}
                      placeholder={"Zinc-rich epoxy primer: 75\nEpoxy MIO: 125\nPolyurethane finish: 50"} required />
          </div>
          <div><button className="btn" type="submit" disabled={!f.code}>{initial ? t("pu.v.saveChanges") : t("co.f.save")}</button></div>
        </form>
  );
}

function Verdict({ v, na }) {
  const { t } = usePrefs();
  if (!v) return <span className="muted sm">—</span>;
  if (v.na) return <span className="pill">{na || t("co.v.none")}</span>;
  if (v.status === "done") return <span className="pill ok">{t("co.v.accepted")}</span>;
  if (v.note?.level === "bad") return <span className="pill bad">{t("co.v.rejected")}</span>;
  if (v.status === "in_progress") return <span className="pill">{t("co.v.inProgress")}</span>;
  if (v.note?.level === "warn") return <span className="pill">{t("hs.noVerdict")}</span>;
  return <span className="muted sm">—</span>;
}

function ItemRow({ i, open, detail, onToggle, mayRecord, mayRegister, post, spec }) {
  const { t, L } = usePrefs();
  const step = (code, title) => L(`chain.coating.${code}`, title);
  return (
    <>
      <tr>
        <td className="mono">{i.label}</td>
        <td className="mono">{i.system}</td>
        <td className="sm">{L(`coat.ins.${i.insulation}`, INSULATION[i.insulation])}{i.insulationThkMm ? ` ${i.insulationThkMm} mm` : ""}</td>
        <td className="mono">{i.areaM2 ?? <span className="pill bad">{t("co.v.none")}</span>}</td>
        <td><Bar pct={i.pct} /></td>
        <td className="sm">
          {i.ready ? <span className="pill ok">{t("co.delivered")}</span> : i.next.map((n) => step(n.code, n.title)).join(t("c.sep")) || "—"}
          {i.outOfOrder.length > 0 && <div><span className="pill bad">{t("co.outOfOrder")} {(i.outOfOrderCodes || []).map((c, k) => step(c, i.outOfOrder[k])).join(t("c.sep"))}</span></div>}
        </td>
        <td><Verdict v={i.prep} /></td>
        <td><Verdict v={i.coats} /></td>
        <td>{i.insul.note?.level === "hold"
          ? <span className="pill">{t("co.waitTest")}</span> : <Verdict v={i.insul} na={L("coat.ins.none", INSULATION.none)} />}</td>
        <td><button className="btn ghost" style={{ padding: "4px 10px" }} onClick={onToggle}>
          {open ? t("common.close") : t("pu.details")}</button></td>
      </tr>
      {open && (
        <tr>
          <td colSpan={10} style={{ background: "rgba(255,255,255,.02)" }}>
            {!detail ? <span className="muted sm">{t("common.loading")}</span>
              : <Detail i={i} s={detail.status} mayRecord={mayRecord} mayRegister={mayRegister} post={post} spec={spec} />}
          </td>
        </tr>
      )}
    </>
  );
}

function Detail({ i, s, mayRecord, mayRegister, post, spec }) {
  const workOn = useWorkDate();
  const it = s.item;
  const need = minReadings(it.area_m2);
  const { t, L, date } = usePrefs();
  const name = (x) => L(`chain.coating.${x.code}`, x.title);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))" }}>
        {s.steps.map((x) => (
          <div key={x.code} className="card" style={{ padding: 10, gap: 6,
            borderColor: x.note?.level === "bad" ? "rgba(226,87,76,.6)"
              : x.status === "done" ? "rgba(63,178,127,.5)"
              : x.blocked ? undefined : "rgba(67,160,180,.6)" }}>
            <span className="sm"><b>{x.derived ? "⚙ " : ""}{name(x)}</b></span>
            <span className="sm muted">
              {x.na ? t("co.noInsulation")
                : x.status === "done" ? (x.doneAt ? t("st.doneOn", { on: date(x.doneAt) }) : t("st.done"))
                : x.claimedOn ? t("st.claimed", { on: date(x.claimedOn) })
                : x.rejected ? t("st.rejected", { why: x.rejected })
                : x.note?.level === "bad" ? t("co.fix")
                : x.note?.level === "hold" ? t("co.waitSpoolTest")
                : x.status === "in_progress" ? t("st.inProgress")
                : x.derived && x.note?.level === "warn" ? t("hs.noVerdict")
                : x.claimable ? t("st.claimable")
                : x.blocked ? t("st.waiting", { list: x.waitingOn.map(name).join(t("c.sep")) })
                : t("st.ready")}
            </span>
            {x.note && <span className={"sm " + (x.note.level === "bad" ? "err" : "muted")}>{x.note.text}</span>}
            {x.outOfOrder && <span className="pill bad">{t("st.outOfOrder")}</span>}
            {mayRecord && !x.derived && !x.na && x.status !== "done" && (!x.blocked || x.claimable) && (
              <button className="btn" style={{ padding: "4px 10px" }}
                      onClick={() => post({ kind: "activity", itemId: i.id, code: x.code, doneAt: workOn })}>
                {t("st.record")}</button>
            )}
          </div>
        ))}
      </div>
      <p className="muted sm">
        {t("co.d.system", { code: it.system_code })} {it.prep_grade}
        {it.profile_min_um != null && ` · ${t("co.d.profile", { min: Number(it.profile_min_um), max: Number(it.profile_max_um) })}`}
        {" · "}{it.area_m2 != null ? t("co.d.area", { a: Number(it.area_m2), n: need }) : t("co.d.noArea")}
        {s.spoolTested === false && ` · ${t("co.d.notTested")}`}
      </p>

      <Coats i={i} s={s} mayRecord={mayRecord} post={post} spec={spec} need={need} />
      {mayRecord && <Prep i={i} s={s} post={post} />}
      {mayRecord && it.insulation !== "none" && <Insulation i={i} s={s} post={post} />}
      {mayRegister && <Area i={i} post={post} />}
    </div>
  );
}

function Coats({ i, s, mayRecord, post, spec, need }) {
  const workOn = useWorkDate();
  const [c, setC] = useState({ coatNo: String((s.coats.find((x) => !x.ok)?.no) || 1), airC: "", rh: "", steelC: "", readings: "" });
  const air = c.airC === "" ? NaN : Number(c.airC), rh = c.rh === "" ? NaN : Number(c.rh);
  const td = Number.isFinite(air) && rh > 0 && rh <= 100 ? dewPoint(air, rh) : null;
  const margin = td !== null && c.steelC !== "" ? Number(c.steelC) - td : null;
  const count = c.readings.split(/[\s,،]+/).filter(Boolean).length;   // i18n: the Persian comma is a separator too
  const { t } = usePrefs();
  return (
    <div className="card" style={{ padding: 12 }}>
      <h2>{t("co.c.title")}</h2>
      <TableKit name="coating-3">
        <table className="dtable">
          <thead><tr><th>{t("co.c.coat")}</th><th>{t("co.c.nominal")}</th><th>{t("co.c.dew")}</th><th>{t("co.c.stats")}</th><th>{t("co.c.readings")}</th><th>{t("co.c.verdict")}</th></tr></thead>
          <tbody>
            {s.coats.map((k) => (
              <tr key={k.no}>
                <td className="sm">{k.no}. {k.name}</td>
                <td className="mono">{k.nominal}</td>
                <td className="mono">{k.cond?.valid ? `${k.cond.dewPointC} °C / ${k.cond.marginC} °C` : "—"}</td>
                <td className="mono">{k.dft?.valid ? `${k.dft.mean} / ${k.dft.min} / ${k.dft.max}` : "—"}</td>
                <td className="mono">{k.dft ? (k.dft.valid ? `${k.dft.n} (≥${k.dft.required})` : "—") : "—"}</td>
                <td>{!k.record ? <span className="muted sm">{t("co.c.notApplied")}</span>
                  : k.ok ? <span className="pill ok">{t("co.v.accepted")}</span>
                  : <span className="pill bad" title={[k.cond?.reason, k.dft?.reason].filter(Boolean).join(" · ")}>
                      {[k.cond && !k.cond.ok ? t("co.c.conditions") : null, k.dft && !(k.dft.valid && k.dft.ok) ? "DFT" : null].filter(Boolean).join(" + ") || t("co.v.rejected")}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableKit>
      {mayRecord && (
        <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => {
          e.preventDefault();
          if (await post({ kind: "record", recordKind: "coat", itemId: i.id, recordedOn: workOn, ...c })) {
            setC({ ...c, readings: "" });
          }
        }}>
          <Select id="ct-no" label={t("co.c.coat")} value={c.coatNo} on={(v) => setC({ ...c, coatNo: v })}
                  options={s.coats.map((k) => [String(k.no), `${k.no}. ${k.name}`])} />
          <Field id="ct-air" label={t("co.c.air")} type="number" value={c.airC} on={(v) => setC({ ...c, airC: v })} required />
          <Field id="ct-rh" label={t("co.c.rh")} type="number" value={c.rh} on={(v) => setC({ ...c, rh: v })} required />
          <Field id="ct-steel" label={t("co.c.steel")} type="number" value={c.steelC} on={(v) => setC({ ...c, steelC: v })} required
                 hint={td === null ? t("co.c.dewLater")
                   : `${t("co.c.dewIs", { td: round1(td) })}${margin !== null ? ` · ${t("co.c.steelAbove", { m: round1(margin) })} — ${margin >= spec.marginC ? t("co.c.ok") : t("co.c.tooLow", { min: spec.marginC })}` : ""}`} />
          <Field id="ct-dft" label={t("co.c.dftReadings")} value={c.readings} on={(v) => setC({ ...c, readings: v })}
                 required hint={`${t("co.c.count", { n: count })}${need ? ` — ${t("co.c.need", { n: need })}` : ""}`} />
          <div><button className="btn" type="submit">{t("co.c.save")}</button></div>
        </form>
      )}
    </div>
  );
}

function Prep({ i, s, post }) {
  const workOn = useWorkDate();
  const [p, setP] = useState({ grade: s.item.prep_grade, profile: "" });
  const { t } = usePrefs();
  return (
    <form className="card grid2" style={{ padding: 12, alignItems: "end" }} onSubmit={async (e) => {
      e.preventDefault();
      if (await post({ kind: "record", recordKind: "prep", itemId: i.id, recordedOn: workOn, ...p })) setP({ ...p, profile: "" });
    }}>
      <h2 style={{ gridColumn: "1 / -1" }}>{t("co.p.title")} {s.prep && (s.prep.ok ? <span className="pill ok">{t("co.v.accepted")}</span> : <span className="pill bad">{t("co.v.rejected")}</span>)}</h2>
      <Select id="pp-grade" label={t("co.p.grade")} value={p.grade} on={(v) => setP({ ...p, grade: v })}
              options={PREP_GRADES.map((g) => [g, g])} />
      <Field id="pp-prof" label={t("co.p.profile")} value={p.profile} on={(v) => setP({ ...p, profile: v })} />
      <div><button className="btn" type="submit">{t("co.p.save")}</button></div>
    </form>
  );
}

function Insulation({ i, s, post }) {
  const workOn = useWorkDate();
  const [thk, setThk] = useState("");
  const { t, L } = usePrefs();
  return (
    <form className="card grid2" style={{ padding: 12, alignItems: "end" }} onSubmit={async (e) => {
      e.preventDefault();
      if (await post({ kind: "record", recordKind: "insulation", itemId: i.id, recordedOn: workOn, thicknessMm: thk })) setThk("");
    }}>
      <h2 style={{ gridColumn: "1 / -1" }}>{t("co.i.title")} — {L(`coat.ins.${s.item.insulation}`, INSULATION[s.item.insulation])} {Number(s.item.insulation_thk_mm)} mm</h2>
      <Field id="in-t" label={t("co.i.measured")} value={thk} on={setThk} required
             hint={s.spoolTested === false ? t("co.i.notTested") : null} />
      <div><button className="btn" type="submit">{t("co.i.save")}</button></div>
    </form>
  );
}

function Area({ i, post }) {
  const [a, setA] = useState(i.areaM2 ?? "");
  const { t } = usePrefs();
  return (
    <form className="card grid2" style={{ padding: 12, alignItems: "end" }} onSubmit={async (e) => {
      e.preventDefault(); await post({ kind: "area", itemId: i.id, areaM2: a });
    }}>
      <Field id="ar" label={t("co.a.area")} type="number" value={a} on={setA} hint={t("co.a.hint")} />
      <div><button className="btn ghost" type="submit">{t("co.a.save")}</button></div>
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
  const { t, L } = usePrefs();
  return (
    <form className="card" onSubmit={async (e) => {
      e.preventDefault();
      const r = await post({ kind: "assign", ...f, spoolIds, tagIds });
      if (r) { setRes(r); setPick(new Set()); }
    }}>
      <h2>{t("co.assign")}</h2>
      <div className="grid2">
        <Select id="as-sys" label={t("co.s.system")} value={f.systemId} on={(v) => setF({ ...f, systemId: v })}
                options={data.systems.map((s) => [s.id, `${s.code} — ${s.title || ""}`])} />
        <Select id="as-ins" label={t("co.insulation")} value={f.insulation} on={(v) => setF({ ...f, insulation: v })}
                options={Object.entries(INSULATION).map(([k, v]) => [k, L(`coat.ins.${k}`, v)])} />
        {f.insulation !== "none" && (
          <Field id="as-thk" label={t("co.s.thk")} type="number" value={f.insulationThkMm}
                 on={(v) => setF({ ...f, insulationThkMm: v })} required />
        )}
        <Field id="as-area" label={t("co.s.area")} type="number" value={f.areaM2}
               on={(v) => setF({ ...f, areaM2: v })} hint={t("co.s.areaHint")} />
      </div>
      <div className="grid2">
        <div className="sm">
          <b>{t("co.s.spools", { n: data.unassigned.spools.length })}</b>
          {data.unassigned.spools.map((s) => (
            <label key={s.id} style={{ display: "flex", gap: 6 }}>
              <input type="checkbox" checked={pick.has(`s:${s.id}`)} onChange={() => toggle(`s:${s.id}`)} />
              <span className="mono">{s.line_no} / {s.spool_no}</span>
            </label>
          ))}
        </div>
        <div className="sm">
          <b>{t("co.s.tags", { n: data.unassigned.tags.length })}</b>
          {data.unassigned.tags.map((x) => (
            <label key={x.id} style={{ display: "flex", gap: 6 }}>
              <input type="checkbox" checked={pick.has(`t:${x.id}`)} onChange={() => toggle(`t:${x.id}`)} />
              <span className="mono">{x.tag_no}</span>
            </label>
          ))}
        </div>
      </div>
      <div><button className="btn" type="submit" disabled={!pick.size}>{t("co.s.assignN", { n: pick.size })}</button></div>
      {res && <p className="sm">{t("co.s.assigned", { n: res.assigned })}
        {res.noArea.length > 0 && <span className="err"> · {t("co.s.noArea")} {res.noArea.join(t("c.sep"))}</span>}</p>}
    </form>
  );
}

function Field({ id, label, value, on, type = "text", required, hint, readOnly }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} step={type === "number" ? "any" : undefined}
             dir={type === "text" ? "auto" : "ltr"} required={required} readOnly={readOnly}
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

/** Every one-click record on this page carries the day chosen at its head (components/ui/WorkDate). */
export default function CoatingPage() {
  return <WorkDateScope><CoatingPageBody /></WorkDateScope>;
}
