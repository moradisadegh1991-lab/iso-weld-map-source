"use client";
import { useEffect, useMemo, useState } from "react";
import WorkspaceFrame from "../../components/workspace/WorkspaceFrame";
import PidViewer from "../../components/PidViewer";
import PidPanel from "../../components/PidPanel";
import { useSession } from "../../lib/client/session.mjs";
import { usePidDocs, usePidDraft } from "../../lib/client/pid-center.mjs";
import { isPdf, openPdf, renderPage } from "../../lib/client/pdf.mjs";
import { buildGraph, connectedTo } from "../../lib/pid/graph.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";

/**
 * The P&ID workspace: the drawing page with the recognized items drawn over it, and the engineering registers beside it.
 * Selecting a row selects the item on the drawing and the other way round; the connected items of the selection are highlighted.
 * The page only shows the draft and sends the person's explicit actions (lib/client/pid-center.mjs); every one is re-checked by the server.
 */
export default function Page() {
  const session = useSession();
  const { docs, loading: docsLoading, error: docsError, refresh: refreshDocs } = usePidDocs({ session });
  const [docId, setDocId] = useState(null), [selectedUid, setSelectedUid] = useState(null), [focusTick, setFocusTick] = useState(0), [img, setImg] = useState(null), [fileErr, setFileErr] = useState("");
  const pid = usePidDraft({ session, documentId: docId });
  const { data } = pid;
  useEffect(() => { if (!docId && docs.length) setDocId(docs[0].documentId); }, [docs, docId]);
  useEffect(() => { setSelectedUid(null); }, [docId]);

  // the stored drawing, rendered to an image (the original PDF stays the governing source)
  const doc = docs.find((d) => d.documentId === docId);
  const pageNo = data?.draft?.page?.number || 1;
  useEffect(() => {
    setImg(null); setFileErr("");
    if (!doc?.hasFile || !session.projectId) return undefined;
    let gone = false;
    (async () => {
      try {
        const res = await fetch(`/api/documents?projectId=${session.projectId}&file=${doc.documentId}`, { credentials: "same-origin" });
        if (!res.ok) return;
        const blob = await res.blob();
        let url;
        if (isPdf({ type: blob.type, name: "x.pdf" }) || blob.type === "application/pdf") {
          const file = new File([blob], "sheet.pdf", { type: "application/pdf" });
          const { doc: pdf } = await openPdf(file);
          const { canvas } = await renderPage(pdf, Math.min(pageNo, pdf.numPages), { dpi: 110, maxPixels: 16e6 });
          url = canvas.toDataURL("image/png");
        } else url = URL.createObjectURL(blob);
        if (!gone) setImg(url);
      } catch (e) { if (!gone) setFileErr(e.message); }
    })();
    return () => { gone = true; };
  }, [doc?.documentId, doc?.hasFile, pageNo, session.projectId]);

  const onIngestFile = async (file) => {
    if (!file) return;
    try {
      const ocr = JSON.parse(await file.text());
      const r = await pid.ingest(ocr.ocr ? ocr : { ocr, reader: "ocr-json" });
      if (!r.error) refreshDocs();
    } catch (e) { pid.setNotice(`فایل خوانده نشد: ${e.message}`); }
  };

  const draft = data?.draft;
  const graph = useMemo(() => (draft ? buildGraph(draft, {}) : null), [draft]);
  const highlight = useMemo(() => (graph && selectedUid ? new Set(connectedTo(graph, selectedUid)) : null), [graph, selectedUid]);
  const canSign = can({ role: session.role }, ACTIONS.APPROVE_REGISTER);
  const locked = data?.run?.status === "approved";

  const explorer = (
    <div className="pane" data-pid-explorer>
      <h4>نقشه‌های P&amp;ID</h4>
      {docsLoading && <div className="muted sm">در حال بارگذاری…</div>}
      {docsError && <div className="err sm">{docsError}</div>}
      {!docsLoading && !docs.length && <div className="muted sm">نقشهٔ P&amp;ID ثبت نشده؛ از «مدیریت مدارک» با نوع P&amp;ID بارگذاری کنید.</div>}
      <ul className="plain" style={{ listStyle: "none", padding: 0 }}>
        {docs.map((d) => (
          <li key={d.documentId}>
            <button type="button" className={`ghost ${d.documentId === docId ? "on" : ""}`} data-pid-doc={d.documentId} onClick={() => setDocId(d.documentId)}>
              <span className="mono" dir="ltr">{d.docNo} · REV {d.revision}</span>
              <span className="muted sm"> {d.items} رکورد · {d.runStatus || "بدون پیش‌نویس"}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <WorkspaceFrame
      toolbar={(<>
        <span className="chip mono" dir="ltr" data-ws-chip="drawing">{doc ? `${doc.docNo} · REV ${doc.revision}` : "—"}</span>
        {data?.run && <span className="chip" data-ws-chip="status">{locked ? "تأییدشده" : "در بازبینی"}</span>}
        {draft && <span className="muted sm" data-ws-chip="counts">{draft.items.length} رکورد · {draft.edges.length} اتصال</span>}
        {pid.notice && <span className="chip warn" role="alert">{pid.notice}</span>}
      </>)}
      explorer={explorer}
      panelLabel="مهندسی P&ID"
      panel={data ? (
        <PidPanel pid={pid} data={data} selectedUid={selectedUid} onSelect={setSelectedUid} onGo={() => setFocusTick((t) => t + 1)} locked={locked}
          docs={docs} docId={docId} onOpenDoc={setDocId} canSign={canSign} onIngestFile={onIngestFile} />
      ) : (
        <div className="pane">
          {pid.loading ? <div className="muted">در حال بارگذاری…</div> : pid.error ? <div className="err">{pid.error}</div>
            : docId ? (<div data-pid-empty>
              <p className="muted">برای این نقشه هنوز پیش‌نویسی خوانده نشده است.</p>
              {can({ role: session.role }, ACTIONS.EDIT_EXTRACTION) && <label className="btn">فایل خروجی OCR (JSON)<input type="file" accept="application/json" data-pid-ocr-file onChange={(e) => onIngestFile(e.target.files?.[0])} /></label>}
            </div>) : <div className="muted">یک نقشه انتخاب کنید.</div>}
        </div>
      )}>
      {fileErr && <div className="err sm" role="alert">{fileErr}</div>}
      <PidViewer src={img} page={{ width: draft?.page?.width || 1000, height: draft?.page?.height || 800 }} items={draft?.items || []} selectedUid={selectedUid}
        highlight={highlight} focusTick={focusTick} onSelect={setSelectedUid} />
    </WorkspaceFrame>
  );
}
