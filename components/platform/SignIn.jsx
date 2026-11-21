"use client";
import { useEffect, useState } from "react";
import { usePlatform } from "../../lib/client/platform.mjs";
import { usePrefs } from "../../lib/client/prefs.mjs";
import styles from "./SignIn.module.css";
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
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState(null);
  const [via, setVia] = useState(null);        // "email" when the server mails the reset link
  useEffect(() => {
    if (!forgot || via) return;
    fetch("/api/auth/forgot", { credentials: "same-origin" }).then((r) => r.json()).then((b) => setVia(b.via)).catch(() => {});
  }, [forgot, via]);

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
      setBusy(false);
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
      setSent(t(body.via === "email" ? "signin.sentMail" : "signin.sentAdmin"));
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  }

  return (
    <main className={styles.screen}>
      <section className={styles.panel} aria-labelledby="signin-title">
        <header className={styles.top}>
          <div className={styles.brand}><img src="/icons/icon-192.png" alt="" width="36" height="36" /><b dir="ltr">EPC Platform</b></div>
          <LangPick lang={lang} setPref={setPref} />
        </header>
        <div className={styles.content}>
          <h1 id="signin-title">{t(forgot ? "signin.forgotTitle" : "signin.title")}</h1>
          <p className={styles.intro}>{t(forgot ? (via === "email" ? "signin.forgotHelpMail" : "signin.forgotHelp") : "signin.intro")}</p>
          <form className={styles.form} onSubmit={forgot ? askReset : submit} aria-busy={busy}>
            <div className="field">
              <label htmlFor={forgot ? "forgot-login" : "email"}>{t("signin.login")}</label>
              <input key={forgot ? "reset" : "signin"} id={forgot ? "forgot-login" : "email"} type="text"
                autoComplete="username" autoCapitalize="none" spellCheck={false} required value={email} dir="ltr"
                onChange={(e) => { setEmail(e.target.value); setSent(null); }} />
            </div>
            {!forgot && <div className="field">
              <label htmlFor="password">{t("signin.password")}</label>
              <div className={styles.password}>
                <input id="password" type={showPassword ? "text" : "password"} autoComplete="current-password"
                  required value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" />
                <button type="button" className={styles.visibility} onClick={() => setShowPassword((v) => !v)}>
                  {t(showPassword ? "signin.hidePassword" : "signin.showPassword")}
                </button>
              </div>
            </div>}
            {err && <p className={styles.error} role="alert">{err}</p>}
            {sent && <p className={styles.status} role="status">{sent}</p>}
            <button className={styles.submit} type="submit" disabled={busy || !email.trim() || (forgot ? !!sent : !password)}>
              {t(forgot ? (busy ? "signin.sending" : "signin.sendReset") : (busy ? "signin.submitting" : "signin.submit"))}
            </button>
            <button className={styles.secondary} type="button" disabled={busy} onClick={() => {
              setForgot(!forgot); setErr(null); setSent(null); setShowPassword(false);
            }}>{t(forgot ? "signin.back" : "signin.forgot")}</button>
          </form>
        </div>
      </section>
      <aside className={styles.visual} aria-label={t("signin.visualTitle")}>
        <img src="/signin-refinery.webp" alt="" width="1120" height="1400" fetchPriority="high" />
        <div className={styles.caption}><strong>{t("signin.visualTitle")}</strong></div>
      </aside>
    </main>
  );
}

/** The language, before signing in: a visitor who does not read Persian can still find the way in. */
function LangPick({ lang, setPref }) {
  return (
    <div className={styles.languages} role="group" aria-label="Language / زبان / اللغة">   // i18n: the picker's name in all three languages
      {Object.entries(LANGS).map(([k, l]) => (
        <button key={k} type="button" lang={k} aria-pressed={k === lang} onClick={() => setPref("lang", k)}>{l.name}</button>
      ))}
    </div>
  );
}
