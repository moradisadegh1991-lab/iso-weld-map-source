"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";
import Tabs from "../../components/ui/Tabs";
import { WorkDateScope, WorkDateField, useWorkDate } from "../../components/ui/WorkDate";
import { usePrefs } from "../../lib/client/prefs.mjs";

/**
 * Electrical: the cable schedule, each cable from route to energisation, and
 * the insulation test that decides whether it may be energised.
 *
 * The schedule is read by rule (lib/electrical/cable.mjs); what the rules
 * cannot read — a cable whose To names no tag, a construction or rating the
 * parser does not recognise — is shown as a job for a person, never filled
 * with a default. The IR column cannot be ticked: the recorded readings and
 * IEC 60364-6 answer it.
 */
function ElectricalPageBody() {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/electrical?projectId=${id}`, []);
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  const [msg, setMsg] = useState(null);
  const [q, setQ] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const mayRecord = can({ role }, ACTIONS.ASSIGN_WELD);
  const mayRegister = can({ role }, ACTIONS.EDIT_EXTRACTION);
  const { t } = usePrefs();

  const load = async (id) => setDetail(await call(`/api/electrical?projectId=${projectId}&cableId=${id}`));
  async function expand(id) {
    if (open === id) { setOpen(null); setDetail(null); return; }
    setOpen(id); setDetail(null);
    try { await load(id); } catch (e) { setMsg(e.message); }
  }
  async function post(body) {
    setMsg(null);
    try {
      const r = await call("/api/electrical", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      if (open) await load(open);
      reload();
      return r || true;
    } catch (e) { setMsg(e.message); return false; }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">{t("common.loading")}</p>;

  const cables = data.cables;
  const issue = (c) => !c.toTagNo || !c.voltageClass || !c.cores || c.ir.note?.level === "bad";
  const shown = cables.filter((c) => (!onlyIssues || issue(c))
    && (!q || `${c.cableNo} ${c.from} ${c.to} ${c.toTagNo || ""}`.toLowerCase().includes(q.toLowerCase())));
  const ready = cables.filter((c) => c.ready).length;
  const irBad = cables.filter((c) => c.ir.note?.level === "bad").length;
  const noTag = cables.filter((c) => !c.toTagNo).length;
  const noClass = cables.filter((c) => !c.voltageClass || !c.cores).length;
  const hasMv = cables.some((c) => c.voltageClass === "MV");

  return (
    <div className="page">
      <div className="pagehead">
        <h1>{t("el.title")}</h1>
        <span className="sub">
          {t("el.sub", { n: cables.length, ready })}
          {irBad > 0 && ` · ${t("el.subIr", { n: irBad })}`}
          {noTag > 0 && ` · ${t("el.subNoTag", { n: noTag })}`}
          {noClass > 0 && ` · ${t("el.subNoClass", { n: noClass })}`}
        </span>
      </div>
      <WorkDateField />

      <Tabs name="electrical">
      {msg && <p className="err">{msg}</p>}

      {(data.spec.lvSystemVoltageV === null || (hasMv && (data.spec.mvTestVoltageV === null || data.spec.mvMinMohm === null))) && (
        <div className="card" data-keep style={{ borderColor: "rgba(224,163,62,.5)" }}>
          <h2 style={{ color: "var(--warn)" }}>{t("el.specIncomplete")}</h2>
          <p className="muted sm">
            {data.spec.lvSystemVoltageV === null && `${t("el.noLv")} `}
            {hasMv && (data.spec.mvTestVoltageV === null || data.spec.mvMinMohm === null) && `${t("el.noMv")} `}
            {t("el.setIn")} <a href="/project" className="cy">{t("el.projectElectrical")}</a>{t("el.setInEnd")}
          </p>
        </div>
      )}

      <div className="card">
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <h2 style={{ marginInlineEnd: "auto" }}>{t("el.cables")}</h2>
          <input className="search" placeholder={t("el.search")} value={q} onChange={(e) => setQ(e.target.value)}
                 style={{ maxWidth: 260 }} aria-label={t("pu.v.search")} />
          <label className="sm" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
            {t("el.onlyIssues")}
          </label>
        </div>
        {cables.length === 0 ? <p className="empty-note">{t("el.empty")}</p> : (
          <TableKit name="electrical-1">
            <table className="dtable">
              <thead>
                <tr><th>{t("el.cable")}</th><th>{t("el.fromTo")}</th><th>{t("el.equipment")}</th><th>{t("el.spec")}</th><th>{t("el.class")}</th><th>{t("el.lengthM")}</th>
                    <th>{t("eq.progress")}</th><th>{t("co.canToday")}</th><th>IR</th><th /></tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <CableRow key={c.id} c={c} open={open === c.id} detail={open === c.id ? detail : null}
                    onToggle={() => expand(c.id)} mayRecord={mayRecord} mayRegister={mayRegister}
                    post={post} tags={data.tags} />
                ))}
              </tbody>
            </table>
          </TableKit>
        )}
        {mayRegister && <Fold title={t("el.import")}><Import post={post} /></Fold>}
      </div>

      </Tabs>
    </div>
  );
}

function CableRow({ c, open, detail, onToggle, mayRecord, mayRegister, post, tags }) {
  const { t, L } = usePrefs();
  const step = (code, title) => L(`chain.cable.${code}`, title);
  return (
    <>
      <tr>
        <td className="mono">{c.cableNo}</td>
        <td className="sm">{c.from || "—"} → {c.to || "—"}</td>
        <td className="mono">{c.toTagNo || <span className="pill bad">{t("eq.unknownKind")}</span>}</td>
        <td className="mono sm">{c.cores ? `${c.cores}×${c.sizeMm2}` : <span className="pill bad">{t("el.unreadable")}</span>}</td>
        <td className="mono sm">{c.voltageClass ? `${c.voltageClass} · ${c.rating}` : <span className="pill bad">{t("eq.unknownKind")}</span>}</td>
        <td className="mono">{c.lengthM ?? "—"}</td>
        <td><Bar pct={c.pct} /></td>
        <td className="sm">
          {c.ready ? <span className="pill ok">{t("el.ready")}</span> : c.next.map((n) => step(n.code, n.title)).join(t("c.sep")) || "—"}
          {c.outOfOrder.length > 0 && <div><span className="pill bad">{t("co.outOfOrder")} {(c.outOfOrderCodes || []).map((k, j) => step(k, c.outOfOrder[j])).join(t("c.sep"))}</span></div>}
        </td>
        <td>{c.ir.status === "done" ? <span className="pill ok">{t("co.v.accepted")}</span>
          : c.ir.note?.level === "bad" ? <span className="pill bad">{t("co.v.rejected")}</span>
          : c.ir.note?.level === "warn" ? <span className="pill">{t("hs.noVerdict")}</span>
          : <span className="muted sm">—</span>}</td>
        <td><button className="btn ghost" style={{ padding: "4px 10px" }} onClick={onToggle}>
          {open ? t("common.close") : t("pu.details")}</button></td>
      </tr>
      {open && (
        <tr>
          <td colSpan={10} style={{ background: "rgba(255,255,255,.02)" }}>
            {!detail ? <span className="muted sm">{t("common.loading")}</span>
              : <Detail c={c} s={detail.status} mayRecord={mayRecord} mayRegister={mayRegister} post={post} tags={tags} />}
          </td>
        </tr>
      )}
    </>
  );
}

function Detail({ c, s, mayRecord, mayRegister, post, tags }) {
  const workOn = useWorkDate();
  const req = s.ir.requirement;
  const [f, setF] = useState({ testVoltageV: req.testV || "", readings: "", testedOn: today(), instrumentRef: "", tester: "" });
  const { t, L, date } = usePrefs();
  const name = (x) => L(`chain.cable.${x.code}`, x.title);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))" }}>
        {s.steps.map((x) => (
          <div key={x.code} className="card" style={{ padding: 10, gap: 6,
            borderColor: x.note?.level === "bad" ? "rgba(226,87,76,.6)"
              : x.status === "done" ? "rgba(63,178,127,.5)"
              : x.blocked ? undefined : "rgba(67,160,180,.6)" }}>
            <span className="sm"><b>{x.derived && !x.na ? "⚙ " : ""}{name(x)}</b></span>
            <span className="sm muted">
              {x.na ? t("el.naLv")
                : x.status === "done" ? (x.doneAt ? t("st.doneOn", { on: date(x.doneAt) }) : t("st.done"))
                : x.claimedOn ? t("st.claimed", { on: date(x.claimedOn) })
                : x.rejected ? t("st.rejected", { why: x.rejected })
                : x.note?.level === "bad" ? t("co.fix")
                : x.derived && x.note?.level === "warn" ? t("hs.noVerdict")
                : x.claimable ? t("st.claimable")
                : x.blocked ? t("st.waiting", { list: x.waitingOn.map(name).join(t("c.sep")) })
                : t("st.ready")}
            </span>
            {x.note && <span className={"sm " + (x.note.level === "bad" ? "err" : "muted")}>{x.note.text}</span>}
            {x.outOfOrder && <span className="pill bad">{t("st.outOfOrder")}</span>}
            {mayRecord && !x.derived && !x.na && x.status !== "done" && (!x.blocked || x.claimable) && (
              <button className="btn" style={{ padding: "4px 10px" }}
                      onClick={() => post({ kind: "activity", cableId: c.id, code: x.code, doneAt: workOn })}>
                {t("st.record")}</button>
            )}
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: 12 }}>
        <h2>{t("el.ir.title")} {req.cite && <span className="muted sm">— {req.cite}</span>}</h2>
        <p className="muted sm">
          {req.reason ? req.reason
            : t("el.ir.rule", { v: req.testV, min: req.minMohm, n: c.cores ?? "?" })}
        </p>
        {s.ir.tests.length > 0 && (
          <TableKit name="electrical-2">
            <table className="dtable">
              <thead><tr><th>{t("c.date")}</th><th>{t("el.ir.testV")}</th><th>{t("el.ir.readings")}</th><th>{t("el.ir.instrument")}</th></tr></thead>
              <tbody>
                {s.ir.tests.map((x, i) => (
                  <tr key={i}>
                    <td className="mono">{date(x.tested_on)}</td>
                    <td className="mono">{x.test_voltage_v}</td>
                    <td className="mono">{(x.readings || []).join(" / ")}</td>
                    <td className="mono">{x.instrument_ref || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableKit>
        )}
        {mayRecord && (
          <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => {
            e.preventDefault();
            if (await post({ kind: "ir", cableId: c.id, ...f })) setF({ ...f, readings: "" });
          }}>
            <Field id="ir-v" label={t("el.ir.formV")} type="number" value={f.testVoltageV}
                   on={(v) => setF({ ...f, testVoltageV: v })} required />
            <Field id="ir-r" label={t("el.ir.formReadings")} value={f.readings} on={(v) => setF({ ...f, readings: v })}
                   required hint={t("el.ir.readingsHint", { n: c.cores ?? "?" })} />
            <Field id="ir-on" label={t("c.date")} type="date" value={f.testedOn} on={(v) => setF({ ...f, testedOn: v })} required />
            <Field id="ir-inst" label={t("el.ir.formInstrument")} value={f.instrumentRef}
                   on={(v) => setF({ ...f, instrumentRef: v })} />
            <Field id="ir-by" label={t("el.ir.tester")} value={f.tester} on={(v) => setF({ ...f, tester: v })} />
            <div><button className="btn" type="submit">{t("el.ir.save")}</button></div>
          </form>
        )}
      </div>

      {mayRegister && <Correct c={c} post={post} tags={tags} />}
    </div>
  );
}

/** What the schedule could not say, said by a person. */
function Correct({ c, post, tags }) {
  const [f, setF] = useState({ toTagId: c.toTagId || "", spec: c.spec || "", rating: c.rating || "",
    systemVoltageV: c.systemVoltageV ?? "" });
  const { t } = usePrefs();
  return (
    <form className="card" style={{ padding: 12 }} onSubmit={async (e) => {
      e.preventDefault();
      // Only what changed: re-sending an unreadable construction would refuse
      // a correction that was only about the tag.
      const changed = (a, b) => String(a ?? "") !== String(b ?? "");
      await post({ kind: "correct", cableId: c.id,
        toTagId: changed(f.toTagId, c.toTagId) ? f.toTagId || null : undefined,
        spec: changed(f.spec, c.spec) && f.spec ? f.spec : undefined,
        rating: changed(f.rating, c.rating) && f.rating ? f.rating : undefined,
        systemVoltageV: changed(f.systemVoltageV, c.systemVoltageV) ? f.systemVoltageV : undefined });
    }}>
      <h2>{t("el.fix.title")}</h2>
      <div className="grid2">
        <div className="field"><label htmlFor="cr-tag">{t("el.fix.feeds")}</label>
          <select id="cr-tag" value={f.toTagId} onChange={(e) => setF({ ...f, toTagId: e.target.value })}>
            <option value="">{t("el.fix.none")}</option>
            {tags.map((x) => <option key={x.id} value={x.id}>{x.tag_no}</option>)}
          </select>
          <span className="hint">{t("el.fix.feedsHint")}</span>
        </div>
        <Field id="cr-spec" label={t("el.fix.spec")} value={f.spec} on={(v) => setF({ ...f, spec: v })} />
        <Field id="cr-rating" label={t("el.fix.rating")} value={f.rating} on={(v) => setF({ ...f, rating: v })} />
        <Field id="cr-v" label={t("el.fix.systemV")} type="number" value={f.systemVoltageV}
               on={(v) => setF({ ...f, systemVoltageV: v })} hint={t("el.fix.systemVHint")} />
      </div>
      <div><button className="btn" type="submit">{t("hs.jsa.saveEdit")}</button></div>
    </form>
  );
}

function Import({ post }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);
  const { t } = usePrefs();
  return (
    <form className="card" onSubmit={async (e) => {
      e.preventDefault();
      const r = await post({ kind: "import", text });
      if (r) { setResult(r); setText(""); }
    }}>
      <h2>{t("el.import")}</h2>
      <p className="muted sm">{t("el.import.note")}</p>
      <div className="field">
        <label htmlFor="imp">{t("el.import.list")}</label>
        <textarea id="imp" dir="ltr" rows={6} value={text} onChange={(e) => setText(e.target.value)}
                  placeholder={"Cable No,From,To,Cable Type,Voltage,Length (m)\nEC-001,MCC-12,P-1203A,3Cx35 XLPE/SWA,0.6/1kV,85"} />
      </div>
      <div><button className="btn" type="submit" disabled={!text.trim()}>{t("el.import.go")}</button></div>
      {result && (
        <div className="sm">
          <p className="pill ok">{t("el.import.done", { n: result.imported })}</p>
          {result.unmatched.length > 0 && <p className="muted">{t("el.import.unmatched")} <span className="mono">{result.unmatched.join(t("c.sep"))}</span></p>}
          {result.problems.map((p, i) => <p key={i} className="err">{t("c.row")} {p.line} {p.cableNo || ""}: {p.text}</p>)}
        </div>
      )}
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

function Bar({ pct }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span className="bar"><i style={{ width: `${pct}%` }} /></span>
      <span className="mono sm">{pct}%</span>
    </span>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

/** Every one-click record on this page carries the day chosen at its head (components/ui/WorkDate). */
export default function ElectricalPage() {
  return <WorkDateScope><ElectricalPageBody /></WorkDateScope>;
}
