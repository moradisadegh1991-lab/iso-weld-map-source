"use client";
import { useState } from "react";
import TemplateButton from "../../components/ui/TemplateButton";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import { parseEquipmentList, summarise } from "../../lib/equipment/parse.mjs";
import { EQUIPMENT_KINDS } from "../../lib/platform/precedence.mjs";
import TableKit from "../../components/ui/TableKit";
import Tabs from "../../components/ui/Tabs";
import { WorkDateScope, WorkDateField, useWorkDate } from "../../components/ui/WorkDate";
import { usePrefs } from "../../lib/client/prefs.mjs";

/**
 * Equipment tags: import a list, then work the two queues it produces.
 *
 * The queues are the screen. A tag nobody could classify has no precedence
 * chain, so nothing knows what it is waiting for; a tag that IS classified
 * has a chain, and the useful question becomes which crew can move today.
 * Both are shown by name — a count sends nobody anywhere.
 *
 * Each tag's own chain — set, grout, alignment, piping connection… — opens
 * under its row, and a step is recorded there on the day in «تاریخ انجام
 * کار». Steps another discipline answers (⚙: the foundation from civil,
 * the piping connection from the line) have no button; a step an ITP hold
 * point still holds says which inspection, instead of a button the server
 * would refuse.
 */
// One list, declared beside the chains — see EQUIPMENT_KINDS; its words are the equip.kind.* labels.
const KIND_FA = EQUIPMENT_KINDS;
// the disciplines a waiting step belongs to; their words are eq.disc.*
const DISCIPLINES = ["piping", "structural", "electrical", "instrumentation", "civil", "equipment"];

function EquipmentPageBody() {
  const { projectId, role, call } = usePlatform();
  const mayRecord = can({ role }, ACTIONS.ASSIGN_WELD);
  const mayRegister = can({ role }, ACTIONS.EDIT_EXTRACTION);
  const [open, setOpen] = useState(null);
  const { data, error, reload } = useProjectData((id) => `/api/equipment?projectId=${id}`, []);
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState(null);
  const [report, setReport] = useState(null);
  const [msg, setMsg] = useState(null);
  const { t, L } = usePrefs();
  const kindName = (k) => L(`equip.kind.${k}`, KIND_FA[k]);
  const stepName = (kind, x) => L(`chain.${kind}.${x.code}`, x.title);

  function read(raw) {
    setMsg(null); setParsed(null); setReport(null);
    const r = parseEquipmentList(raw);
    if (r.error) return setMsg(r.error);
    if (!r.tags.length) return setMsg(t("eq.noTagRows"));
    setParsed(r);
  }

  async function onFile(file) {
    if (!file) return;
    try {
      if (/\.(xlsx?|xlsm)$/i.test(file.name)) {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
        setText(csv); read(csv);
      } else {
        const t = await file.text();
        setText(t); read(t);
      }
    } catch (e) { setMsg(t("eq.fileUnread", { why: e.message })); }
  }

  async function doImport(dryRun) {
    setMsg(null);
    try {
      const { report: r } = await call("/api/equipment", {
        method: "POST",
        body: JSON.stringify({ projectId, tags: parsed.tags, dryRun }),
      });
      setReport({ ...r, dryRun });
      if (!dryRun) { setParsed(null); setText(""); await reload(); }
    } catch (e) { setMsg(e.message); }
  }

  async function classify(tagId, kind) {
    try {
      await call("/api/equipment", { method: "POST", body: JSON.stringify({ projectId, kind: "classify", tagId, tagKind: kind }) });
      await reload();
    } catch (e) { setMsg(e.message); }
  }

  if (error) return <p className="err">{error}</p>;
  const sum = parsed ? summarise(parsed) : null;

  return (
    <div className="page">
      <div className="pagehead">
        <h1>{t("eq.title")}</h1>
        <span className="sub">{data ? t("eq.sub", { n: data.tags.length }) : "…"}</span>
      </div>
      <WorkDateField />
      {msg && <p className="err">{msg}</p>}

      <Tabs name="equipment">
      {data?.unclassified?.length > 0 && (
        <div className="card" data-keep style={{ borderColor: "rgba(224,163,62,.5)" }}>
          <h2 style={{ color: "var(--warn)" }}>
            {t("eq.unclassified", { n: data.unclassified.length })}
          </h2>
          <p className="muted sm">{t("eq.unclassifiedNote")}</p>
          <TableKit name="equipment-1">
            <table className="dtable">
              <thead><tr><th>{t("c.tag")}</th><th>{t("c.description")}</th><th>{t("eq.setKind")}</th></tr></thead>
              <tbody>
                {data.unclassified.map((x) => (
                  <tr key={x.id}>
                    <td className="mono"><a className="cy" href={`/asset?tag=${encodeURIComponent(x.tag_no)}`}>{x.tag_no}</a></td>
                    <td>{x.description || "—"}</td>
                    <td style={{ display: "flex", gap: 6 }}>
                      {Object.keys(KIND_FA).map((k) => (
                        <button key={k} className="btn ghost" style={{ padding: "4px 10px" }}
                                onClick={() => classify(x.id, k)}>{kindName(k)}</button>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableKit>
        </div>
      )}

      {data?.blocked?.length > 0 && (
        <div className="card">
          <h2>{t("eq.today")}</h2>
          <p className="muted sm">{t("eq.todayNote")}</p>
          <TableKit name="equipment-2">
            <table className="dtable">
              <thead><tr><th>{t("c.tag")}</th><th>{t("eq.progress")}</th><th>{t("eq.waitingFor")}</th><th>{t("eq.discipline")}</th></tr></thead>
              <tbody>
                {data.blocked.map((b) => (
                  <tr key={b.tagId}>
                    <td className="mono">{b.tagNo}</td>
                    <td>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="bar"><i style={{ width: `${b.pct}%` }} /></span>
                        <span className="mono sm">{b.pct}%</span>
                      </span>
                    </td>
                    <td>{b.rootCauses.map((c) => stepName(b.kind, c)).join(t("c.sep")) || "—"}</td>
                    <td className="sm">
                      {[...new Set(b.rootCauses.map((c) => (DISCIPLINES.includes(c.discipline) ? t(`eq.disc.${c.discipline}`) : c.discipline)))]
                        .join(t("c.sep"))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableKit>
        </div>
      )}

      {data?.tags?.length > 0 && (
        <div className="card">
          <h2>{t("eq.tags")}</h2>
          <TableKit name="equipment-3">
            <table className="dtable">
              <thead><tr><th>{t("c.tag")}</th><th>{t("c.description")}</th><th>{t("eq.kind")}</th><th>{t("c.subsystem")}</th><th /></tr></thead>
              <tbody>
                {data.tags.map((x) => [
                  <tr key={x.id}>
                    <td className="mono"><a className="cy" href={`/asset?tag=${encodeURIComponent(x.tag_no)}`}>{x.tag_no}</a></td>
                    <td>{x.description || "—"}</td>
                    <td className={x.kind ? "" : "muted"}>{x.kind ? kindName(x.kind) : t("eq.unknownKind")}</td>
                    <td className="mono">{x.subsystem || "—"}</td>
                    <td>{x.kind && <button className="btn ghost" style={{ padding: "4px 10px" }} onClick={() => setOpen(open === x.id ? null : x.id)}>
                      {open === x.id ? t("common.close") : t("eq.steps")}</button>}</td>
                  </tr>,
                  open === x.id && (
                    <tr key={x.id + "-x"}><td colSpan={5} style={{ background: "rgba(255,255,255,.02)" }}>
                      <TagSteps tagId={x.id} kind={x.kind} mayRecord={mayRecord} onChange={reload} setMsg={setMsg} />
                    </td></tr>
                  ),
                ])}
              </tbody>
            </table>
          </TableKit>
        </div>
      )}

      {mayRegister && <ManualTag data={data} onDone={reload} />}

      <div className="card">
        <h2>{t("eq.import")}</h2>
        <p className="muted sm">
          <b>{t("eq.noModel")}</b> — {t("eq.noModelNote")}
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <label className="btn ghost" style={{ cursor: "pointer" }}>
            {t("eq.file")}
            <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm" hidden
                   onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <TemplateButton kind="equipment" className="btn ghost" />
          <button className="btn ghost" onClick={() => read(text)} disabled={!text.trim()}>
            {t("eq.readText")}
          </button>
        </div>
        <div className="field">
          <textarea className="mono" dir="ltr" value={text} spellCheck={false}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={"Tag No,Description,Type,Subsystem\nP-2101A,Feed Pump,Centrifugal,21-01"} />
        </div>

        {sum && (
          <>
            <p className="mono sm">
              {t("eq.sub", { n: sum.total })} · {Object.keys(KIND_FA).map((k) => `${kindName(k)} ${sum[k]}`).join(" · ")}
              {sum.unclassified > 0 && ` · ${t("eq.unknownKind")} ${sum.unclassified}`} · {t("eq.auto", { pct: sum.pctClassified })}
              {parsed.skipped.length > 0 && ` · ${t("eq.skipped", { n: parsed.skipped.length })}`}
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn ghost" onClick={() => doImport(true)}>{t("eq.preview")}</button>
              <button className="btn" onClick={() => doImport(false)}>{t("eq.commit")}</button>
            </div>
          </>
        )}

        {report && (
          <p className={"pill " + (report.dryRun ? "" : "ok")}>
            {report.dryRun ? t("eq.r.preview") : t("eq.r.done")}{" "}
            {t("eq.r.counts", { created: report.created, updated: report.updated, subsystems: report.subsystems })}
            {report.unclassified.length > 0 && ` · ${t("eq.r.unknown", { n: report.unclassified.length })}`}
            {report.unfiled.length > 0 && ` · ${t("eq.r.unfiled", { n: report.unfiled.length })}`}
          </p>
        )}
      </div>
      </Tabs>
    </div>
  );
}

/**
 * One tag typed by hand. The server reads its description with the same
 * classifier as a list; a kind chosen here is the engineer's decision and
 * wins. A subsystem not yet in the project is created, as a list would.
 */
function ManualTag({ data, onDone }) {
  const { projectId, call } = usePlatform();
  const blank = { tagNo: "", description: "", type: "", tagKind: "", subsystem: "" };
  const [f, setF] = useState(blank);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);
  const on = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { t, L } = usePrefs();
  async function save(e) {
    e.preventDefault(); setErr(null); setRes(null);
    try {
      const r = await call("/api/equipment", { method: "POST", body: JSON.stringify({ projectId, kind: "manual", ...f }) });
      setRes(r); setF({ ...blank, subsystem: f.subsystem }); onDone?.();
    } catch (x) { setErr(x.message); }
  }
  return (
    <div className="card">
      <h2>{t("eq.m.title")}</h2>
      <p className="muted sm">{t("eq.m.note")}</p>
      <form onSubmit={save}>
        <div className="grid2">
          <div className="field"><label htmlFor="eq-no">{t("eq.m.tagNo")}</label>
            <input id="eq-no" dir="ltr" required value={f.tagNo} onChange={on("tagNo")} placeholder="P-7001" /></div>
          <div className="field"><label htmlFor="eq-desc">{t("c.description")}</label>
            <input id="eq-desc" dir="auto" value={f.description} onChange={on("description")} placeholder="DM Water Transfer Pump" /></div>
          <div className="field"><label htmlFor="eq-type">{t("eq.m.type")}</label>
            <input id="eq-type" dir="auto" value={f.type} onChange={on("type")} placeholder="Centrifugal" /></div>
          <div className="field"><label htmlFor="eq-kind">{t("eq.m.chain")}</label>
            <select id="eq-kind" value={f.tagKind} onChange={on("tagKind")}>
              <option value="">{t("eq.m.fromDesc")}</option>
              {Object.entries(KIND_FA).map(([k, v]) => <option key={k} value={k}>{L(`equip.kind.${k}`, v)}</option>)}
            </select></div>
          <div className="field"><label htmlFor="eq-sub">{t("c.subsystem")}</label>
            <input id="eq-sub" dir="ltr" list="eq-subs" value={f.subsystem} onChange={on("subsystem")} placeholder="70-01" />
            <datalist id="eq-subs">{(data?.subsystems || []).map((s) => <option key={s.code} value={s.code}>{s.name || ""}</option>)}</datalist></div>
        </div>
        {err && <p className="err">{err}</p>}
        {res && (
          <p className={`pill ${res.tag.kind ? "ok" : "warn"}`}>
            {t("eq.m.saved", { tag: res.tag.tag_no })} · {res.tag.kind
              ? `${L(`equip.kind.${res.tag.kind}`, KIND_FA[res.tag.kind])} (${res.kindSource === "chosen" ? t("eq.m.chosen") : t("eq.m.fromText")})`
              : t("eq.m.noKind", { why: res.reason })}
            {res.tag.subsystem ? ` · ${res.tag.subsystem}` : ` · ${t("eq.m.noSubsystem")}`}
          </p>
        )}
        <button className="btn" type="submit">{t("eq.m.save")}</button>
      </form>
    </div>
  );
}

/** One tag's chain, each step recorded on the page's work date. */
function TagSteps({ tagId, kind, mayRecord, onChange, setMsg }) {
  const { projectId, call } = usePlatform();
  const workOn = useWorkDate();
  const { t, L, date } = usePrefs();
  const name = (x) => L(`chain.${kind}.${x.code}`, x.title);
  const { data, error, reload } = useProjectData((id) => `/api/equipment?projectId=${id}&tagId=${tagId}`, [tagId]);
  const [refs, setRefs] = useState({});
  if (error) return <p className="err">{error}</p>;
  if (!data) return <span className="muted sm">{t("common.loading")}</span>;
  const { status, holds } = data;
  if (!status.steps) return <p className="muted sm">{t("eq.noChain")}</p>;

  async function record(code) {
    setMsg(null);
    try {
      await call("/api/equipment", { method: "POST", body: JSON.stringify({ projectId, kind: "activity", tagId, code, doneAt: workOn, refNo: refs[code] || null }) });
      reload(); onChange?.();
    } catch (e) { setMsg(e.message); }
  }
  return (
    <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))" }}>
      {status.steps.map((s) => {
        const hold = holds[s.code];
        return (
          <div key={s.code} className="card" style={{ padding: 10, gap: 6,
            borderColor: s.status === "done" ? "rgba(63,178,127,.5)" : hold ? "rgba(224,163,62,.6)" : s.blocked ? undefined : "rgba(67,160,180,.6)" }}>
            <span className="sm"><b>{s.derived ? "⚙ " : ""}{name(s)}</b></span>
            <span className="sm muted">
              {s.status === "done" ? (s.doneAt ? t("st.doneOn", { on: date(s.doneAt) }) : t("st.done"))
              : s.claimedOn ? t("st.claimed", { on: date(s.claimedOn) })
              : s.rejected ? t("st.rejected", { why: s.rejected })
                : s.status === "in_progress" ? t("st.inProgress")
                : s.claimable ? t("st.claimable")
                : s.blocked ? t("st.waiting", { list: s.waitingOn.map(name).join(t("c.sep")) })
                : t("st.ready")}
              {s.refNo ? ` · ${s.refNo}` : ""}
            </span>
            {s.note && <span className={"sm " + (s.note.level === "bad" ? "err" : "muted")}>{s.note.text}</span>}
            {s.outOfOrder && <span className="pill bad">{t("st.outOfOrder")}</span>}
            {hold && s.status !== "done" && (
              <span className="pill warn">{t("st.hold", { itp: hold.itpNo, seq: hold.seq })}{hold.irNo ? ` · ${hold.irNo}` : ` · ${t("st.noIr")}`}</span>
            )}
            {mayRecord && !s.derived && s.status !== "done" && (!s.blocked || s.claimable) && !hold && (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input aria-label={t("st.refOf", { step: name(s) })} placeholder={t("st.ref")} dir="ltr" style={{ width: 130 }}
                       value={refs[s.code] || ""} onChange={(e) => setRefs({ ...refs, [s.code]: e.target.value })} />
                <button className="btn" style={{ padding: "4px 10px" }} onClick={() => record(s.code)}>{t("st.record")}</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function EquipmentPage() {
  return <WorkDateScope><EquipmentPageBody /></WorkDateScope>;
}
