"use client";
import { useId, useMemo } from "react";
import TreeEditor from "../ui/TreeEditor";
import { usePrefs } from "../../lib/client/prefs.mjs";

export function AreaInput({ id, value, onChange, suggestions }) {
  const list = useId();
  const { t } = usePrefs();
  const search = value.trim().toLocaleLowerCase();
  const options = [...new Set(suggestions)].filter((area) => area && area.toLocaleLowerCase().includes(search)).slice(0, 25);
  return <>
    <input id={id} aria-label={t("ep.rp.areaShort")} list={list} value={value} maxLength={200}
      onChange={(event) => onChange(event.target.value)} />
    <datalist id={list}>
      {options.map((area) => <option key={area} value={area} />)}
    </datalist>
  </>;
}

export function reportsInPms(reports, lines) {
  const ids = new Set(lines.map((line) => line.reportId));
  return reports.filter((report) => ids.has(report.id) && report.status !== "cancelled");
}

export function ReportDays({ days, selected, onChange }) {
  const { t, locale, date } = usePrefs();
  const nodes = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", timeZone: "UTC" });
    const years = new Map();
    const months = new Map();
    const all = { id: "all", name: t("ep.dp.allDays"), children: [], days };
    for (const day of days) {
      const parts = format.formatToParts(new Date(`${day}T12:00:00Z`));
      const year = parts.find((part) => part.type === "year")?.value || day.slice(0, 4);
      const month = parts.find((part) => part.type === "month")?.value || day.slice(5, 7);
      const monthId = `${year}-${month}`;
      if (!years.has(year)) {
        const node = { id: year, name: year, children: [], days: [] };
        years.set(year, node);
        all.children.push(node);
      }
      const parent = years.get(year);
      parent.days.push(day);
      if (!months.has(monthId)) {
        const node = { id: monthId, name: month, children: [], days: [] };
        months.set(monthId, node);
        parent.children.push(node);
      }
      const group = months.get(monthId);
      group.days.push(day);
      group.children.push({ id: day, name: date(day), children: [], days: [day] });
    }
    return [all];
  }, [days, t, locale, date]);
  const checked = new Set(selected);
  if (!days.length) return null;
  return (
    <details className="report-days">
      <summary>{t("ep.dp.reportDays")}</summary>
      <div className="report-days-list">
        <TreeEditor nodes={nodes} editable={false} searchable render={(node) => {
          const count = node.days.filter((day) => checked.has(day)).length;
          return <label>
            <input type="checkbox" checked={count === node.days.length}
              ref={(el) => { if (el) el.indeterminate = count > 0 && count < node.days.length; }}
              onChange={(event) => {
                const next = new Set(selected);
                for (const day of node.days) event.target.checked ? next.add(day) : next.delete(day);
                onChange(days.filter((day) => next.has(day)));
              }} /> {node.name}
          </label>;
        }} />
      </div>
    </details>
  );
}
