import "@fontsource-variable/vazirmatn";
import "@fontsource-variable/inter";
import "./globals.css";
import "./design.css";
import { PlatformProvider } from "../lib/client/platform.mjs";
import { PrefsProvider } from "../lib/client/prefs.mjs";
import Shell from "../components/platform/Shell";
import ServiceWorker from "../components/platform/ServiceWorker";

export const metadata = {
  title: "EPC Platform — سامانهٔ یکپارچهٔ اجرای پروژه",
  description: "مشخصات پروژه، پیمانکاران، ساب‌سیستم‌ها و اجرای رشته‌ها در یک سامانه",
  // Installable on a phone's home screen, opening straight to the field page.
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "EPC سایت", statusBarStyle: "black-translucent" },
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
  themeColor: "#0A1116",
};

const PREPAINT = `try{var e=document.documentElement,p={};try{p=JSON.parse(localStorage.getItem('epc.prefs')||'{}')||{}}catch(x){}
var o=localStorage.getItem('epc.theme');if(!p.theme&&(o==='light'||o==='dark'))p.theme=o;
var l={fa:'rtl',ar:'rtl',en:'ltr'}[p.lang]?p.lang:'fa';e.lang=l;e.dir=l==='en'?'ltr':'rtl';
var t=p.theme==='light'||p.theme==='dark'?p.theme:p.theme==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):'dark';
e.dataset.theme=t;e.dataset.accent=p.accent||'teal';e.dataset.density=p.density||'comfortable';e.dataset.scale=p.scale||'m'}catch(x){}`;

/**
 * The shell wraps everything, which makes it the single authentication gate:
 * a signed-out visitor gets the login form and no page has to remember to
 * check. A check that each screen must remember is a check one screen will
 * forget.
 */
export default function RootLayout({ children }) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        {/* The person's settings, before the first paint (lib/client/prefs.mjs
            applyPrefs does the same after): without this an English or
            light-theme user sees the dark Persian page flash on every load. */}
        <script dangerouslySetInnerHTML={{ __html: PREPAINT }} />
      </head>
      <body>
        <ServiceWorker />
        <PlatformProvider>
          <PrefsProvider>
            <Shell>{children}</Shell>
          </PrefsProvider>
        </PlatformProvider>
      </body>
    </html>
  );
}
