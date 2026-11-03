// "Seguir viendo": recuerda por dónde iba cada película o episodio.
import { readJSON, writeJSON } from "./storage.js";

const KEY = "supat:progreso";
const MAX_ENTRIES = 200;
const MIN_SECONDS = 10;      // menos que esto no cuenta como "empezado"
const FINISHED_RATIO = 0.95; // pasado el 95 % se considera terminado

let entries = readJSON(KEY, {});
if (!entries || typeof entries !== "object" || Array.isArray(entries)) entries = {};

function persist() {
  const ids = Object.keys(entries);
  if (ids.length > MAX_ENTRIES) {
    ids.sort((a, b) => entries[a].updatedAt - entries[b].updatedAt)
      .slice(0, ids.length - MAX_ENTRIES)
      .forEach(id => delete entries[id]);
  }
  writeJSON(KEY, entries);
}

export const progress = {
  // id: id del elemento reproducido (película o episodio); extra: datos para mostrar en "Seguir viendo"
  save(id, time, duration, extra = {}) {
    if (!Number.isFinite(time) || time < MIN_SECONDS) return;
    const finished = Number.isFinite(duration) && duration > 0 && time / duration >= FINISHED_RATIO;
    entries[id] = { ...extra, time: finished ? 0 : Math.floor(time), duration: Number.isFinite(duration) ? Math.floor(duration) : 0, finished, updatedAt: Date.now() };
    persist();
  },
  get: id => entries[id] || null,
  // Segundo desde el que conviene seguir, o 0 si no hay nada que retomar.
  resumeTime(id) {
    const e = entries[id];
    return e && !e.finished && e.time >= MIN_SECONDS ? e.time : 0;
  },
  isFinished: id => Boolean(entries[id]?.finished),
  recent(limit = 20) {
    return Object.entries(entries)
      .filter(([, e]) => !e.finished)
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map(([id, e]) => ({ id, ...e }));
  },
  remove(id) { delete entries[id]; persist(); },
  clear() { entries = {}; persist(); }
};
