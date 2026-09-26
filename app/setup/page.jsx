"use client";
import { useEffect, useState } from "react";
import { useTheme } from "../../components/platform/Shell";

/**
 * Setting a password from a one-time link: a new account's first, or a
 * reset a developer issued. The token in the link is the credential; it is
 * spent here, and the page then sends the person to sign in.
 */
export default function SetupPage() {
  useTheme();
  const [token, setToken] = useState(null);
  const [who, setWho] = useState(null);
  const [err, setErr] = useState(null);
  const [f, setF] = useState({ a: "", b: "" });
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = new URL(window.location.href).searchParams.get("token");
    setToken(t);
    // The token leaves the address bar once read: not left in history for the next person at this screen.
    window.history.replaceState(null, "", "/setup");
    if (!t) { setErr("لینک ناقص است."); return; }
    fetch(`/api/auth/setup?token=${encodeURIComponent(t)}`).then(async (r) => {
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      setWho(body);
    }).catch((e) => setErr(e.message));
  }, []);

  async function submit(e) {
    e.preventDefault();
    setErr(null);
    if (f.a !== f.b) { setErr("دو رمز یکسان نیستند."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/auth/setup", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: f.a }) });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      setDone(true);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  }

  return (
    <div className="signin">
      <form onSubmit={submit} autoComplete="on">
        <span className="mark">EPC PLATFORM</span>
        <h1>{who?.purpose === "reset" ? "بازنشانی رمز عبور" : "تنظیم رمز عبور"}</h1>
        {who && <p className="sm muted" style={{ margin: 0 }}>برای حساب <b dir="ltr" className="mono">{who.email}</b>
          {who.displayName && ` (${who.displayName})`}</p>}
        {done ? (
          <>
            <p className="sm" style={{ color: "var(--ok)" }}>رمز تنظیم شد. حالا با ایمیل و همین رمز وارد شوید.</p>
            <a className="btn" href="/" style={{ textAlign: "center", textDecoration: "none" }}>ورود به سامانه</a>
          </>
        ) : who ? (
          <>
            <input type="email" name="username" value={who.email} readOnly hidden autoComplete="username" />
            <div className="field"><label htmlFor="pw1">رمز جدید</label>
              <input id="pw1" type="password" autoComplete="new-password" required minLength={10} dir="ltr"
                     value={f.a} onChange={(e) => setF({ ...f, a: e.target.value })} />
              <span className="hint">دست‌کم ۱۰ نویسه؛ یک عبارت بلند بهتر از نمادهای عجیب است.</span></div>
            <div className="field"><label htmlFor="pw2">تکرار رمز</label>
              <input id="pw2" type="password" autoComplete="new-password" required dir="ltr"
                     value={f.b} onChange={(e) => setF({ ...f, b: e.target.value })} /></div>
            <button className="btn" type="submit" disabled={busy}>{busy ? "…" : "تنظیم رمز"}</button>
          </>
        ) : !err && <p className="muted sm">در حال بررسی لینک…</p>}
        {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
      </form>
    </div>
  );
}
