"use client";
import { useState } from "react";
import { usePlatform } from "../../lib/client/platform.mjs";
import { usePrefs } from "../../lib/client/prefs.mjs";
import { PREFS } from "../../lib/prefs.mjs";
import { LANGS } from "../../lib/i18n/index.mjs";

/**
 * The signed-in person's own settings: how the platform looks (colour mode,
 * accent, density, text size, the default table view), its language, and
 * their password. Appearance and language are applied at once and kept on
 * the account (078), so they follow the person to every device.
 *
 * The password: the current one is asked for; the new one ends every other
 * session (another phone, another computer), and this one stays signed in.
 */
export default function AccountPage() {
  const { user } = usePlatform();
  const { t } = usePrefs();
  return (
    <div className="page settings-page">
      <div className="pagehead"><h1>{t("settings.title")}</h1>
        <span className="sub">{user?.displayName || ""} · <bdi dir="ltr">{user?.email}</bdi> — {t("settings.sub")}</span></div>
      <div className="settings-grid">
        <Appearance />
        <div className="settings-col">
          <Language />
          <Password />
        </div>
      </div>
    </div>
  );
}

/** A row of choices, one pressed: a radio group drawn as segmented buttons. */
function Choice({ name, label, value, options, onPick, render }) {
  return (
    <div className="field">
      <span className="lbl" id={`set-${name}`}>{label}</span>
      <div className="seg" role="radiogroup" aria-labelledby={`set-${name}`}>
        {options.map((o) => (
          <button key={o} type="button" role="radio" aria-checked={value === o} className={value === o ? "on" : ""}
                  data-value={o} onClick={() => onPick(o)}>{render ? render(o) : o}</button>
        ))}
      </div>
    </div>
  );
}

function useSave() {
  const { setPref } = usePrefs();
  const [note, setNote] = useState(null);
  const pick = (key) => async (v) => {
    setNote(null);
    const ok = await setPref(key, v);
    setNote(ok ? { ok: true } : null);
  };
  return [pick, note];
}

function Appearance() {
  const { prefs, t, saveError } = usePrefs();
  const [pick, note] = useSave();
  return (
    <section className="card settings-card" aria-labelledby="set-appearance">
      <h2 id="set-appearance">{t("settings.appearance")}</h2>
      <Choice name="theme" label={t("settings.theme")} value={prefs.theme} options={PREFS.theme} onPick={pick("theme")}
              render={(o) => <><span className={`swatch-mode m-${o}`} aria-hidden />{t(`settings.theme.${o}`)}</>} />
      <Choice name="accent" label={t("settings.accent")} value={prefs.accent} options={PREFS.accent} onPick={pick("accent")}
              render={(o) => <><span className={`swatch a-${o}`} aria-hidden />{t(`settings.accent.${o}`)}</>} />
      <Choice name="density" label={t("settings.density")} value={prefs.density} options={PREFS.density} onPick={pick("density")}
              render={(o) => t(`settings.density.${o}`)} />
      <Choice name="scale" label={t("settings.scale")} value={prefs.scale} options={PREFS.scale} onPick={pick("scale")}
              render={(o) => <span className={`scale-s s-${o}`}>{t(`settings.scale.${o}`)}</span>} />
      <Choice name="grid" label={t("settings.grid")} value={prefs.grid} options={PREFS.grid} onPick={pick("grid")}
              render={(o) => t(`tk.mode.${o}`)} />
      <div className="settings-preview" aria-label={t("settings.preview")}>
        <span className="sm muted">{t("settings.preview")}</span>
        <div className="pv-row">
          <button type="button" className="btn">{t("common.save")}</button>
          <button type="button" className="btn ghost">{t("common.cancel")}</button>
          <span className="pill ok">OK</span><span className="pill warn">!</span><span className="pill bad">×</span>
        </div>
        <input type="text" readOnly value={t("tk.search")} aria-label={t("tk.search")} />
      </div>
      <Saved note={note} err={saveError} />
    </section>
  );
}

function Language() {
  const { prefs, t, saveError } = usePrefs();
  const [pick, note] = useSave();
  return (
    <section className="card settings-card" aria-labelledby="set-language">
      <h2 id="set-language">{t("settings.language")}</h2>
      <Choice name="lang" label={t("settings.language")} value={prefs.lang} options={PREFS.lang} onPick={pick("lang")}
              render={(o) => <span lang={o}>{LANGS[o].name}</span>} />
      <p className="sm muted">{t("settings.languageHint")}</p>
      <Saved note={note} err={saveError} />
    </section>
  );
}

function Saved({ note, err }) {
  const { t } = usePrefs();
  if (err) return <p className="err sm" role="alert">{t("settings.savedLocal", { err })}</p>;
  return note ? <p className="okmsg sm" role="status">{t("settings.saved")}</p> : null;
}

function Password() {
  const { call } = usePlatform();
  const { t } = usePrefs();
  const [f, setF] = useState({ current: "", next: "", again: "" });
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setMsg(null); setOk(null);
    if (f.next !== f.again) { setMsg(t("settings.pw.mismatch")); return; }
    setBusy(true);
    try {
      await call("/api/auth/password", { method: "POST", body: JSON.stringify({ current: f.current, next: f.next }) });
      setF({ current: "", next: "", again: "" });
      setOk(t("settings.pw.done"));
    } catch (e2) { setMsg(e2.message); }
    setBusy(false);
  }
  const F = (k, ac) => (
    <div className="field"><label htmlFor={`acc-${k}`}>{t(`settings.pw.${k}`)}</label>
      <input id={`acc-${k}`} type="password" dir="ltr" autoComplete={ac} required value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>);
  return (
    <section className="card settings-card" aria-labelledby="set-password">
      <h2 id="set-password">{t("settings.password")}</h2>
      <form onSubmit={submit}>
        {F("current", "current-password")}
        {F("next", "new-password")}
        {F("again", "new-password")}
        <p className="sm muted">{t("settings.pw.rule")}</p>
        {msg && <p className="err" role="alert">{msg}</p>}
        {ok && <p className="okmsg" role="status">{ok}</p>}
        <button className="btn" type="submit" disabled={busy}>{busy ? t("settings.pw.busy") : t("settings.pw.submit")}</button>
      </form>
    </section>
  );
}
