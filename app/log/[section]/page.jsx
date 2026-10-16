"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { usePlatform } from "../../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../../lib/authz.mjs";
import { SECTIONS, LOG_SECTIONS } from "../../../lib/platform/navigation.mjs";
import { LogList } from "../../../components/ui/EntityLog";

/**
 * A section's log: every step its records took through their workflow, who
 * took it and when, and every comment — read from the log and from the
 * signatures the section keeps in its own records (lib/db/repos/log.mjs).
 */
export default function SectionLogPage() {
  const { section } = useParams();
  const { projectId, role, call } = usePlatform();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [who, setWho] = useState("");
  const [what, setWhat] = useState("");
  const [q, setQ] = useState("");
  const [text, setText] = useState("");
  const keys = LOG_SECTIONS[section] || [];
  const title = SECTIONS.flatMap((g) => g.items).find((s) => s.key === section)?.title || section;

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
      await call("/api/log", { method: "POST", body: JSON.stringify({ projectId, section: keys[0], entityType: "section", label: `بخش ${title}`, comment: text }) });
      setText(""); load();
    } catch (er) { setErr(er.message); }
  }

  if (!keys.length) return <div className="page"><p className="err">این بخش لاگ ندارد.</p></div>;
  const actions = [...new Set((data?.log || []).map((e) => e.actionFa))];
  const term = q.trim().toLowerCase();
  const shown = (data?.log || []).filter((e) => (!who || e.user === who) && (!what || e.actionFa === what)
    && (!term || `${e.label} ${e.comment || ""}`.toLowerCase().includes(term)));

  return (
    <div className="page">
      <div className="pagehead">
        <h1>لاگ و گردش — {title}</h1>
        <span className="sub">{data ? `${data.log.length} رویداد · ${people.length} نفر` : ""}</span>
      </div>
      {err && <p className="err">{err}</p>}
      {!data ? <p className="muted">در حال بارگذاری…</p> : (
        <>
          <div className="card">
            <h2>چه کسانی امضا یا کامنت گذاشته‌اند</h2>
            {people.length === 0 ? <p className="empty-note">هنوز کسی در این بخش چیزی ثبت نکرده است.</p> : (
              <table className="dtable"><thead><tr><th>نفر</th><th>ثبت و امضا</th><th>کامنت</th><th /></tr></thead>
                <tbody>{people.map((p) => (
                  <tr key={p.user}><td>{p.user}</td><td className="mono">{p.signed}</td><td className="mono">{p.comments}</td>
                    <td><button className="btn ghost" onClick={() => setWho(who === p.user ? "" : p.user)}>{who === p.user ? "همه" : "فقط این نفر"}</button></td></tr>
                ))}</tbody></table>
            )}
          </div>
          <div className="card">
            <h2>گردش کار</h2>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <input aria-label="جستجو در لاگ" placeholder="جستجو: شماره، شرح، کامنت…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
              <select aria-label="نوع اقدام" value={what} onChange={(e) => setWhat(e.target.value)}>
                <option value="">همهٔ اقدام‌ها</option>{actions.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              {who && <button className="btn ghost" onClick={() => setWho("")}>{who} ×</button>}
            </div>
            <LogList log={shown} showSection={data.multi} />
            {can({ role }, ACTIONS.COMMENT) && (
              <form onSubmit={comment} style={{ display: "flex", gap: 6, marginTop: 10 }}>
                <input aria-label="کامنت روی بخش" dir="auto" value={text} onChange={(e) => setText(e.target.value)} placeholder="کامنت روی این بخش…" style={{ flex: 1 }} />
                <button className="btn ghost" disabled={!text.trim()}>ثبت کامنت</button>
              </form>
            )}
          </div>
        </>
      )}
    </div>
  );
}
