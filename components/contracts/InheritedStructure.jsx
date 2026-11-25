"use client";
import { usePlatform,useProjectData } from "../../lib/client/platform.mjs";

export default function InheritedStructure({category,title}) {
  const {contractId} = usePlatform();
  const {data,error} = useProjectData(pid=>contractId ? `/api/org?projectId=${pid}&contractId=${contractId}&inherited=${category}` : null,[contractId,category]);
  if (error) return <p className="err" role="alert">{error}</p>;
  if (!data?.rows?.length) return null;
  function item(n) {
    const label = <>{n.label} <small className="err">(اشتراکی)</small></>;
    return <li key={n.key}>{n.children.length ? <details open><summary>{label}</summary><ul>{n.children.map(item)}</ul></details> : label}</li>;
  }
  return <section className="card"><h3>{title}</h3><ul>{data.rows.map(item)}</ul></section>;
}
