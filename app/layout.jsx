import "./globals.css";

export const metadata = {
  title: "ISO Weld Map — آیزومتریک به رجیستر جوش",
  description: "آپلود آیزومتریک، مدل سه‌بعدی، سرجوش‌گذاری بر مبنای ASME B16.9 و B31.3",
};

/**
 * Without this, a phone browser does not report its real width. It assumes a
 * ~980px desktop viewport and scales the whole page down to fit, which is why
 * the first run on a real phone came out with the text clipped at both edges
 * and everything oversized.
 *
 * The damage is worse than cosmetic: globals.css already carries a
 * `@media (max-width:900px)` layout for exactly this case, and at a reported
 * 980px it never matches. The responsive design was there the whole time and
 * simply could not fire. This is the line that lets it.
 */
export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="fa" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
