"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import { CATEGORIES } from "../../lib/instrumentation/isa.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";
import Tabs from "../../components/ui/Tabs";
import { WorkDateScope, WorkDateField, useWorkDate } from "../../components/ui/WorkDate";
import { usePrefs } from "../../lib/client/prefs.mjs";

/**
 * Instrumentation: the instrument index read by ISA 5.1, each instrument
 * from the bench to its loop check, and the loops themselves.
 *
 * Two things here cannot be ticked. A transmitter's or gauge's calibration
 * comes from its points; a loop check is signed once for the loop, and only
 * when every instrument in it is calibrated, installed, hooked up and wired.
 */
function InstrumentationPageBody() {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/instrumentation?projectId=${id}`, []);
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  const [msg, setMsg] = useState(null);
  const [q, setQ] = useState("");
  const mayRecord = can({ role }, ACTIONS.ASSIGN_WELD);
  const mayRegister = can({ role }, ACTIONS.EDIT_EXTRACTION);
  const { t } = usePrefs();

  const load = async (id) => setDetail(await call(`/api/instrumentation?projectId=${projectId}&instrumentId=${id}`));
  async function expand(id) {
    if (open === id) { setOpen(null); setDetail(null); return; }
    setOpen(id); setDetail(null);
    try { await load(id); } catch (e) { setMsg(e.message); }
  }
  async function post(body) {
    setMsg(null);
    try {
      const r = await call("/api/instrumentation", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      if (open) await load(open);
      reload();
      return r || true;
    } catch (e) { setMsg(e.message); return false; }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">{t("common.loading")}</p>;

  const list = data.instruments;
  const shown = list.filter((i) => !q || `${i.tagNo} ${i.service || ""} ${i.loopNo || ""} ${i.eqTagNo || ""}`
    .toLowerCase().includes(q.toLowerCase()));
  const ready = list.filter((i) => i.ready).length;
  const calBad = list.filter((i) => i.calibration.note?.level === "bad").length;
  const unread = list.filter((i) => !i.category).length;
  const checked = data.loops.filter((l) => l.checked).length;

  return (
    <div className="page">
      <div className="pagehead">
        <h1>{t("in.title")}</h1>
        <span className="sub">
          {t("in.sub", { n: list.length, loops: data.loops.length, checked, ready })}
          {calBad > 0 && ` · ${t("in.subCal", { n: calBad })}`}
          {unread > 0 && ` · ${t("in.subUnread", { n: unread })}`}
        </span>
      </div>
      <WorkDateField />
      <Tabs name="instrumentation">
      {msg && <p className="err">{msg}</p>}

      {data.spec.tolerancePct === null && (
        <div className="card" data-keep style={{ borderColor: "rgba(224,163,62,.5)" }}>
          <h2 style={{ color: "var(--warn)" }}>{t("in.noTol")}</h2>
          <p className="muted sm">
            {t("in.noTolNote")}{" "}
            <a href="/project" className="cy">{t("in.projectInstr")}</a>{t("in.noTolEnd")} {t("in.noTolBoth")}
          </p>
        </div>
      )}

      <div className="card">
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <h2 style={{ marginInlineEnd: "auto" }}>{t("in.instruments")}</h2>
          <input className="search" placeholder={t("in.search")} value={q} onChange={(e) => setQ(e.target.value)}
                 style={{ maxWidth: 260 }} aria-label={t("pu.v.search")} />
        </div>
        {list.length === 0 ? <p className="empty-note">{t("in.empty")}</p> : (
          <TableKit name="instrumentation-1">
            <table className="dtable">
              <thead>
                <tr><th>{t("c.tag")}</th><th>{t("in.type")}</th><th>{t("in.service")}</th><th>{t("in.loop")}</th><th>{t("el.equipment")}</th><th>{t("in.range")}</th>
                    <th>{t("eq.progress")}</th><th>{t("co.canToday")}</th><th>{t("in.calibration")}</th><th /></tr>
              </thead>
              <tbody>
                {shown.map((i) => (
                  <Row key={i.id} i={i} open={open === i.id} detail={open === i.id ? detail : null}
                       onToggle={() => expand(i.id)} mayRecord={mayRecord} mayRegister={mayRegister}
                       post={post} tags={data.tags} />
                ))}
              </tbody>
            </table>
          </TableKit>
        )}
        {mayRegister && <Fold title={t("in.import")}><Import post={post} /></Fold>}
      </div>

      <Loops loops={data.loops} mayRecord={mayRecord} post={post} />

      </Tabs>
    </div>
  );
}

function Loops({ loops, mayRecord, post }) {
  const { t } = usePrefs();
  if (!loops.length) return null;
  return (
    <div className="card">
      <h2>{t("in.loops")}</h2>
      <p className="muted sm">{t("in.loopsNote")}</p>
      <TableKit name="instrumentation-2">
        <table className="dtable">
          <thead><tr><th>{t("in.loop")}</th><th>{t("in.instruments")}</th><th>{t("c.status")}</th><th /></tr></thead>
          <tbody>{loops.map((l) => <LoopRow key={l.loopNo} l={l} mayRecord={mayRecord} post={post} />)}</tbody>
        </table>
      </TableKit>
    </div>
  );
}

/** One loop's sign-off: its own form number and witness — two loops signed the same day are two forms. */
function LoopRow({ l, mayRecord, post }) {
  const workOn = useWorkDate();
  const [ref, setRef] = useState("");
  const [witness, setWitness] = useState("");
  const { t } = usePrefs();
  return (
    <tr>
      <td className="mono">{l.loopNo}</td>
      <td className="mono sm">{l.members.join(t("c.sep"))}</td>
      <td>{l.checked ? <span className="pill ok">{t("in.checked")}</span>
        : l.ready ? <span className="pill">{t("in.readyCheck")}</span>
        : <span className="muted sm">{t("in.notComplete")}</span>}</td>
      <td>{mayRecord && !l.checked && l.ready && (
        <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <input className="search" placeholder={t("in.formNo")} value={ref} onChange={(e) => setRef(e.target.value)}
                 style={{ maxWidth: 150 }} aria-label={t("in.formNoOf", { loop: l.loopNo })} />
          <input className="search" placeholder={t("in.witness")} value={witness} onChange={(e) => setWitness(e.target.value)}
                 style={{ maxWidth: 150 }} aria-label={t("in.witnessOf", { loop: l.loopNo })} />
          <button className="btn" style={{ padding: "4px 10px" }}
                  onClick={() => post({ kind: "loop", loopNo: l.loopNo, checkedOn: workOn, refNo: ref || null, witnessedBy: witness || null })}>
            {t("in.signLoop")}</button>
        </span>
      )}</td>
    </tr>
  );
}

function Row({ i, open, detail, onToggle, mayRecord, mayRegister, post, tags }) {
  const c = i.calibration;
  const { t, L } = usePrefs();
  const step = (code, title) => L(`chain.instrument.${code}`, title);
  return (
    <>
      <tr>
        <td className="mono">{i.tagNo}</td>
        <td className="sm">{i.category ? L(`isa.cat.${i.category}`, CATEGORIES[i.category]) : <span className="pill bad">{t("el.unreadable")}</span>}</td>
        <td className="sm">{i.service || "—"}</td>
        <td className="mono sm">{i.loopNo || "—"}{i.loopDerived && <span className="muted"> (ISA)</span>}</td>
        <td className="mono">{i.eqTagNo || "—"}</td>
        <td className="mono sm">{i.range || "—"}</td>
        <td><Bar pct={i.pct} /></td>
        <td className="sm">
          {i.ready ? <span className="pill ok">{t("el.ready")}</span> : i.next.map((n) => step(n.code, n.title)).join(t("c.sep")) || "—"}
          {i.outOfOrder.length > 0 && <div><span className="pill bad">{t("co.outOfOrder")} {(i.outOfOrderCodes || []).map((k, j) => step(k, i.outOfOrder[j])).join(t("c.sep"))}</span></div>}
        </td>
        <td>{c.status === "done" ? <span className="pill ok">{c.derived ? t("co.v.accepted") : t("in.signed")}</span>
          : c.note?.level === "bad" ? <span className="pill bad">{t("co.v.rejected")}</span>
          : c.note?.level === "warn" ? <span className="pill">{t("hs.noVerdict")}</span>
          : <span className="muted sm">—</span>}</td>
        <td><button className="btn ghost" style={{ padding: "4px 10px" }} onClick={onToggle}>
          {open ? t("common.close") : t("pu.details")}</button></td>
      </tr>
      {open && (
        <tr>
          <td colSpan={10} style={{ background: "rgba(255,255,255,.02)" }}>
            {!detail ? <span className="muted sm">{t("common.loading")}</span>
              : <Detail i={i} s={detail.status} mayRecord={mayRecord} mayRegister={mayRegister} post={post} tags={tags} />}
          </td>
        </tr>
      )}
    </>
  );
}

function Detail({ i, s, mayRecord, mayRegister, post, tags }) {
  const workOn = useWorkDate();
  const req = s.calibration.requirement;
  const v = s.calibration.verdict;
  const [pts, setPts] = useState("");
  const [cref, setCref] = useState("");
  const { t, L, date } = usePrefs();
  const name = (x) => L(`chain.instrument.${x.code}`, x.title);
  const hint = req.reason ? "" : req.output === "mA"
    ? `${t("in.eg")} ${[0, 0.25, 0.5, 0.75, 1].map((f) => `${round(req.lo + f * (req.hi - req.lo))}:${round(4 + 16 * f)}`).join(" ")}`
    : `${t("in.eg")} ${[0, 0.25, 0.5, 0.75, 1].map((f) => { const a = round(req.lo + f * (req.hi - req.lo)); return `${a}:${a}`; }).join(" ")}`;
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
              {x.status === "done" ? `${x.doneAt ? t("st.doneOn", { on: date(x.doneAt) }) : t("st.done")}${x.refNo ? " · " + x.refNo : ""}`
              : x.claimedOn ? t("st.claimed", { on: date(x.claimedOn) })
              : x.rejected ? t("st.rejected", { why: x.rejected })
                : x.note?.level === "bad" ? t("co.fix")
                : x.derived && x.note?.level === "warn" ? t("hs.noVerdict")
                : x.claimable ? t("st.claimable")
                : x.blocked ? t("st.waiting", { list: x.waitingOn.map(name).join(t("c.sep")) })
                : x.derived && x.code === "loop_check" ? t("in.inLoops", { loop: i.loopNo })
                : t("st.ready")}
            </span>
            {x.note && <span className={"sm " + (x.note.level === "bad" ? "err" : "muted")}>{x.note.text}</span>}
            {x.outOfOrder && <span className="pill bad">{t("st.outOfOrder")}</span>}
            {mayRecord && !x.derived && x.status !== "done" && (!x.blocked || x.claimable) && (
              <button className="btn" style={{ padding: "4px 10px" }}
                      onClick={() => post({ kind: "activity", instrumentId: i.id, code: x.code, doneAt: workOn })}>
                {t("st.record")}</button>
            )}
          </div>
        ))}
      </div>

      {!req.reason || s.calibration.history.length > 0 ? (
        <div className="card" style={{ padding: 12 }}>
          <h2>{t("in.calibration")}</h2>
          <p className="muted sm">
            {req.reason || t("in.calRule", { lo: req.lo, hi: req.hi, out: req.output === "mA" ? "4–20 mA" : t("in.engUnits"), tol: req.tolerancePct })}
          </p>
          {v?.points && (
            <TableKit name="instrumentation-3">
              <table className="dtable">
                <thead><tr><th>{t("in.applied")}</th><th>{t("in.expected")}</th><th>{t("in.output")}</th><th>{t("in.errPct")}</th></tr></thead>
                <tbody>
                  {v.points.map((p, k) => (
                    <tr key={k}>
                      <td className="mono">{p.applied}</td><td className="mono">{p.expected}</td>
                      <td className="mono">{p.output}</td>
                      <td className="mono" style={{ color: p.errPct > req.tolerancePct ? "var(--bad)" : undefined }}>{p.errPct}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableKit>
          )}
          {mayRecord && !req.reason && (
            <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => {
              e.preventDefault();
              if (await post({ kind: "calibration", instrumentId: i.id, points: pts, calibratedOn: workOn,
                calibratorRef: cref || null })) setPts("");
            }}>
              <Field id="cal-p" label={t("in.points")} value={pts} on={setPts} required hint={hint} />
              <Field id="cal-ref" label={t("in.calibrator")} value={cref} on={setCref} />
              <div><button className="btn" type="submit">{t("in.saveCal")}</button></div>
            </form>
          )}
        </div>
      ) : null}

      {mayRegister && <Correct i={i} post={post} tags={tags} />}
    </div>
  );
}

function Correct({ i, post, tags }) {
  const [f, setF] = useState({ eqTagId: i.eqTagId || "", loopNo: i.loopNo || "", range: "", tolerancePct: i.tolerancePct ?? "" });
  const { t } = usePrefs();
  return (
    <form className="card" style={{ padding: 12 }} onSubmit={async (e) => {
      e.preventDefault();
      const changed = (a, b) => String(a ?? "") !== String(b ?? "");
      await post({ kind: "correct", instrumentId: i.id,
        eqTagId: changed(f.eqTagId, i.eqTagId) ? f.eqTagId || null : undefined,
        loopNo: changed(f.loopNo, i.loopNo) ? f.loopNo : undefined,
        range: f.range ? f.range : undefined,
        tolerancePct: changed(f.tolerancePct, i.tolerancePct) ? f.tolerancePct : undefined });
    }}>
      <h2>{t("in.fix.title")}</h2>
      <div className="grid2">
        <div className="field"><label htmlFor="ic-eq">{t("el.equipment")}</label>
          <select id="ic-eq" value={f.eqTagId} onChange={(e) => setF({ ...f, eqTagId: e.target.value })}>
            <option value="">{t("el.fix.none")}</option>
            {tags.map((x) => <option key={x.id} value={x.id}>{x.tag_no}</option>)}
          </select>
          <span className="hint">{t("in.fix.eqHint")}</span>
        </div>
        <Field id="ic-loop" label={t("in.fix.loop")} value={f.loopNo} on={(v) => setF({ ...f, loopNo: v })}
               hint={t("in.fix.loopHint")} />
        <Field id="ic-range" label={t("in.fix.range", { now: i.range || "—" })} value={f.range} on={(v) => setF({ ...f, range: v })}
               hint={t("in.fix.rangeHint")} />
        <Field id="ic-tol" label={t("in.fix.tol")} type="number" value={f.tolerancePct}
               on={(v) => setF({ ...f, tolerancePct: v })} hint={t("in.fix.tolHint")} />
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
      <h2>{t("in.import")}</h2>
      <p className="muted sm">{t("in.import.note")}</p>
      <div className="field">
        <label htmlFor="iimp">{t("in.import.list")}</label>
        <textarea id="iimp" dir="ltr" rows={6} value={text} onChange={(e) => setText(e.target.value)}
                  placeholder={"Tag No,Service,Type,Range,Equipment\nPT-1203A,P-1203A discharge,Smart transmitter,0-25 bar,P-1203A"} />
      </div>
      <div><button className="btn" type="submit" disabled={!text.trim()}>{t("el.import.go")}</button></div>
      {result && (
        <div className="sm">
          <p className="pill ok">{t("in.import.done", { n: result.imported })}</p>
          {result.unmatched.length > 0 && <p className="muted">{t("in.import.unmatched")} <span className="mono">{result.unmatched.join(t("c.sep"))}</span></p>}
          {result.problems.map((p, k) => <p key={k} className="err">{t("c.row")} {p.line} {p.tagNo || ""}: {p.text}</p>)}
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

const round = (n) => Math.round(n * 1000) / 1000;

/** Every one-click record on this page carries the day chosen at its head (components/ui/WorkDate). */
export default function InstrumentationPage() {
  return <WorkDateScope><InstrumentationPageBody /></WorkDateScope>;
}
