"use client";
import { useState } from "react";
import { usePlatform } from "../../lib/client/platform.mjs";
import { usePrefs } from "../../lib/client/prefs.mjs";
import { LANGS } from "../../lib/i18n/index.mjs";

/**
 * The sign-in screen.
 *
 * One error message for every kind of failure, because the server returns
 * one: telling an unknown email from a wrong password reveals which
 * addresses are real. The only exception the server makes — a locked
 * account — comes through as its own message, and that one is worth showing.
 */
export default function SignIn() {
  const { reload } = usePlatform();
  const { t, lang, setPref } = usePrefs();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || t("signin.status", { n: res.status }));
      await reload();
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  }

  async function askReset(e) {
    e.preventDefault();
    setBusy(true); setErr(null); setSent(null);
    try {
      const res = await fetch("/api/auth/forgot", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: email }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || t("signin.status", { n: res.status }));
      setSent(body.message);
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  }

  if (forgot) {
    return (
      <div className="signin">
        <form onSubmit={askReset}>
          <div className="mark">EPC&nbsp;PLATFORM</div>
          <LangPick lang={lang} setPref={setPref} />
          <h1>{t("signin.forgotTitle")}</h1>
          <p className="muted sm">{t("signin.forgotHelp")}</p>
          <div className="field">
            <label htmlFor="forgot-login">{t("signin.login")}</label>
            <input id="forgot-login" type="text" autoComplete="username" required value={email} onChange={(e) => { setEmail(e.target.value); setSent(null); }} dir="ltr" />
          </div>
          {err && <p className="err" role="alert">{err}</p>}
          {sent && <p className="okmsg" role="status">{sent}</p>}
          <button className="btn" type="submit" disabled={busy || !email || !!sent}>{busy ? t("signin.sending") : t("signin.sendReset")}</button>
          <button className="btn ghost" type="button" onClick={() => { setForgot(false); setErr(null); setSent(null); }}>{t("signin.back")}</button>
        </form>
      </div>
    );
  }

  return (
    <div className="signin">
      <form onSubmit={submit}>
        <div className="mark">EPC&nbsp;PLATFORM</div>
        <LangPick lang={lang} setPref={setPref} />
        <h1>{t("signin.title")}</h1>

        <div className="field">
          <label htmlFor="email">{t("signin.login")}</label>
          <input id="email" type="text" autoComplete="username" required
                 value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
        </div>

        <div className="field">
          <label htmlFor="password">{t("signin.password")}</label>
          <input id="password" type="password" autoComplete="current-password" required
                 value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" />
        </div>

        {err && <p className="err" role="alert">{err}</p>}

        <button className="btn" type="submit" disabled={busy || !email || !password}>
          {busy ? t("signin.submitting") : t("signin.submit")}
        </button>

        <button className="btn ghost" type="button" onClick={() => { setForgot(true); setErr(null); setSent(null); setBusy(false); }}>{t("signin.forgot")}</button>

        <p className="muted sm">
          {t("signin.noAccount", { cmd: "\u2068npm run auth:admin\u2069" })}
        </p>
      </form>
    </div>
  );
}

/** The language, before signing in: a visitor who does not read Persian can still find the way in. */
function LangPick({ lang, setPref }) {
  return (
    <div className="lang-pick" role="group" aria-label="Language / زبان / اللغة">   // i18n: the picker's name in all three languages
      {Object.entries(LANGS).map(([k, l]) => (
        <button key={k} type="button" lang={k} className={k === lang ? "on" : ""} aria-pressed={k === lang} onClick={() => setPref("lang", k)}>{l.name}</button>
      ))}
    </div>
  );
}
