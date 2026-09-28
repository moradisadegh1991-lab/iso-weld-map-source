"use client";
/** Shared bits of the contracts, statements and finance pages. */

/** An amount as written on a statement: grouped, two decimals at most, with its currency. */
export const money = (v, cur = "") => (v === null || v === undefined ? "—" : `${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}${cur ? ` ${cur}` : ""}`);

export function Field({ id, label, value, on, type = "text", required, readOnly, ltr }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} step={type === "number" ? "any" : undefined} dir={ltr || type !== "text" ? "ltr" : "auto"}
             required={required} readOnly={readOnly} value={value} onChange={on} />
    </div>
  );
}
