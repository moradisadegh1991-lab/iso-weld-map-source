/**
 * Outgoing mail, for the one thing the platform mails: a password-reset link
 * to the address on the account (owner's requirements of 2026-10-18, item 13).
 *
 * Off unless the server is told how to send AND where it lives:
 *   SMTP_HOST, SMTP_PORT (587), SMTP_SECURE (on for 465), SMTP_USER, SMTP_PASS,
 *   SMTP_FROM, and APP_URL — the address people open. The link is built from
 *   APP_URL, never from the request's Host header: a forged Host would mail a
 *   real token pointing at someone else's site.
 * With any of them missing the "forgot password" form files a request for the
 * administrators, as before.
 */
import nodemailer from "nodemailer";

export function mailConfig(env = process.env) {
  const { SMTP_HOST: host, SMTP_FROM: from, APP_URL: appUrl } = env;
  if (!host || !from || !/^https?:\/\/[^/\s]+/.test(appUrl || "")) return null;
  const port = Number(env.SMTP_PORT) || 587;
  return {
    host, port, from, appUrl: appUrl.replace(/\/+$/, ""),
    secure: env.SMTP_SECURE ? /^(1|on|true|yes)$/i.test(env.SMTP_SECURE) : port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS || "" } : undefined,
  };
}

let transport = null;

/** A mailer for the reset link, or null when mail is not configured. */
export function resetMailer(env = process.env) {
  const c = mailConfig(env);
  if (!c) return null;
  transport ||= nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure, auth: c.auth });
  return {
    async sendResetLink({ to, name, token, purpose, hours }) {
      const url = `${c.appUrl}/setup?token=${encodeURIComponent(token)}`;
      const what = purpose === "reset" ? "بازنشانی رمز عبور" : "تنظیم رمز عبور";
      await transport.sendMail({
        from: c.from, to,
        subject: `EPC Platform — ${what} / Password ${purpose === "reset" ? "reset" : "setup"}`,
        text: [
          `${name || ""}`.trim(),
          `برای ${what} حساب خود در سامانه این لینک را باز کنید. لینک یک‌بارمصرف است و ${hours} ساعت اعتبار دارد:`,
          url, "",
          `To ${purpose === "reset" ? "reset" : "set"} your password, open this one-time link (valid ${hours} hours):`,
          url, "",
          "اگر این درخواست از شما نبوده، این ایمیل را نادیده بگیرید. / If you did not ask for this, ignore this email.",
        ].filter((l, i) => i || l).join("\n"),
      });
    },
  };
}
