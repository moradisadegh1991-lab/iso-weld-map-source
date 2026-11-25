"use client";
import { useState } from "react";
import FormDialog from "../ui/FormDialog";

export default function PlanIdentifiers({ activity, planId, save }) {
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true);
    try {
      if (await save({ kind: "plan-identifiers", id: planId, ...draft })) setDraft(null);
      else setError("تغییر ذخیره نشد. پیام خطای فرم را بررسی کنید.");
    } finally { setBusy(false); }
  }
  return <>
    <button type="button" className="btn ghost sm" onClick={() => {
      setDraft({ code: activity.code, activityNo: activity.activity_no ?? activity.activityNo ?? "" }); setError("");
    }}>ویرایش Code و Activity ID</button>
    {draft && <FormDialog mode="edit" title="ویرایش شناسه‌های فعالیت PMS" saveLabel="اعمال تغییر"
      subtitle="این شناسه‌ها در تمام نسخه‌های این فعالیت استفاده می‌شوند." saving={busy} error={error}
      onSave={submit} onClose={() => { if (!busy) setDraft(null); }}>
      <label>Code <input dir="ltr" value={draft.code} required onChange={(e) => setDraft({ ...draft, code: e.target.value })} /></label>
      <label>Activity ID <input dir="ltr" value={draft.activityNo} onChange={(e) => setDraft({ ...draft, activityNo: e.target.value })} /></label>
    </FormDialog>}
  </>;
}
