"use client";
import { useEffect, useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";

/**
 * One asset, every discipline (Master Plan §79): type or open a tag and see
 * what it stands on, what feeds it, what measures it, what paints it, which
 * contracts cover it and where its chain is — each section the answer of
 * that discipline's own module, joined on the tag's id.
 *
 * The page reads ?tag= from the address, so a link — or later a QR code on
 * the equipment — opens it directly.
 */
export default function AssetPage() {
  const { projectId, call } = usePlatform();
  const { data: list } = useProjectData((id) => `/api/asset?projectId=${id}`, []);
  const [tag, setTag] = useState("");
  const [input, setInput] = useState("");
  const [thread, setThread] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tag");
    if (t) { setTag(t); setInput(t); }
  }, []);

  useEffect(() => {
    if (!tag || !projectId) return;
    setErr(null); setThread(null);
    call(`/api/asset?projectId=${projectId}&tag=${encodeURIComponent(tag)}`)
      .then(setThread).catch((e) => setErr(e.message));
    window.history.replaceState(null, "", `/asset?tag=${encodeURIComponent(tag)}`);
  }, [tag, projectId, call]);

  return (
    <div className="page">
      <div className="pagehead">
        <h1>شناسنامهٔ تجهیز</h1>
        <span className="sub">یک تگ، همهٔ رشته‌ها — از فونداسیون تا راه‌اندازی</span>
      </div>
      <form className="card" style={{ flexDirection: "row", gap: 8, alignItems: "center" }}
            onSubmit={(e) => { e.preventDefault(); setTag(input.trim()); }}>
        <input className="search" list="asset-tags" dir="ltr" placeholder="تگ، مثلاً P-1203A" value={input}
               onChange={(e) => setInput(e.target.value)} style={{ maxWidth: 280 }} aria-label="تگ" />
        <datalist id="asset-tags">
          {(list?.tags || []).map((t) => <option key={t.tag_no} value={t.tag_no}>{t.description || t.discipline}</option>)}
        </datalist>
        <button className="btn" type="submit" disabled={!input.trim()}>نمایش</button>
      </form>
      {err && <p className="err">{err === "tag not found" ? `تگ «${tag}» در این پروژه پیدا نشد.` : err}</p>}
      {thread && <Thread t={thread} open={(no) => { setInput(no); setTag(no); }} />}
    </div>
  );
}

function Thread({ t, open }) {
  const r = t.readiness;
  const steps = t.status.steps || [];
  return (
    <>
      <div className="card">
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "baseline" }}>
          <h2 className="mono" style={{ fontSize: 20 }}>{t.tag.tag_no}</h2>
          <span className="sm">{t.tag.description || <span className="muted">بدون شرح</span>}</span>
          <span className="muted sm">
            {t.tag.unit ? `واحد ${t.tag.unit} · ` : ""}{t.tag.system_code ? `سیستم ${t.tag.system_code} · ` : ""}
            {t.tag.subsystem ? `ساب‌سیستم ${t.tag.subsystem}` : "بدون ساب‌سیستم"} · {t.tag.discipline}{t.tag.kind ? ` / ${t.tag.kind}` : ""}
          </span>
          {t.tag.carries_tag_no && <span className="sm">روی آن: <Link no={t.tag.carries_tag_no} open={open} /></span>}
        </div>
        <div className="grid2">
          <div>
            <b className="sm">آمادگی دیجیتال — هویت ({r.identityPct}%)</b>
            {r.identity.map((c) => (
              <div key={c.key} className="sm">{c.ok ? "✓" : "✗"} {c.title}</div>
            ))}
          </div>
          <div>
            <b className="sm">داده‌های متصل ({r.linked} از {r.links.length} حوزه)</b>
            {r.links.map((l) => (
              <div key={l.key} className="sm">{l.count > 0 ? `✓ ${l.title} (${l.count})` : <span className="muted">— {l.title}: ثبت نشده</span>}</div>
            ))}
            <div className="muted sm" style={{ marginTop: 4 }}>
              حوزهٔ «ثبت نشده» ممکن است برای این تجهیز کاربرد نداشته باشد؛ سامانه آن را فرض نمی‌کند و در امتیاز نمی‌آورد.
            </div>
          </div>
        </div>
      </div>

      {steps.length > 0 && (
        <div className="card">
          <h2>زنجیرهٔ پیش‌نیاز · {t.status.progress.pct}% {t.status.why.ready && <span className="pill ok">آماده</span>}</h2>
          <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))" }}>
            {steps.map((s) => (
              <div key={s.code} className="card" style={{ padding: 8, gap: 4,
                borderColor: s.note?.level === "bad" ? "rgba(226,87,76,.6)" : s.status === "done" ? "rgba(63,178,127,.5)" : undefined }}>
                <span className="sm"><b>{s.derived ? "⚙ " : ""}{s.title}</b></span>
                <span className="sm muted">{s.na ? "کاربرد ندارد" : s.status === "done" ? "انجام شد"
                  : s.status === "in_progress" ? "در حال انجام" : s.blocked ? "منتظر پیش‌نیاز" : "آمادهٔ شروع"}</span>
              </div>
            ))}
          </div>
          {!t.status.why.ready && t.status.why.rootCauses.length > 0 && (
            <p className="sm">کاری که امروز باید شروع شود: {t.status.why.rootCauses.map((c) => c.title).join("، ")}</p>
          )}
        </div>
      )}

      <div className="grid2">
        <Section title="سیویل — فونداسیون" href="/civil" empty={!t.foundations.length}>
          {t.foundations.map((f) => (
            <Line key={f.id} left={<Link no={f.tag_no} open={open} />} mid={`${f.concrete_class || "—"} · ${f.pct}%`}
                  right={f.ready ? <span className="pill ok">تحویل‌شده</span>
                    : f.strength?.note?.level === "bad" ? <span className="pill bad">مقاومت پذیرفته نشده</span> : null} />
          ))}
        </Section>
        <Section title="پایپینگ — خطوط" href="/piping/execution" empty={!t.lines.length}>
          {t.lines.map((l) => (
            <Line key={l.id} left={<span className="mono">{l.line_no}</span>}
                  mid={`${l.welds} جوش · ${l.welded} جوشکاری‌شده · ${l.examined} بازرسی‌شده`} />
          ))}
        </Section>
        <Section title="برق — کابل‌ها" href="/electrical" empty={!t.cables.length}>
          {t.cables.map((c) => (
            <Line key={c.id} left={<span className="mono">{c.cableNo}</span>} mid={`${c.voltageClass || "?"} · ${c.pct}%`}
                  right={c.ready ? <span className="pill ok">آماده</span>
                    : c.ir.note?.level === "bad" ? <span className="pill bad">IR رد</span> : null} />
          ))}
        </Section>
        <Section title="ابزار دقیق" href="/instrumentation" empty={!t.instruments.length}>
          {t.instruments.map((i) => (
            <Line key={i.id} left={<span className="mono">{i.tagNo}</span>} mid={`${i.loopNo || "بدون لوپ"} · ${i.pct}%`}
                  right={i.ready ? <span className="pill ok">آماده</span>
                    : i.calibration.note?.level === "bad" ? <span className="pill bad">کالیبراسیون رد</span> : null} />
          ))}
        </Section>
        <Section title="رنگ و عایق" href="/coating" empty={!t.coating}>
          {t.coating && <Line left={<span className="mono">{t.coating.system}</span>}
            mid={`${t.coating.pct}% · ${t.coating.next.join("، ") || "—"}`}
            right={t.coating.ready ? <span className="pill ok">تحویل‌شده</span> : null} />}
        </Section>
        <Section title="شناسنامهٔ نگهداری (CMMS)" href="/handover" empty={!t.master}>
          {t.master && <Line left={<span className="mono">{t.master.iso_class || "—"} · {t.master.criticality || "—"}</span>}
            mid={[t.master.manufacturer, t.master.model, t.master.serial_no].map((x) => x || "—").join(" / ")} />}
        </Section>
        <Section title="خرید" href="/procurement" empty={!t.purchase.length}>
          {t.purchase.map((l) => (
            <Line key={l.id} left={<span className="mono">{l.po_no}</span>}
                  mid={`${l.vendor_code} · تحویل ${fa(l.forecast_on || l.promised_on)}${l.float_days !== null ? ` · شناوری ${l.float_days} روز` : ""}`}
                  right={l.received_qty >= l.qty ? <span className="pill ok">رسید سایت</span>
                    : l.float_days !== null && l.float_days < 0 ? <span className="pill bad">دیرتر از نیاز</span> : null} />
          ))}
        </Section>
        <Section title="Punch و NCR" href="/quality" empty={!t.punch.length && !t.ncrs.length}>
          {t.punch.map((p) => (
            <Line key={p.id} left={<span className="mono">{p.punch_no}</span>} mid={`${p.category} · ${p.description}`}
                  right={p.status === "closed" ? <span className="pill ok">بسته</span>
                    : <span className={`pill ${p.category === "A" ? "bad" : "warn"}`}>{p.status === "cleared" ? "منتظر تأیید" : "باز"}</span>} />
          ))}
          {t.ncrs.map((n) => (
            <Line key={n.id} left={<span className="mono">{n.ncr_no}</span>} mid={n.title}
                  right={<span className={`pill ${n.status === "closed" ? "ok" : "bad"}`}>{n.status === "closed" ? "بسته" : "باز"}</span>} />
          ))}
        </Section>
        <Section title="قراردادها" href="/contractors" empty={!t.packages.length}>
          {t.packages.map((p) => (
            <Line key={p.code} left={<span className="mono">{p.code}</span>} mid={`${p.discipline} · ${p.contractor}`} />
          ))}
        </Section>
      </div>

      <div className="card">
        <h2>هنوز در این پلتفرم نیست</h2>
        <p className="muted sm">این حوزه‌ها در Master Plan آمده‌اند و ماژولشان ساخته نشده؛ نه کامل نشان داده می‌شوند نه ناقص.</p>
        <div className="sm">{t.notHeld.map((n) => n.title).join(" · ")}</div>
      </div>
    </>
  );
}

function Section({ title, href, empty, children }) {
  return (
    <div className="card" style={{ padding: 12 }}>
      <h2><a href={href} className="cy">{title}</a></h2>
      {empty ? <p className="muted sm">ثبت نشده</p> : children}
    </div>
  );
}

function Line({ left, mid, right = null }) {
  return (
    <div className="sm" style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
      <span>{left}</span><span className="muted">{mid}</span>{right || <span />}
    </div>
  );
}

function Link({ no, open }) {
  return <a href={`/asset?tag=${encodeURIComponent(no)}`} className="mono cy"
            onClick={(e) => { e.preventDefault(); open(no); }}>{no}</a>;
}

const fa = (d) => (d ? new Date(d).toLocaleDateString("fa-IR") : "—");
