"use client";
import { useState } from "react";
import { usePlatform,useProjectData } from "../../lib/client/platform.mjs";

export default function InheritedStructure({category,title}) {
  const {contractId,projectId,call} = usePlatform();
  const {data,error,reload} = useProjectData(pid=>contractId ? `/api/org?projectId=${pid}&contractId=${contractId}&inherited=${category}` : null,[contractId,category]);
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  async function change(stakeholderId,fields) {
    setBusy(true);setMessage("");
    try {
      await call("/api/org",{method:"POST",body:JSON.stringify({kind:"share-extension",category,stakeholderId,projectId,contractId,...fields})});
      await reload();
    } catch(e) { setMessage(e.message); } finally { setBusy(false); }
  }
  if (error) return <p className="err" role="alert">{error}</p>;
  if (!data?.rows?.length) return null;
  function item(n,stakeholderId) {
    const label = <>{n.label} {n.localId
      ? <button type="button" disabled={busy} onClick={()=>change(stakeholderId,{removeId:n.localId})}>حذف پیوند محلی</button>
      : <small className="err">(اشتراکی)</small>}</>;
    return <li key={n.key}>{n.children.length || n.choices?.length ? <details open><summary>{label}</summary>
      {!!n.choices?.length && <label>افزودن ردیف محلی <select value="" disabled={busy}
        onChange={e=>change(stakeholderId,{parentKey:n.key,localKey:e.target.value})}><option value="">انتخاب</option>
        {n.choices.map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</select></label>}
      <ul>{n.children.map(c=>item(c,stakeholderId))}</ul></details> : label}</li>;
  }
  return <section className="card"><h3>{title}</h3>{message && <p className="err">{message}</p>}
    {data.rows.map(p=><div key={p.key}><b>{p.label}</b><ul>{p.children.map(n=>item(n,p.key))}</ul></div>)}</section>;
}
