"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { usePlatform } from "../../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../../lib/authz.mjs";
import { SECTIONS, LOG_SECTIONS } from "../../../lib/platform/navigation.mjs";
import { LogList } from "../../../components/ui/EntityLog";
import { usePrefs } from "../../../lib/client/prefs.mjs";
import { navSection } from "../../../lib/i18n/nav.mjs";

import TableKit from "../../../components/ui/TableKit";
/**
 * A section's log: every step its records took through their workflow, who
 * took it and when, and every comment — read from the log and from the
 * signatures the section keeps in its own records (lib/db/repos/log.mjs).
 */
export default function SectionLogPage() {
  const { section } = useParams();
  const { projectId, role, call } = usePlatform();
  const { t, L, lang } = usePrefs();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [who, setWho] = useState("");
  const [what, setWhat] = useState("");
  const [q, setQ] = useState("");
  const [text, setText] = useState("");
  const keys = LOG_SECTIONS[section] || [];
  // The Persian title is what a comment's label is stored with; the page shows the reader's language.
  const title = SECTIONS.flatMap((g) => g.items).find((s) => s.key === section)?.title || section;
  const shownTitle = navSection(lang, section, title)[0];

  async function load() {
    setErr(null);
    try {
      const parts = await Promise.all(keys.map((k) => call(`/api/log?projectId=${projectId}&section=${k}`)));
      const log = parts.flatMap((p) => p.log.map((e) => ({ ...e, section: p.section, sectionFa: p.title })))
        .sort((a, b) => String(b.at).localeCompare(String(a.at)));
      setData({ log, multi: keys.length > 1 });
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { if (projectId && keys.length) load(); }, [projectId, section]);   // eslint-disable-line react-hooks/exhaustive-deps

  const people = useMemo(() => {
    const m = new Map();
    for (const e of data?.log || []) {
      const p = m.get(e.user) || { user: e.user, signed: 0, comments: 0 };
      if (e.action === "commented") p.comments++; else p.signed++;
      m.set(e.user, p);
    }
    return [...m.values()].sort((a, b) => b.signed + b.comments - a.signed - a.comments);
  }, [data]);

  async function comment(e) {
    e.preventDefault();
    try {
      // i18n: stored — the label is kept with the comment, so it is the Persian title whatever the reader's language
      await call("/api/log", { method: "POST", body: JSON.stringify({ projectId, section: keys[0], entityType: "section", label: `بخش ${title}`, comment: text }) });
      setText(""); load();
    } catch (er) { setErr(er.message); }
  }

  if (!keys.length) return <div className="page"><p className="err">{t("logp.none")}</p></div>;
  const actions = [...new Map((data?.log || []).map((e) => [e.action, e.actionFa])).entries()];
  const term = q.trim().toLowerCase();
  const shown = (data?.log || []).filter((e) => (!who || e.user === who) && (!what || e.action === what)
    && (!term || `${e.label} ${e.comment || ""}`.toLowerCase().includes(term)));

  return (
    <div className="page">
      <div className="pagehead">
        <h1>{t("logp.title", { title: shownTitle })}</h1>
        <span className="sub">{data ? t("logp.sub", { events: data.log.length, people: people.length }) : ""}</span>
      </div>
      {err && <p className="err">{err}</p>}
      {!data ? <p className="muted">{t("common.loading")}</p> : (
        <>
          <div className="card">
            <h2>{t("logp.who")}</h2>
            {people.length === 0 ? <p className="empty-note">{t("logp.nobody")}</p> : (
              <TableKit name="log-section-1"><table className="dtable"><thead><tr><th>{t("logp.h.person")}</th><th>{t("logp.h.signed")}</th><th>{t("logp.h.comments")}</th><th /></tr></thead>
                <tbody>{people.map((p) => (
                  <tr key={p.user}><td>{p.user}</td><td className="mono">{p.signed}</td><td className="mono">{p.comments}</td>
                    <td><button className="btn ghost" onClick={() => setWho(who === p.user ? "" : p.user)}>{who === p.user ? t("logp.everyone") : t("logp.onlyThis")}</button></td></tr>
                ))}</tbody></table></TableKit>
            )}
          </div>
          <div className="card">
            <h2>{t("logp.flow")}</h2>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <input aria-label={t("logp.search")} placeholder={t("logp.searchPh")} value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
              <select aria-label={t("logp.actionType")} value={what} onChange={(e) => setWhat(e.target.value)}>
                <option value="">{t("logp.allActions")}</option>{actions.map(([a, fa]) => <option key={a} value={a}>{L(`log.action.${a}`, fa)}</option>)}
              </select>
              {who && <button className="btn ghost" onClick={() => setWho("")}>{who} ×</button>}
            </div>
            <LogList log={shown} showSection={data.multi} />
            {can({ role }, ACTIONS.COMMENT) && (
              <form onSubmit={comment} style={{ display: "flex", gap: 6, marginTop: 10 }}>
                <input aria-label={t("logp.commentSection")} dir="auto" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("logp.commentPh")} style={{ flex: 1 }} />
                <button className="btn ghost" disabled={!text.trim()}>{t("log.submit")}</button>
              </form>
            )}
          </div>
        </>
      )}
    </div>
  );
}
