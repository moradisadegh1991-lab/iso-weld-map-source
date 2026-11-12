/** Retain the complete command until its result and refreshed state are acknowledged. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const storageError = () => Object.assign(new Error("Pending operation storage is unavailable"), { code: "PENDING_OPERATION_STORAGE" });
const intentOf = ({ projectId, spoolId, code, doneAt = null, refNo = null }) =>
  ({ projectId, kind: "activity", spoolId, code, doneAt, refNo });

export function prepareSpoolOperation(storage, args, newId = () => crypto.randomUUID()) {
  if (!args.actorId || !storage) throw storageError();
  const intent = intentOf(args), signature = JSON.stringify(intent);
  const key = `piping-op:v1:${args.actorId}:${args.projectId}:${args.spoolId}:${args.code}`;
  let saved;
  try {
    const value = storage.getItem(key);
    saved = value ? JSON.parse(value) : null;
  } catch { throw storageError(); }
  const same = saved?.signature === signature && UUID.test(saved?.command?.opId || "")
    && JSON.stringify(intentOf(saved.command)) === signature;
  const why = args.materialOverride == null ? null : String(args.materialOverride).trim();
  // A retry initiated from the step button does not have the earlier override reason.
  // Preserve it with its operation id instead of silently creating another decision.
  const reuse = same && (why === null || why === (saved.command.materialOverride ?? null));
  const command = reuse ? saved.command : { ...intent, ...(why ? { materialOverride: why } : {}), opId: newId() };
  const serialized = JSON.stringify({ signature, command });
  try {
    storage.setItem(key, serialized);
    if (storage.getItem(key) !== serialized) throw storageError();
  } catch { throw storageError(); }
  return { key, command };
}

export function acknowledgeSpoolOperation(storage, operation) {
  try {
    const saved = JSON.parse(storage.getItem(operation.key) || "null");
    if (saved?.command?.opId !== operation.command.opId) return false;
    storage.removeItem(operation.key);
    return true;
  } catch { return false; } // Keeping the receipt permits a safe retry later.
}
