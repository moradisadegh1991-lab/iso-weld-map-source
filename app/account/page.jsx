"use client";
import { useState } from "react";
import { usePlatform } from "../../lib/client/platform.mjs";

/**
 * The signed-in user's own account: change the password. The current one is
 * asked for; the new one ends every other session (another phone, another
 * computer), and this one stays signed in.
 */
export default function AccountPage() {
  const { user, call } = usePlatform();
  const [f, setF] = useState({ current: "", next: "", again: "" });
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setMsg(null); setOk(null);
    if (f.next !== f.again) { setMsg("رمز تازه و تکرار آن یکی نیستند."); return; }
    setBusy(true);
    try {
      await call("/api/auth/password", { method: "POST", body: JSON.stringify({ current: f.current, next: f.next }) });
      setF({ current: "", next: "", again: "" });
      setOk("رمز عبور عوض شد. نشست‌های دیگر این حساب (دستگاه‌های دیگر) بسته شدند.");
    } catch (e2) { setMsg(e2.message); }
    setBusy(false);
  }
  const F = (k, l, ac) => (
    <div className="field"><label htmlFor={`acc-${k}`}>{l}</label>
      <input id={`acc-${k}`} type="password" dir="ltr" autoComplete={ac} required value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>);
  return (
    <div className="page">
      <div className="pagehead"><h1>حساب من</h1><span className="sub">{user?.displayName || ""} · <span dir="ltr">{user?.email}</span></span></div>
      <div className="card" style={{ maxWidth: 480 }}>
        <h2>تغییر رمز عبور</h2>
        <form onSubmit={submit}>
          {F("current", "رمز فعلی", "current-password")}
          {F("next", "رمز تازه", "new-password")}
          {F("again", "تکرار رمز تازه", "new-password")}
          <p className="sm muted">رمز تازه دست‌کم ۱۰ نویسه باشد و از رمزهای رایج نباشد.</p>
          {msg && <p className="err" role="alert">{msg}</p>}
          {ok && <p className="okmsg" role="status">{ok}</p>}
          <button className="btn" type="submit" disabled={busy}>{busy ? "در حال ثبت…" : "تغییر رمز"}</button>
        </form>
      </div>
    </div>
  );
}
