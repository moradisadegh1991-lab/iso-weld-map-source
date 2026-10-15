"use client";
import { useState } from "react";
import { usePlatform } from "../../lib/client/platform.mjs";

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
      if (!res.ok) throw new Error(body.error || `پاسخ ${res.status}`);
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
      if (!res.ok) throw new Error(body.error || `پاسخ ${res.status}`);
      setSent(body.message);
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  }

  if (forgot) {
    return (
      <div className="signin" dir="rtl">
        <form onSubmit={askReset}>
          <div className="mark">EPC&nbsp;PLATFORM</div>
          <h1>بازیابی رمز عبور</h1>
          <p className="muted sm">ایمیل یا نام کاربری خود را بنویسید. درخواست برای مدیر سامانه ثبت می‌شود و او پس از اطمینان از هویت شما یک لینک یک‌بارمصرف
            برای تنظیم رمز تازه به شما می‌دهد.</p>
          <div className="field">
            <label htmlFor="forgot-login">ایمیل یا نام کاربری</label>
            <input id="forgot-login" type="text" autoComplete="username" required value={email} onChange={(e) => { setEmail(e.target.value); setSent(null); }} dir="ltr" />
          </div>
          {err && <p className="err" role="alert">{err}</p>}
          {sent && <p className="okmsg" role="status">{sent}</p>}
          <button className="btn" type="submit" disabled={busy || !email || !!sent}>{busy ? "در حال ثبت…" : "ثبت درخواست بازیابی"}</button>
          <button className="btn ghost" type="button" onClick={() => { setForgot(false); setErr(null); setSent(null); }}>بازگشت به ورود</button>
        </form>
      </div>
    );
  }

  return (
    <div className="signin" dir="rtl">
      <form onSubmit={submit}>
        <div className="mark">EPC&nbsp;PLATFORM</div>
        <h1>ورود به سامانه</h1>

        <div className="field">
          <label htmlFor="email">ایمیل یا نام کاربری</label>
          <input id="email" type="text" autoComplete="username" required
                 value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
        </div>

        <div className="field">
          <label htmlFor="password">رمز عبور</label>
          <input id="password" type="password" autoComplete="current-password" required
                 value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" />
        </div>

        {err && <p className="err" role="alert">{err}</p>}

        <button className="btn" type="submit" disabled={busy || !email || !password}>
          {busy ? "در حال بررسی…" : "ورود"}
        </button>

        <button className="btn ghost" type="button" onClick={() => { setForgot(true); setErr(null); setSent(null); setBusy(false); }}>رمز را فراموش کرده‌ام</button>

        <p className="muted sm">
          حساب ندارید؟ مدیر سامانه با دستور <code>npm run auth:admin</code> آن را می‌سازد.
        </p>
      </form>
    </div>
  );
}
