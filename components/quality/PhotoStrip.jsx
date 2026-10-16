"use client";
import { useEffect, useState } from "react";
import { PHOTO_STAGES } from "../../lib/quality/photo.mjs";

/**
 * The photos of one punch item: the server's (fetched when shown), and —
 * on the field page — the ones still queued on this phone, labelled as
 * such. Tapping one opens it full size.
 */
export default function PhotoStrip({ projectId, photos = [], queued = [] }) {
  if (!photos.length && !queued.length) return null;
  return (
    <div className="photo-strip">
      {photos.map((f) => <ServerThumb key={f.id} projectId={projectId} f={f} />)}
      {queued.map((o) => <QueuedThumb key={o.opId} op={o} />)}
    </div>
  );
}

/**
 * One of the server's photos. Offline, one this phone has not shown before
 * cannot load: it says so, instead of a broken image.
 */
function ServerThumb({ projectId, f }) {
  const [failed, setFailed] = useState(false);
  const src = `/api/quality/photo?projectId=${projectId}&id=${f.id}`;
  const stage = PHOTO_STAGES[f.stage] || f.stage;
  const by = f.by || f.by_name;
  return (
    <a href={src} target="_blank" rel="noopener" className="photo-thumb" title={`${stage} · ${day(f.takenOn || f.taken_on)}${by ? ` · ${by}` : ""}`}>
      {failed ? <span className="photo-none">📷<br />با شبکه دیده می‌شود</span>
        : <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />}
      <span className="photo-tag">{stage}</span>
    </a>
  );
}

function QueuedThumb({ op }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!op.blob) return;
    const u = URL.createObjectURL(op.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [op.blob]);
  return (
    <a href={url || undefined} target="_blank" rel="noopener" className={`photo-thumb ${op.state === "rejected" ? "is-rejected" : "is-queued"}`}>
      {url && <img src={url} alt="عکس در صف" />}
      <span className="photo-tag">{op.state === "rejected" ? "رد شد" : "در صف"}</span>
    </a>
  );
}

const day = (d) => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10) : "");
