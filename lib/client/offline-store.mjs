/**
 * What the phone keeps for working offline, in IndexedDB.
 *
 *   packs  one field pack per project (and subsystem), as the server made it
 *   ops    operations captured on site: queued, then applied or refused
 *
 * IndexedDB rather than localStorage: a pack for a subsystem is hundreds of
 * kilobytes, localStorage is synchronous and small, and a private window
 * may refuse it. Every call here can fail (no IndexedDB, storage full,
 * private mode); callers show the failure, they do not assume success.
 */
const NAME = "epc-field";
const VERSION = 1;

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("این مرورگر ذخیره‌سازی آفلاین (IndexedDB) ندارد."));
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("packs")) db.createObjectStore("packs", { keyPath: "key" });
      if (!db.objectStoreNames.contains("ops")) {
        const s = db.createObjectStore("ops", { keyPath: "opId" });
        s.createIndex("project", "projectId");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    let out;
    Promise.resolve(fn(tx.objectStore(store))).then((v) => { out = v; }, reject);
    tx.oncomplete = () => { db.close(); resolve(out); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error("aborted")); };
  });
}
const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

export const packKey = (projectId) => `pack:${projectId}`;

export const savePack = (projectId, pack) => run("packs", "readwrite", (s) => req(s.put({ key: packKey(projectId), savedAt: new Date().toISOString(), pack })));
export const loadPack = (projectId) => run("packs", "readonly", (s) => req(s.get(packKey(projectId))));

/** Queue an operation. It stays until the server has answered for it. */
export const enqueue = (op) => run("ops", "readwrite", (s) => req(s.put({ ...op, state: "queued" })));
export const listOps = (projectId) => run("ops", "readonly", (s) => req(s.index("project").getAll(projectId)))
  .then((ops) => ops.sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt))));
export const updateOp = (op) => run("ops", "readwrite", (s) => req(s.put(op)));
export const removeOp = (opId) => run("ops", "readwrite", (s) => req(s.delete(opId)));
