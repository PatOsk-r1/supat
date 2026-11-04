// Completa los títulos del catálogo con información de TMDb, sin pisar lo que ya trae
// el proveedor.
import { settings } from "../app/settings.js";
import { lookup, seasonEpisodes, testKey } from "./tmdb.js";

const info = new Map();      // id del elemento → metadatos de TMDb (o null si no se encontró)
const pending = new Map();   // id del elemento → promesa en curso
const BACKGROUND_LIMIT = 150; // máximo de búsquedas automáticas por sesión (para las tarjetas)
const CONCURRENCY = 3;
let backgroundDone = 0;

const options = () => ({ key: settings.get("tmdbKey"), language: settings.get("language"), region: settings.get("region") });
export const enabled = () => Boolean(settings.get("tmdbKey"));
const eligible = item => item && ["movie", "series", "anime"].includes(item.kind);

function apply(item, data) {
  if (!data) return;
  item.poster ||= data.poster;
  item.backdrop ||= data.backdrop;
  item.description ||= data.description;
  item.rating ||= data.rating;
  item.year ||= data.year;
  // Identificadores externos: permiten que otros proveedores encuentren fuentes para este título.
  item.externalIds = { ...item.externalIds };
  item.externalIds.tmdb ||= data.tmdbId;
  if (data.imdbId) item.externalIds.imdb ||= data.imdbId;
}

export function enrichment(item) {
  return info.get(item.id) || null;
}

// Pide la información de un título (una sola vez). onDone se llama si hubo datos nuevos.
export function request(item, onDone) {
  if (!enabled() || !eligible(item)) return Promise.resolve(null);
  if (info.has(item.id)) return Promise.resolve(info.get(item.id));
  if (!pending.has(item.id)) {
    pending.set(item.id, lookup(item, options())
      .then(data => { info.set(item.id, data); apply(item, data); if (data) onDone?.(item); return data; })
      .catch(() => null)
      .finally(() => pending.delete(item.id)));
  }
  return pending.get(item.id);
}

// Completa en segundo plano los títulos que no tienen póster, de a pocos a la vez.
export async function enrichInBackground(items, onProgress) {
  if (!enabled()) return;
  const queue = items.filter(x => eligible(x) && !x.poster && !info.has(x.id));
  let changed = 0;
  async function worker() {
    while (queue.length && backgroundDone < BACKGROUND_LIMIT && enabled()) {
      const item = queue.shift();
      backgroundDone++;
      if (await request(item)) changed++;
      if (changed && changed % 6 === 0) onProgress?.();
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (changed) onProgress?.();
}

// Completa título, sinopsis, imagen y duración de los episodios de una temporada.
export async function enrichSeason(item, season) {
  const data = info.get(item.id);
  if (!data || data.type !== "tv" || !season?.number || season.enriched) return false;
  const episodes = await seasonEpisodes(data.tmdbId, season.number, options());
  for (const ep of season.episodes) {
    const match = episodes.find(x => x.number === ep.number);
    if (!match) continue;
    if (!ep.title || /^Episodio \d+$/.test(ep.title)) ep.title = match.title || ep.title;
    ep.description ||= match.description;
    ep.still ||= match.still;
    ep.duration ||= match.duration;
  }
  season.enriched = true;
  return true;
}

export async function checkKey() {
  try {
    await testKey(options());
    return "La clave funciona. Las imágenes y la información se completarán automáticamente.";
  } catch (err) {
    return err.message;
  }
}
