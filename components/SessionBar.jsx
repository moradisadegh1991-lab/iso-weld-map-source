"use client";

/** Identity and project, in one row. The API key is not here and never was. */
export default function SessionBar({ session }) {
  const { identity, setIdentity, projects, projectId, setProjectId, role, busy, connect } = session;

  return (
    <div className="sessionbar">
      <div className="row">
        <input className="mono" placeholder="شناسه کاربر (حالت dev)" value={identity}
          onChange={(e) => setIdentity(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && connect()}
          disabled={busy} />
        <button className="ghost" onClick={() => connect()} disabled={!identity || busy}>
          {projects ? "تازه‌سازی" : "اتصال"}
        </button>
      </div>

      {projects && (projects.length ? (
        <div className="row">
          <select className="mono" value={projectId} disabled={busy}
            onChange={(e) => setProjectId(e.target.value)}>
            <option value="">— پروژه —</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
          </select>
          {role && <span className="chip mono">{role}</span>}
        </div>
      ) : (
        <p className="muted sm">این کاربر عضو هیچ پروژه‌ای نیست.</p>
      ))}
    </div>
  );
}
