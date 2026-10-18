"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";
import { usePrefs } from "../../lib/client/prefs.mjs";

/**
 * The vendor register: every company the project buys from, with who to
 * call and where to write. Bids, POs and the expediting list pick a vendor
 * from here, so a vendor's details are typed once. The code is the key: the
 * same code again updates the vendor, it does not make a second one.
 */
const BLANK = { code: "", name: "", scope: "", contactName: "", email: "", phone: "", country: "", city: "", address: "", website: "", notes: "" };

export default function Vendors({ bar }) {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/procurement?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  const [f, setF] = useState(BLANK);
  const [editing, setEditing] = useState(false);
  const [q, setQ] = useState("");
  const may = can({ role }, ACTIONS.MANAGE_PROCUREMENT);
  const { t } = usePrefs();

  async function save(e) {
    e.preventDefault(); setMsg(null);
    try {
      await call("/api/procurement", { method: "POST", body: JSON.stringify({ projectId, kind: "vendor", ...f }) });
      setF(BLANK); setEditing(false); reload();
    } catch (err) { setMsg(err.message); }
  }
  const asForm = (v) => ({ code: v.code, name: v.name, scope: v.scope || "", contactName: v.contact_name || "", email: v.email || "", phone: v.phone || "",
      country: v.country || "", city: v.city || "", address: v.address || "", website: v.website || "", notes: v.notes || "" });
  function edit(id) { setF(asForm(data.vendors.find((x) => x.id === id))); setEditing(true); }
  // a click on a row edits the columns it shows in place; the Edit button still opens the whole form
  const rowEdit = may ? {
    fields: [{ col: t("pu.v.name"), name: "name" }, { col: t("pu.v.scope"), name: "scope" }, { col: t("pu.v.contact"), name: "contactName" },
      { col: t("pu.v.email"), name: "email" }, { col: t("pu.v.phone"), name: "phone" }],
    value: (id) => asForm(data.vendors.find((x) => x.id === id)),
    onSave: async (id, v) => {
      setMsg(null);
      try { await call("/api/procurement", { method: "POST", body: JSON.stringify({ projectId, kind: "vendor", ...v }) }); reload(); return true; }
      catch (err) { setMsg(err.message); return false; }
    },
  } : undefined;

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">{t("common.loading")}</p>;
  const term = q.trim().toLowerCase();
  const list = data.vendors.filter((v) => !term || [v.code, v.name, v.scope, v.contact_name, v.email, v.city, v.country]
    .some((x) => String(x || "").toLowerCase().includes(term)));
  const on = (k) => (e) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="page">
      <div className="pagehead">
        <h1>{t("pu.title")}</h1>
        <span className="sub">{t("pu.v.sub", { n: data.vendors.length })}</span>
      </div>
      {bar}
      {msg && <p className="err">{msg}</p>}

      <div className="card">
        <h2>{t("pu.tab.vendors")}</h2>
        <p className="muted sm">{t("pu.v.note")}</p>
        {data.vendors.length > 0 && (
          <div className="field" style={{ maxWidth: 360 }}>
            <label htmlFor="vn-q">{t("pu.v.search")}</label>
            <input id="vn-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("pu.v.searchHint")} />
          </div>
        )}
        {data.vendors.length === 0 ? <p className="empty-note">{t("pu.v.empty")}</p> : (
          <TableKit name="vendors" onEdit={may ? edit : undefined} rowEdit={rowEdit}>
            <table className="dtable">
              <thead><tr><th>{t("pu.h.code")}</th><th>{t("pu.v.name")}</th><th>{t("pu.v.scope")}</th><th>{t("pu.v.contact")}</th><th>{t("pu.v.email")}</th><th>{t("pu.v.phone")}</th><th>{t("c.location")}</th><th>{t("pu.v.poBid")}</th></tr></thead>
              <tbody>{list.map((v) => (
                <tr key={v.id} data-key={v.id}>
                  <td className="mono">{v.code}</td>
                  <td>{v.name}{v.website && <div className="sm"><span className="muted" dir="ltr">{v.website}</span></div>}</td>
                  <td className="sm">{v.scope || "—"}</td>
                  <td className="sm">{v.contact_name || "—"}</td>
                  <td className="sm mono" dir="ltr">{v.email || "—"}</td>
                  <td className="sm mono" dir="ltr">{v.phone || "—"}</td>
                  <td className="sm">{[v.city, v.country].filter(Boolean).join(t("c.sep")) || "—"}{v.address && <div className="muted">{v.address}</div>}</td>
                  <td className="mono">{v.po_count} / {v.bid_count}</td>
                </tr>
              ))}</tbody>
            </table>
          </TableKit>
        )}
        {may && (
          <Fold key={editing ? `edit-${f.code}` : "new"} title={editing ? t("pu.v.edit", { code: f.code }) : t("pu.v.new")} defaultOpen={editing}>
            <form onSubmit={save}>
              <div className="grid2">
                <div className="field"><label htmlFor="vn-code">{t("pu.v.code")}</label>
                  <input id="vn-code" dir="ltr" required readOnly={editing} value={f.code} onChange={on("code")} placeholder="V-PMP-A" /></div>
                <div className="field"><label htmlFor="vn-name">{t("pu.v.company")}</label>
                  <input id="vn-name" dir="auto" required value={f.name} onChange={on("name")} /></div>
                <div className="field"><label htmlFor="vn-scope">{t("pu.v.scope")}</label>
                  <input id="vn-scope" dir="auto" value={f.scope} onChange={on("scope")} placeholder={t("pu.v.scopeHint")} /></div>
                <div className="field"><label htmlFor="vn-contact">{t("pu.v.contact")}</label>
                  <input id="vn-contact" dir="auto" value={f.contactName} onChange={on("contactName")} /></div>
                <div className="field"><label htmlFor="vn-email">{t("pu.v.email")}</label>
                  <input id="vn-email" type="email" dir="ltr" value={f.email} onChange={on("email")} /></div>
                <div className="field"><label htmlFor="vn-phone">{t("pu.v.phone")}</label>
                  <input id="vn-phone" type="tel" dir="ltr" value={f.phone} onChange={on("phone")} placeholder="+98 21 1234 5678" /></div>
                <div className="field"><label htmlFor="vn-country">{t("pu.v.country")}</label>
                  <input id="vn-country" dir="auto" value={f.country} onChange={on("country")} /></div>
                <div className="field"><label htmlFor="vn-city">{t("pu.v.city")}</label>
                  <input id="vn-city" dir="auto" value={f.city} onChange={on("city")} /></div>
                <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="vn-address">{t("pu.v.address")}</label>
                  <input id="vn-address" dir="auto" value={f.address} onChange={on("address")} /></div>
                <div className="field"><label htmlFor="vn-web">{t("pu.v.website")}</label>
                  <input id="vn-web" dir="ltr" value={f.website} onChange={on("website")} /></div>
                <div className="field"><label htmlFor="vn-notes">{t("c.note")}</label>
                  <input id="vn-notes" dir="auto" value={f.notes} onChange={on("notes")} /></div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" type="submit">{editing ? t("pu.v.saveChanges") : t("pu.v.save")}</button>
                {editing && <button className="btn ghost" type="button" onClick={() => { setF(BLANK); setEditing(false); }}>{t("common.cancel")}</button>}
              </div>
            </form>
          </Fold>
        )}
      </div>
    </div>
  );
}
