"use client";
import { useEffect } from "react";

/**
 * Registers the service worker in production builds only. Under `next dev`
 * the chunk files change on every edit and a cache-first worker would serve
 * yesterday's code; there it is off unless explicitly asked for with
 * localStorage["epc.sw"] = "1".
 */
export default function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let wanted = process.env.NODE_ENV === "production";
    try { if (localStorage.getItem("epc.sw") === "1") wanted = true; } catch { /* ignore */ }
    if (!wanted) return;
    navigator.serviceWorker.register("/sw.js").catch(() => { /* offline support is a bonus, never a failure */ });
  }, []);
  return null;
}
