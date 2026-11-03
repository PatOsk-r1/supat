// Contrato de los adaptadores del servidor (ver worker/README.md).
//
// Un adaptador es un objeto con:
//   id, name, description               identificación
//   kinds: ["movie","series","anime","live"]   tipos que puede entregar (o kindsFor(config))
//   fields: [{ key, label, type, required, secret, help, options }]   configuración; secret = credencial
//   validate(config) → [errores]
//   supportsIncremental(config) → bool  ¿puede pedir solo lo cambiado desde una fecha?
//   test(ctx) → { message }                         prueba de conexión
//   listPage(ctx, { kind, cursor, since }) → { items, next }      catálogo paginado
//   listEpisodes(ctx, { source, cursor }) → { episodes, next }    episodios de una serie (opcional)
//   resolve(ctx, { source, episode }) → { url, type }            fuente al reproducir (opcional)
// ctx = { config, secrets, fetch, providerId }. ctx.fetch aplica tiempo máximo, pausa entre
// consultas, límite de consultas por ejecución y oculta los secretos en los errores.
import { redact } from "../secrets.js";

export const KINDS = ["movie", "series", "anime", "live"];

export class ProviderError extends Error {
  constructor(message, { retryable = false, status = 0 } = {}) {
    super(message);
    this.retryable = retryable;
    this.status = status;
  }
}

export const LIMITS = {
  timeoutMs: 15000,
  maxSubrequests: 40,       // el plan gratuito permite 50 por ejecución; se deja margen
  maxBodyBytes: 4 * 1024 * 1024,
  maxItemsPerPage: 200
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// fetch con límites para un proveedor. Lanza ProviderError (reintentable en 429/5xx/red).
export function guardedFetch({ secrets = {}, minIntervalMs = 0, fetchImpl = fetch, budget = { left: LIMITS.maxSubrequests } } = {}) {
  let last = 0;
  return async function providerFetch(url, init = {}) {
    if (budget.left <= 0) throw new ProviderError("Se alcanzó el máximo de consultas por ejecución; se sigue en la próxima tanda.", { retryable: true, status: -1 });
    budget.left--;
    const wait = last + minIntervalMs - Date.now();
    if (wait > 0) await sleep(Math.min(wait, 5000));
    last = Date.now();
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol)) throw new ProviderError("Solo se permiten direcciones http o https.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LIMITS.timeoutMs);
    let res;
    try {
      res = await fetchImpl(u.toString(), { ...init, signal: controller.signal, redirect: "follow" });
    } catch (err) {
      const why = controller.signal.aborted ? `no respondió en ${LIMITS.timeoutMs / 1000} s` : "no se pudo conectar";
      throw new ProviderError(redact(`El proveedor ${why} (${u.host}).`, secrets), { retryable: true });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      const hint = res.status === 401 || res.status === 403 ? " Revisá las credenciales." : res.status === 404 ? " Revisá la dirección o la ruta." : "";
      throw new ProviderError(redact(`El proveedor respondió ${res.status} en ${u.host}${u.pathname}.${hint}`, secrets), { retryable, status: res.status });
    }
    return res;
  };
}

export async function readJsonBody(res) {
  const text = await res.text();
  if (text.length > LIMITS.maxBodyBytes) throw new ProviderError("La respuesta del proveedor es demasiado grande.");
  try { return JSON.parse(text); } catch { throw new ProviderError("La respuesta del proveedor no es JSON válido."); }
}

// Lee un valor de un objeto con una ruta: "a.b", "a[0].b", "generos[].nombre" (lista),
// y alternativas separadas por "|": "release_date|first_air_date".
export function pick(obj, path) {
  if (!path) return undefined;
  let last;
  for (const alt of String(path).split("|")) {
    last = walk(obj, alt.trim().split(".").filter(Boolean));
    if (last !== undefined && last !== null && last !== "" && !(Array.isArray(last) && !last.length)) return last;
  }
  // Ninguna alternativa tiene datos: se devuelve lo que haya en la última (por ejemplo, una lista vacía).
  return last ?? undefined;
}

function walk(value, steps) {
  if (!steps.length) return value;
  const [step, ...rest] = steps;
  const m = /^([^[\]]*)(?:\[(\d*)\])?$/.exec(step);
  if (!m) return undefined;
  const [, key, index] = m;
  let v = key ? value?.[key] : value;
  if (index === undefined) return walk(v, rest);
  if (!Array.isArray(v)) return undefined;
  if (index === "") return v.map(x => walk(x, rest)).filter(x => x !== undefined && x !== null && x !== "");
  return walk(v[Number(index)], rest);
}

// ---------- normalización de lo que entrega un adaptador ----------
const str = (v, max) => (v == null ? "" : String(Array.isArray(v) ? v[0] ?? "" : v).trim().slice(0, max));

export function safeUrl(v, max = 1000) {
  const s = str(v, 2000);
  if (!s || s.length > max) return "";
  try {
    const u = new URL(s);
    return ["http:", "https:"].includes(u.protocol) ? u.toString() : "";
  } catch { return ""; }
}

export function yearOf(v) {
  const n = parseInt(String(v ?? "").slice(0, 4), 10);
  return n > 1800 && n < 2200 ? n : null;
}

export function tmdbOf(v) {
  const n = parseInt(v, 10);
  return n > 0 && n < 1e9 ? n : null;
}

export function imdbOf(v) {
  const s = str(v, 20);
  return /^tt\d{5,10}$/.test(s) ? s : null;
}

const TYPES = { hls: "application/x-mpegurl", m3u8: "application/x-mpegurl", "application/vnd.apple.mpegurl": "application/x-mpegurl", "application/x-mpegurl": "application/x-mpegurl",
  mp4: "video/mp4", "video/mp4": "video/mp4", webm: "video/webm", "video/webm": "video/webm", ogg: "video/ogg", "video/ogg": "video/ogg", embed: "embed", iframe: "embed", "": "" };

export function playbackType(v) {
  const k = str(v, 60).toLowerCase();
  return k in TYPES ? TYPES[k] : "";
}

// Fuente de reproducción: { url, type } directa, { lazy: true } si se pide al reproducir, o null.
export function normalizePlayback(raw) {
  if (!raw) return null;
  if (raw.lazy) return { lazy: true };
  const url = safeUrl(raw.url, 2000);
  return url ? { url, type: playbackType(raw.type) } : null;
}

const cleanData = d => {
  if (!d || typeof d !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(d).slice(0, 20)) {
    if (["string", "number", "boolean"].includes(typeof v)) out[String(k).slice(0, 40)] = typeof v === "string" ? v.slice(0, 500) : v;
  }
  return out;
};

export function normalizeTitle(raw, kinds) {
  if (!raw || typeof raw !== "object") return null;
  const externalId = str(raw.id, 200);
  const title = str(raw.title, 300);
  if (!externalId || !title || !kinds.includes(raw.kind)) return null;
  const categories = [...new Set([].concat(raw.categories || []).map(c => str(c, 40)).filter(Boolean))].slice(0, 10);
  const tmdb = tmdbOf(raw.tmdb);
  const rating = Number(raw.rating);
  return {
    externalId,
    kind: raw.kind,
    title,
    originalTitle: str(raw.originalTitle, 300),
    year: yearOf(raw.year),
    description: str(raw.description, 2000),
    poster: safeUrl(raw.poster),
    backdrop: safeUrl(raw.backdrop),
    categories,
    rating: rating > 0 && rating <= 10 ? Math.round(rating * 10) / 10 : null,
    tmdb,
    tmdbType: tmdb ? (raw.tmdbType === "movie" || raw.tmdbType === "tv" ? raw.tmdbType : raw.kind === "movie" ? "movie" : "tv") : null,
    imdb: imdbOf(raw.imdb),
    hasEpisodes: raw.kind === "series" || (raw.kind === "anime" && Boolean(raw.hasEpisodes)),
    playback: normalizePlayback(raw.playback),
    data: cleanData(raw.data)
  };
}

export function normalizeEpisode(raw) {
  if (!raw || typeof raw !== "object") return null;
  const externalId = str(raw.id, 200);
  const season = parseInt(raw.season, 10);
  const number = parseInt(raw.number, 10);
  if (!externalId || !(season >= 0 && season < 1000) || !(number > 0 && number < 100000)) return null;
  return {
    externalId,
    season,
    number,
    title: str(raw.title, 300),
    description: str(raw.description, 2000),
    still: safeUrl(raw.still),
    duration: Math.max(0, Math.min(86400, parseInt(raw.duration, 10) || 0)),
    playback: normalizePlayback(raw.playback),
    data: cleanData(raw.data)
  };
}

// Revisa la definición de un adaptador. Devuelve los problemas (vacío = válido).
export function validateAdapter(def) {
  const p = [];
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(def?.id || "")) p.push("id inválido");
  if (!def?.name) p.push("falta name");
  if (!Array.isArray(def?.fields)) p.push("fields debe ser una lista");
  if (typeof def?.listPage !== "function") p.push("falta listPage");
  if (typeof def?.test !== "function") p.push("falta test");
  return p;
}

export const secretFields = def => (def.fields || []).filter(f => f.secret).map(f => f.key);
