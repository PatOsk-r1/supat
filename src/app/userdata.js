// Datos personales de la cuenta en Firestore: favoritos, historial ("seguir viendo") y listas.
// Siempre bajo users/<uid de la sesión>/…: las reglas rechazan cualquier otra ruta.
// Expone la misma forma que los módulos locales (favorites.js, progress.js) para que la
// interfaz no tenga que cambiar.
import { getFirebase } from "./firebase.js";
import { account } from "./account.js";

const keyOf = id => encodeURIComponent(String(id)).slice(0, 1400); // id de documento válido
const CLOUD_SAVE_MS = 30000;      // el progreso se sube como mucho cada 30 s por título
const MIN_SECONDS = 10;
const FINISHED_RATIO = 0.95;
const MAX_PUBLIC_ITEMS = 200;

const listeners = new Set();
const emit = () => listeners.forEach(fn => fn());
let unsubs = [];
let uid = null;

const favs = new Map();      // itemId → { itemId, kind, title, poster }
const history = new Map();   // playId → entrada
const lists = new Map();     // listId → { id, name, description, visibility }
const listItems = new Map(); // listId → Map(itemId → item)
const lastCloudSave = new Map();
const pending = new Map();

// Datos mínimos de un título para guardarlo (lo que validan las reglas).
export function itemRef(item) {
  return {
    itemId: String(item.id).slice(0, 300),
    kind: item.kind,
    title: String(item.title || "Sin título").slice(0, 200),
    poster: String(item.poster || "").slice(0, 600)
  };
}

async function ownerKey() {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(uid));
  return Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function stop() {
  unsubs.forEach(u => u());
  unsubs = [];
  favs.clear(); history.clear(); lists.clear(); listItems.clear(); pending.clear();
  uid = null;
}

async function startFor(user) {
  const { F, db } = await getFirebase();
  uid = user.uid;
  const col = name => F.collection(db, "users", uid, name);
  const watch = (name, map, toEntry) => F.onSnapshot(col(name), snap => {
    map.clear();
    snap.forEach(d => map.set(...toEntry(d)));
    emit();
  }, () => emit());
  unsubs.push(
    watch("favorites", favs, d => [d.data().itemId, d.data()]),
    watch("history", history, d => {
      const x = d.data();
      return [decodeURIComponent(d.id), { ...x, id: decodeURIComponent(d.id), updatedAt: x.updatedAt?.toMillis?.() || 0 }];
    }),
    watch("lists", lists, d => [d.id, { id: d.id, ...d.data() }])
  );
}

account.onChange(() => {
  const next = account.signedIn && account.verified && !account.suspended ? account.user.uid : null;
  if (next === uid) return;
  stop();
  if (next) startFor(account.user);
  emit();
});

async function write(fn) {
  const fb = await getFirebase();
  return fn(fb.F, fb.db);
}

export const userdata = {
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  get active() { return Boolean(uid); },

  favorites: {
    persistent: true,
    has: id => favs.has(id),
    list: () => [...favs.keys()],
    get size() { return favs.size; },
    async toggle(item) {
      const ref = itemRef(item);
      const on = !favs.has(ref.itemId);
      // Se actualiza la pantalla al instante; si Firestore rechaza, se revierte.
      on ? favs.set(ref.itemId, ref) : favs.delete(ref.itemId);
      emit();
      try {
        await write((F, db) => {
          const d = F.doc(db, "users", uid, "favorites", keyOf(ref.itemId));
          return on ? F.setDoc(d, { ...ref, addedAt: F.serverTimestamp() }) : F.deleteDoc(d);
        });
      } catch (err) {
        on ? favs.delete(ref.itemId) : favs.set(ref.itemId, ref);
        emit();
        throw err;
      }
      return on;
    },
    async clear() {
      await write((F, db) => Promise.all([...favs.keys()].map(id => F.deleteDoc(F.doc(db, "users", uid, "favorites", keyOf(id))))));
    }
  },

  // Misma forma que app/progress.js.
  progress: {
    save(id, time, duration, extra = {}) {
      if (!uid || !Number.isFinite(time) || time < MIN_SECONDS) return;
      const finished = Number.isFinite(duration) && duration > 0 && time / duration >= FINISHED_RATIO;
      const entry = {
        itemId: String(extra.itemId || id).slice(0, 300),
        kind: extra.kind || "movie",
        title: String(extra.title || "Sin título").slice(0, 200),
        poster: String(extra.poster || "").slice(0, 600),
        episodeId: String(extra.episodeId || "").slice(0, 300),
        episodeLabel: String(extra.episodeLabel || "").slice(0, 200),
        time: finished ? 0 : Math.floor(time),
        duration: Number.isFinite(duration) ? Math.floor(duration) : 0,
        finished
      };
      history.set(id, { ...entry, id, updatedAt: Date.now() });
      pending.set(id, entry);
      if (finished || Date.now() - (lastCloudSave.get(id) || 0) > CLOUD_SAVE_MS) userdata.progress.flush(id);
    },
    // Sube a Firestore el progreso pendiente (de un título o de todos).
    flush(onlyId = null) {
      for (const [id, entry] of pending) {
        if (onlyId && id !== onlyId) continue;
        pending.delete(id);
        lastCloudSave.set(id, Date.now());
        write((F, db) => F.setDoc(F.doc(db, "users", uid, "history", keyOf(id)), { ...entry, updatedAt: F.serverTimestamp() })).catch(() => {});
      }
    },
    get: id => history.get(id) || null,
    resumeTime(id) {
      const e = history.get(id);
      return e && !e.finished && e.time >= MIN_SECONDS ? e.time : 0;
    },
    isFinished: id => Boolean(history.get(id)?.finished),
    recent(limit = 20) {
      return [...history.values()].filter(e => !e.finished).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
    },
    all: () => [...history.values()].sort((a, b) => b.updatedAt - a.updatedAt),
    async remove(id) {
      history.delete(id);
      emit();
      await write((F, db) => F.deleteDoc(F.doc(db, "users", uid, "history", keyOf(id))));
    },
    async clear() {
      const ids = [...history.keys()];
      history.clear();
      emit();
      await write((F, db) => Promise.all(ids.map(id => F.deleteDoc(F.doc(db, "users", uid, "history", keyOf(id))))));
    }
  },

  lists: {
    all: () => [...lists.values()].sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0)),
    get: id => lists.get(id) || null,
    async create({ name, description = "", visibility = "private" }) {
      return write(async (F, db) => {
        const ref = F.doc(F.collection(db, "users", uid, "lists"));
        await F.setDoc(ref, { name: name.trim().slice(0, 80), description: description.trim().slice(0, 300), visibility, createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp() });
        if (visibility === "public") await userdata.lists.syncPublic(ref.id);
        return ref.id;
      });
    },
    async update(id, { name, description, visibility }) {
      const current = lists.get(id);
      await write((F, db) => F.updateDoc(F.doc(db, "users", uid, "lists", id), {
        name: (name ?? current.name).trim().slice(0, 80),
        description: (description ?? current.description).trim().slice(0, 300),
        visibility: visibility ?? current.visibility,
        updatedAt: F.serverTimestamp()
      }));
      await userdata.lists.syncPublic(id, visibility ?? current.visibility);
    },
    async remove(id) {
      await write(async (F, db) => {
        await F.deleteDoc(F.doc(db, "publicLists", id)).catch(() => {});
        const items = await F.getDocs(F.collection(db, "users", uid, "lists", id, "items"));
        await Promise.all(items.docs.map(d => F.deleteDoc(d.ref)));
        await F.deleteDoc(F.doc(db, "users", uid, "lists", id));
      });
      listItems.delete(id);
    },
    // Títulos de una lista (se cargan cuando se abre).
    async items(id, { refresh = false } = {}) {
      if (listItems.has(id) && !refresh) return [...listItems.get(id).values()];
      const snap = await write((F, db) => F.getDocs(F.collection(db, "users", uid, "lists", id, "items")));
      const map = new Map(snap.docs.map(d => [d.data().itemId, d.data()]));
      listItems.set(id, map);
      return [...map.values()];
    },
    async addItem(id, item) {
      const ref = itemRef(item);
      await write(async (F, db) => {
        await F.setDoc(F.doc(db, "users", uid, "lists", id, "items", keyOf(ref.itemId)), { ...ref, addedAt: F.serverTimestamp() });
        await F.updateDoc(F.doc(db, "users", uid, "lists", id), { updatedAt: F.serverTimestamp() });
      });
      (listItems.get(id) || listItems.set(id, new Map()).get(id)).set(ref.itemId, ref);
      await userdata.lists.syncPublic(id);
    },
    async removeItem(id, itemId) {
      await write((F, db) => F.deleteDoc(F.doc(db, "users", uid, "lists", id, "items", keyOf(itemId))));
      listItems.get(id)?.delete(itemId);
      await userdata.lists.syncPublic(id);
    },
    // Mantiene la copia pública: la crea o actualiza si la lista es pública, la borra si no.
    async syncPublic(id, visibility = lists.get(id)?.visibility) {
      await write(async (F, db) => {
        const ref = F.doc(db, "publicLists", id);
        if (visibility !== "public") { await F.deleteDoc(ref).catch(() => {}); return; }
        const l = lists.get(id) || (await F.getDoc(F.doc(db, "users", uid, "lists", id))).data();
        const items = (await userdata.lists.items(id)).slice(0, MAX_PUBLIC_ITEMS).map(({ itemId, kind, title, poster }) => ({ itemId, kind, title, poster }));
        await F.setDoc(ref, { name: l.name, description: l.description || "", ownerName: account.name.slice(0, 40), ownerKey: await ownerKey(), items, updatedAt: F.serverTimestamp() });
      });
    },
    publicIds: () => [...lists.values()].filter(l => l.visibility === "public").map(l => l.id)
  },

  // Lista pública de cualquier usuario (no necesita sesión).
  async publicList(id) {
    const { F, db } = await getFirebase();
    const snap = await F.getDoc(F.doc(db, "publicLists", id));
    if (!snap.exists()) return null;
    const { name, description, ownerName, items, updatedAt } = snap.data();
    return { id, name, description, ownerName, items: items || [], updatedAt: updatedAt?.toMillis?.() || 0 };
  }
};

// Al cerrar o esconder la página, se sube el progreso pendiente.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => userdata.progress.flush());
  document.addEventListener("visibilitychange", () => { if (document.hidden) userdata.progress.flush(); });
}
