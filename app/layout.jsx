import "./globals.css";
import { PlatformProvider } from "../lib/client/platform.mjs";
import Shell from "../components/platform/Shell";

export const metadata = {
  title: "EPC Platform — سامانهٔ یکپارچهٔ اجرای پروژه",
  description: "مشخصات پروژه، پیمانکاران، ساب‌سیستم‌ها و اجرای رشته‌ها در یک سامانه",
};

/**
 * Without this, a phone browser does not report its real width. It assumes a
 * ~980px desktop viewport and scales the whole page down to fit, which is why
 * the first run on a real phone came out with the text clipped at both edges
 * and everything oversized.
 *
 * The layout is designed for a desk — a phone is a test target here, not the
 * design target — but the narrow reflow in globals.css still has to be able
 * to fire, and at a reported 980px it never would.
 */
export const viewport = {
  width: "device-width",
  initialScale: 1,
};

/**
 * The shell wraps everything, which makes it the single authentication gate:
 * a signed-out visitor gets the login form and no page has to remember to
 * check. A check that each screen must remember is a check one screen will
 * forget.
 */
export default function RootLayout({ children }) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <PlatformProvider>
          <Shell>{children}</Shell>
        </PlatformProvider>
      </body>
    </html>
  );
}
