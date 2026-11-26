"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { selectedStructure } from "../../lib/org/shared-selection.mjs";

const labels = {users:"کاربران",roles:"نقش‌ها و وظایف",forms:"فرم‌ها",workflows:"گردش کارها"};
const blocked = {users:"کاربر جاری به دلیل عدم اشتراک در بخش کاربر نمی‌تواند انتخاب گردد.",roles:"به دلیل عدم اشتراک در بخش نقش‌ها و وظایف ردیف جاری قابل انتخاب نیست."};

export default function StructureSharing({contractId,stakeholders,labels:roles}) {
  const [id,select] = useState("");
  const party = stakeholders.find(p=>p.id===id);
  return <section><h3>اشتراک‌گذاری ساختار</h3>
    <label>شرکت و نقش <select value={party?.id || ""} onChange={e=>select(e.target.value)}>
      <option value="">انتخاب ذی‌نفع</option>{stakeholders.map(s=><option key={s.id} value={s.id}>{s.name} · {roles[s.role]}</option>)}</select></label>
    {party && <Subscription key={party.id} party={party} contractId={contractId} role={roles[party.role]} />}
  </section>;
}

function Subscription({party,contractId,role}) {
  const {projectId,call} = usePlatform();
  const [source,choose] = useState(undefined);
  const [draft,setDraft] = useState(null);
  const [message,setMessage] = useState("");
  const [busy,setBusy] = useState(false);
  const {data,error,reload} = useProjectData(id=>`/api/org?projectId=${id}&contractId=${contractId}&share=${party.id}${source===undefined ? "" : "&source="+source}`,[source,contractId,party.id]);
  async function save(body) {
    setBusy(true); setMessage("");
    try {
      await call("/api/org",{method:"POST",body:JSON.stringify({projectId,contractId,stakeholderId:party.id,...body})});
      setDraft(null);choose(undefined);await reload();setMessage("ذخیره شد.");
    } catch(e) { setMessage(e.message); } finally { setBusy(false); }
  }
  if(error) return <p className="err">{error}</p>;
  if(!data) return <p>در حال دریافت ساختار…</p>;
  const selection = draft || data.selection;
  return <fieldset disabled={busy}><legend>{party.name} · {role}</legend>
    <label><input type="checkbox" checked={data.own} disabled={!!data.sourceId || source!==undefined}
      onChange={e=>save({kind:"share-base",enabled:e.target.checked})}/> قرارداد مبنا</label>
    {!data.own && <><label>استفاده از قرارداد مبنا <select value={data.sourceId}
      onChange={e=>{choose(e.target.value);setDraft(null);setMessage("");}}>
      <option value="">بدون اشتراک</option>{data.sources.map(s=><option key={s.id} value={s.id}>{party.name} · {role} · {s.label}</option>)}</select></label>
      {data.sourceId && <><label>+ افزودن ساختار <select value="" onChange={e=>setDraft({...selection,[e.target.value]:[]})}>
        <option value="">انتخاب بخش</option>{Object.keys(labels).filter(k=>!(k in selection)).map(k=><option key={k} value={k}>{labels[k]}</option>)}</select></label>
        {Object.keys(labels).filter(k=>k in selection).map(k=><Branch key={k} category={k} nodes={data.tree[k] || []} selection={selection}
          update={next=>setDraft(selectedStructure(data.tree,next))}/>)}</>}
      <button type="button" className="btn" onClick={()=>save({kind:"share-selection",sourceId:data.sourceId,selection})}>ذخیرهٔ اشتراک</button>
    </>}
    {data.signing && !draft && source===undefined && <SignerApproval key={data.sourceId} data={data} save={save} />}
    {message && <p role="status">{message}</p>}
  </fieldset>;
}

function Branch({category,nodes,selection,update}) {
  const [query,setQuery] = useState("");
  const chosen = new Set(selection[category]);
  const allowed = n => !n.disabled && (!n.requires || selection[n.requires[0]]?.includes(n.requires[1]));
  const keysOf = list => list.flatMap(n=>allowed(n) ? [n.key,...keysOf(n.children)] : []);
  function toggle(list,on) {
    const next = new Set(chosen);
    for(const key of keysOf(list)) on ? next.add(key) : next.delete(key);
    update({...selection,[category]:[...next]});
  }
  const matches = n => !query || n.label.includes(query) || n.children.some(matches);
  function item(n,showAll=false) {
    if(!showAll && !matches(n)) return null;
    const control = <><label style={{color:allowed(n) ? undefined : "var(--dim)"}}>
      <input type="checkbox" checked={chosen.has(n.key)} disabled={!allowed(n)} onChange={e=>toggle([n],e.target.checked)} /> {n.label}</label>
      {chosen.has(n.key) && <small className="err"> (اشتراکی)</small>}
      {!allowed(n) && n.requires && <small className="err"> {blocked[n.requires[0]]}</small>}</>;
    return <li key={n.key}>{n.children.length ? <details open={query ? true : undefined}><summary>{control}</summary><ul>
      {n.children.map(c=>item(c,showAll || !!query && n.label.includes(query)))}</ul></details> : control}</li>;
  }
  const keys = keysOf(nodes);
  return <details open><summary>{labels[category]}</summary>
    <input type="search" aria-label="جستجوی ساختار" value={query} onChange={e=>setQuery(e.target.value)} />
    <label><input type="checkbox" checked={!!keys.length && keys.every(k=>chosen.has(k))} onChange={e=>toggle(nodes,e.target.checked)} /> انتخاب همه</label>
    <button type="button" className="btn ghost sm" onClick={()=>{const next={...selection};delete next[category];update(next);}}>حذف بخش</button>
    <ul>{nodes.map(n=>item(n))}</ul>
  </details>;
}

function SignerApproval({data,save}) {
  const [appointmentId,setAppointment] = useState("");
  const [groupKey,setGroup] = useState("");
  const {appointments,groups,approvals} = data.signing;
  const appointment = appointments.find(a=>a.id===appointmentId);
  const person = data.tree.users.find(u=>u.key===appointment?.user_id);
  const group = groups.find(g=>g.type_id+"/"+g.group_id===groupKey);
  return <section><h4>تأیید حکم و اختیار امضا در قرارداد مقصد</h4>
    {appointments.length && groups.length ? <>
      <label>کاربر و حکم مقصد <select value={appointmentId} onChange={e=>setAppointment(e.target.value)}>
        <option value="">انتخاب حکم</option>{appointments.map(a=><option key={a.id} value={a.id}>{a.display_name} · {a.decree}</option>)}</select></label>
      {person && <p>حکم مبنا: {person.decree || "ثبت نشده"}</p>}
      <label>محل امضا <select value={groupKey} onChange={e=>setGroup(e.target.value)}>
        <option value="">انتخاب فرم، مرحله و گروه</option>{groups.map(g=><option key={g.type_id+"/"+g.group_id} value={g.type_id+"/"+g.group_id}>{g.form} · {g.stage} · {g.name}</option>)}</select></label>
      <button type="button" disabled={!group || !person?.decree} onClick={()=>save({kind:"share-signer",sourceId:data.sourceId,
        appointmentId,destinationDecree:appointment.decree,sourceDecree:person.decree,groupId:group.group_id,typeId:group.type_id})}>تأیید حکم و اجازهٔ امضا</button>
    </> : <p>برای تأیید، کاربر اشتراکی باید عضو پروژه و دارای حکم فعال در قرارداد مقصد باشد و فرم قراردادی مقصد گروه گردش کار داشته باشد.</p>}
    {approvals.map(a=><p key={a.id}>{a.display_name} · {a.destination_decree} · {a.form} · {a.name}
      <button type="button" onClick={()=>save({kind:"share-signer",sourceId:data.sourceId,revokeId:a.id})}>لغو اختیار امضا</button></p>)}
  </section>;
}
