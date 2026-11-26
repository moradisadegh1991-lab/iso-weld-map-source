"use client";
import { useState } from "react";
import { usePrefs } from "../../lib/client/prefs.mjs";
import FormDialog from "../ui/FormDialog";

export default function PlanIdentifiers({ activity, planId, save, onClose }) {
  const { t } = usePrefs();
  const [draft, setDraft] = useState(() => ({ code: activity.code, activityNo: activity.activity_no ?? activity.activityNo ?? "" }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true);
    try {
      if (await save({ kind: "plan-identifiers", id: planId, ...draft })) onClose();
      else setError(t("ep.identifiers.error"));
    } finally { setBusy(false); }
  }
  return <FormDialog mode="edit" title={t("ep.identifiers.title")} saveLabel={t("ep.identifiers.save")}
    subtitle={t("ep.identifiers.scope")} saving={busy} error={error}
    onSave={submit} onClose={() => { if (!busy) onClose(); }}>
    <label>Activity Code <input dir="ltr" value={draft.code} required onChange={(e) => setDraft({ ...draft, code: e.target.value })} /></label>
    <label>Activity ID (Activity NO) <input dir="ltr" value={draft.activityNo} onChange={(e) => setDraft({ ...draft, activityNo: e.target.value })} /></label>
  </FormDialog>;
}
