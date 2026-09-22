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

  return (
    <div className="signin" dir="rtl">
      <form onSubmit={submit}>
        <div className="mark">EPC&nbsp;PLATFORM</div>
        <h1>ورود به سامانه</h1>

        <div className="field">
          <label htmlFor="email">ایمیل</label>
          <input id="email" type="email" autoComplete="username" required
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

        <p className="muted sm">
          حساب ندارید؟ مدیر سامانه با دستور <code>npm run auth:admin</code> آن را می‌سازد.
        </p>
      </form>
    </div>
  );
}
