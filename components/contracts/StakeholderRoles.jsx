"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import TableKit from "../ui/TableKit";

const scopes = [["both", "پروژه و قرارداد"], ["project", "پروژه"], ["contract", "قرارداد"]];
const statuses = [["true", "فعال"], ["false", "غیرفعال"]];
const fields = [
  { col: "گزینهٔ انتخاب", name: "scope", type: "select", options: scopes },
  { col: "نام نقش", name: "name", type: "text" },
  { col: "شمارهٔ ردیف", name: "seq", type: "number" },
  { col: "وضعیت", name: "active", type: "select", options: statuses },
  { col: "توضیحات", name: "note", type: "text" },
];
const labels = Object.fromEntries(scopes);

export default function StakeholderRoles(props) {
  const { projectId, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/org?projectId=${id}`);
  const [failure, setFailure] = useState("");
  async function post(body) {
    setFailure("");
    try {
      await call("/api/org", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      await reload();
      return true;
    } catch (e) {
      setFailure(e.message);
      return false;
    }
  }
  const save = (code, v) => post({ kind: "stakeholder-role", code, ...v, active: v.active !== "false" });
  return <section className="card" {...props}>
    <h2>تعریف نقش ذی‌نفعان</h2>
    {(error || failure) && <p className="err" role="alert">{error || failure}</p>}
    {data && <TableKit name="stakeholder-role-catalog"
      onDelete={data.may.project ? (code) => post({ kind: "stakeholder-role-remove", code }) : undefined}
      rowEdit={data.may.project ? {
        fields,
        value: (id) => {
          const row = data.roleCatalog.find((r) => r.code === id);
          return { scope: row.scope, name: row.name, seq: row.seq, active: String(row.active), note: row.note || "" };
        },
        onSave: save,
        onAdd: (v) => save(null, v),
      } : undefined}>
      <table className="dtable">
        <thead><tr>{fields.map((field) => <th key={field.name}>{field.col}</th>)}<th /></tr></thead>
        <tbody>{data.roleCatalog.map((r) => <tr key={r.code} data-key={r.code}>
          <td>{labels[r.scope]}</td><td>{r.name}</td><td>{r.seq}</td>
          <td>{r.active ? "فعال" : "غیرفعال"}</td><td>{r.note || "—"}</td><td />
        </tr>)}</tbody>
      </table>
    </TableKit>}
  </section>;
}
