// Caché grande en IndexedDB (catálogos de proveedores, guías de programación, datos de TMDb).
// localStorage solo admite ~5 MB; una lista IPTV puede pesar más, por eso se usa IndexedDB.
// Si IndexedDB no está disponible (modo privado, Node en las pruebas), se usa memoria.
const DB_NAME = "xuper-web";
const STORE = "cache";
const memory = new Map();
let dbPromise = null;

function openDb() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("sin IndexedDB"));
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function run(mode, action) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const request = action(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

export async function cacheGet(key) {
  try { return await run("readonly", s => s.get(key)); } catch { return memory.get(key); }
}

export async function cacheSet(key, value) {
  try { await run("readwrite", s => s.put(value, key)); } catch { memory.set(key, value); }
}

export async function cacheDelete(key) {
  memory.delete(key);
  try { await run("readwrite", s => s.delete(key)); } catch { /* ya no está */ }
}

export async function cacheClear() {
  memory.clear();
  try { await run("readwrite", s => s.clear()); } catch { /* nada que borrar */ }
}
