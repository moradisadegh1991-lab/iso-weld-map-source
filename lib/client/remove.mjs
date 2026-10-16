"use client";
import { useMemo } from "react";
import { usePlatform } from "./platform.mjs";

/**
 * A table's «حذف» for one kind of record (app/api/records):
 *
 *   const removal = useRemove("contractor", reload);
 *   <TableKit {...(mayEdit ? removal : {})}>
 *
 * `checkDelete` asks the server, when the confirmation opens, whether
 * anything uses the row — so the reason shows before anyone confirms —
 * and `onDelete` deletes it and reloads the page's data. The server checks
 * again either way.
 */
export function useRemove(entity, reload) {
  const { call, projectId } = usePlatform();
  return useMemo(() => ({
    async checkDelete(id) {
      const q = new URLSearchParams({ projectId, entity, id });
      const { blocker } = await call(`/api/records?${q}`);
      return blocker || true;
    },
    async onDelete(id) {
      await call("/api/records", { method: "DELETE", body: JSON.stringify({ projectId, entity, id }) });
      reload?.();
      return true;
    },
  }), [call, projectId, entity, reload]);
}
