"use client";
import { usePrefs } from "../../lib/client/prefs.mjs";
import { downloadTemplate } from "../../lib/import-templates.mjs";

/** «Excel template» beside a file import: the columns its importer reads, with examples and a guide sheet. */
export default function TemplateButton({ kind, className = "btn ghost sm" }) {
  const { t } = usePrefs();
  return <button type="button" className={className} data-template={kind} onClick={() => downloadTemplate(kind)}>{t("imp.template")}</button>;
}
