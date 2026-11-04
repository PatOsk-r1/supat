// Adaptador genérico para APIs HTTP que responden JSON. No está atado a ningún servicio:
// todo (rutas, paginación, autenticación y qué campo es cada dato) se describe en la
// "especificación" que carga el propietario. Formato completo en worker/README.md.
import { ProviderError, pick, readJsonBody, KINDS, playbackType } from "./contract.js";

// Credenciales de acceso a la API (catálogo, temporadas, episodios): solo en "auth".
const API_SECRETS = ["apiKey", "token", "username", "password"];
// Encabezados y parámetros de autenticación personalizados (Ajustes): authHeader_0, authParam_0, …
const isCustomApiSecret = name => /^auth(Header|Param)_\d{1,2}$/.test(name);
// Credencial de reproducción: solo en "playbackAuth", que se usa ÚNICAMENTE al pedir la fuente
// (resolve / resolveEpisode). Nunca se manda en las consultas del catálogo.
const PLAYBACK_SECRETS = ["playbackKey"];
const SECRET_KEYS = [...API_SECRETS, ...PLAYBACK_SECRETS];
// Categorías que se pueden importar (Ajustes → Fuentes de contenido).
export const CATEGORIES = ["movie", "series", "anime", "episodes"];
const PAGINATION = ["none", "page", "offset", "cursor", "link"];
const MAX_PAGES = 100000;

// Reemplaza {nombre} con valores. Las credenciales solo se aceptan en "auth".
function render(template, vars) {
  return String(template).replace(/\{([a-zA-Z0-9_.]+)\}/g, (_, name) => {
    const v = name.startsWith("data.") ? vars.data?.[name.slice(5)] : vars[name];
    return v == null ? "" : String(v);
  });
}
const placeholders = t => [...String(t).matchAll(/\{([a-zA-Z0-9_.]+)\}/g)].map(m => m[1]);

export function categoriesOf(config) {
  const list = String(config.categories ?? "").split(",").map(s => s.trim()).filter(c => CATEGORIES.includes(c));
  return list.length ? list : [...CATEGORIES];
}

function parseSpec(config) {
  if (config.spec && typeof config.spec === "object") return config.spec;
  try { return JSON.parse(config.spec || "{}"); }
  catch { throw new ProviderError("La especificación no es JSON válido."); }
}

function endpointProblems(ep, where) {
  const p = [];
  if (!ep || typeof ep !== "object") return [`${where}: falta la definición.`];
  if (typeof ep.path !== "string" || !ep.path.startsWith("/")) p.push(`${where}: "path" debe empezar con "/" (es relativo a la dirección base).`);
  if (ep.method && !["GET", "POST"].includes(ep.method)) p.push(`${where}: "method" solo puede ser GET o POST.`);
  const templates = [ep.path, ...Object.values(ep.query || {}), ...Object.values(ep.body || {})];
  for (const name of templates.flatMap(placeholders)) {
    if (SECRET_KEYS.includes(name) || isCustomApiSecret(name)) p.push(`${where}: las credenciales ({${name}}) solo pueden ir en "auth" o "playbackAuth".`);
  }
  if (ep.pagination && !PAGINATION.includes(ep.pagination.type)) p.push(`${where}: paginación desconocida (usar ${PAGINATION.join(", ")}).`);
  if (ep.pagination?.type === "cursor" && !ep.pagination.next) p.push(`${where}: la paginación por cursor necesita "next".`);
  if (ep.pagination?.type === "link" && !ep.pagination.next) p.push(`${where}: la paginación por enlace necesita "next".`);
  return p;
}

export function specProblems(spec) {
  const p = [];
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return ["La especificación debe ser un objeto JSON."];
  const catalog = spec.catalog || {};
  const kinds = Object.keys(catalog);
  if (!kinds.length) p.push('Falta "catalog" con al menos un tipo (movie, series, anime o live).');
  for (const k of kinds) {
    if (!KINDS.includes(k)) p.push(`Tipo desconocido en "catalog": ${k}.`);
    p.push(...endpointProblems(catalog[k], `catalog.${k}`));
    if (!catalog[k]?.map?.id || !catalog[k]?.map?.title) p.push(`catalog.${k}: "map" necesita al menos "id" y "title".`);
  }
  if (spec.seasons) p.push(...endpointProblems(spec.seasons, "seasons"));
  if (spec.episodes) {
    p.push(...endpointProblems(spec.episodes, "episodes"));
    if (!spec.episodes.map?.id || !spec.episodes.map?.number) p.push('episodes: "map" necesita al menos "id" y "number".');
  }
  for (const key of ["resolve", "resolveEpisode", "test"]) if (spec[key]) p.push(...endpointProblems(spec[key], key));
  for (const key of ["resolve", "resolveEpisode"]) if (spec[key] && !spec[key].url) p.push(`${key}: falta "url" (ruta al campo con la dirección).`);
  for (const [key, allowed, other] of [["auth", API_SECRETS, PLAYBACK_SECRETS], ["playbackAuth", PLAYBACK_SECRETS, API_SECRETS]]) {
    for (const a of [].concat(spec[key] || [])) {
      const kinds = key === "auth" ? ["header", "query", "basic"] : ["header", "query", "body"];
      if (!kinds.includes(a?.in)) p.push(`Cada entrada de "${key}" necesita "in": ${kinds.join(", ")}.`);
      if (a?.in !== "basic" && (!a?.name || typeof a.value !== "string")) p.push(`Las entradas de "${key}" necesitan "name" y "value".`);
      for (const name of placeholders(a?.value || "")) {
        if (other.includes(name)) p.push(key === "auth"
          ? `"auth" no puede usar {${name}}: la credencial de reproducción va solo en "playbackAuth".`
          : `"playbackAuth" no puede usar {${name}}: ahí solo va la credencial de reproducción ({playbackKey}).`);
        else if (!allowed.includes(name) && !(key === "auth" && isCustomApiSecret(name))) p.push(`"${key}" usa {${name}}, que no es una credencial conocida.`);
      }
    }
  }
  if (spec.playbackAuth && !spec.resolve && !spec.resolveEpisode) p.push('"playbackAuth" necesita "resolve" o "resolveEpisode" (es lo único que la usa).');
  for (const origin of [].concat(spec.embedOrigins || [])) {
    try { const u = new URL(origin); if (u.protocol !== "https:" || u.origin !== origin) throw new Error(); }
    catch { p.push(`Origen de reproductor externo inválido: ${origin} (usar "https://dominio").`); }
  }
  return p;
}

function base(config) {
  let u;
  try { u = new URL(String(config.baseUrl || "").trim()); } catch { throw new ProviderError("La dirección base no es válida."); }
  return u;
}

// Arma la consulta: dirección, encabezados y cuerpo, con la autenticación de la especificación.
// `link`: ruta + consulta de la página siguiente que dio el propio proveedor (paginación "link").
function buildRequest(ctx, spec, ep, vars, link = "", { playback = false, baseUrl = null } = {}) {
  const root = base(baseUrl ? { baseUrl } : ctx.config);
  const prefix = root.pathname.replace(/\/$/, "");
  const url = new URL(link ? root.origin + link : root.origin + prefix + render(ep.path, vars));
  if (url.origin !== root.origin) throw new ProviderError("La ruta apunta fuera de la dirección base.");
  if (!link) for (const [k, t] of Object.entries(ep.query || {})) {
    const value = render(t, vars);
    if (value !== "" || !placeholders(t).length) url.searchParams.set(k, value);
  }
  const headers = { Accept: "application/json", ...(spec.headers || {}), ...(ep.headers || {}) };
  const body = init => (init.method === "POST" && ep.body ? Object.fromEntries(Object.entries(ep.body).map(([k, t]) => [k, render(t, vars)])) : null);
  const init = { method: ep.method || "GET", headers };
  let json = body(init);
  // Cada credencial solo llega a las consultas que le corresponden.
  const only = keys => Object.fromEntries(keys.map(k => [k, ctx.secrets[k]]));
  const apiSecrets = () => ({ ...only(API_SECRETS), ...Object.fromEntries(Object.entries(ctx.secrets || {}).filter(([k]) => isCustomApiSecret(k))) });
  const apply = (entries, secrets) => {
    for (const a of [].concat(entries || [])) {
      if (a.in === "basic") { headers.Authorization = `Basic ${btoa(`${secrets.username || ""}:${secrets.password || ""}`)}`; continue; }
      const value = render(a.value, secrets);
      if (a.in === "header") headers[a.name] = value;
      else if (a.in === "body") { json = { ...(json || {}), [a.name]: value }; init.method = "POST"; }
      else url.searchParams.set(a.name, value);
    }
  };
  apply(spec.auth, apiSecrets());
  if (playback) apply(spec.playbackAuth, only(PLAYBACK_SECRETS));
  if (json) {
    init.body = JSON.stringify(json);
    headers["Content-Type"] = "application/json";
  }
  return { url, init };
}

export async function callEndpoint(ctx, spec, ep, vars, opts = {}) {
  return call(ctx, spec, ep, vars, "", opts);
}
export { render, placeholders, mapFields, rowsOf, sinceValue };

async function call(ctx, spec, ep, vars, link = "", opts) {
  const { url, init } = buildRequest(ctx, spec, ep, vars, link, opts);
  return readJsonBody(await ctx.fetch(url.toString(), init));
}

function sinceValue(since, format) {
  if (!since) return "";
  if (format === "unix") return String(Math.floor(since / 1000));
  if (format === "unixms") return String(since);
  if (format === "date") return new Date(since).toISOString().slice(0, 10);
  return new Date(since).toISOString();
}

// Variables de paginación para la consulta y cursor siguiente según la respuesta.
function pageVars(ep, cursor) {
  const pg = ep.pagination || { type: "none" };
  const limit = Number(pg.limit) || 50;
  if (pg.type === "page") return { page: cursor?.page ?? (Number(pg.start) || 1), limit };
  if (pg.type === "offset") return { offset: cursor?.offset ?? 0, limit };
  if (pg.type === "cursor") return { cursor: cursor?.cursor ?? "", limit };
  return { limit };
}

// Huella corta de una página: si la API ignora el parámetro de página y devuelve siempre lo mismo,
// la importación se corta en vez de pedir páginas para siempre.
function pageFingerprint(rows) {
  const text = JSON.stringify(rows);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return `${rows.length}:${h.toString(36)}`;
}

function nextCursor(ep, cursor, data, count, root, rows = null) {
  const next = nextCursorRaw(ep, cursor, data, count, root);
  if (!next || !rows) return next;
  const fp = pageFingerprint(rows);
  if (cursor?.fp && cursor.fp === fp) return null; // misma página otra vez
  return { ...next, fp };
}

function nextCursorRaw(ep, cursor, data, count, root) {
  const pg = ep.pagination || { type: "none" };
  if (pg.type === "none" || !count) return null;
  if ((cursor?.n || 0) + 1 >= MAX_PAGES) return null;
  // Indicador de última página que da la propia fuente.
  if (pg.lastPage) {
    const last = pick(data, pg.lastPage);
    if (last === true || last === 1 || last === "true" || last === "1") return null;
  }
  const n = (cursor?.n || 0) + 1;
  if (pg.type === "page") {
    const page = cursor?.page ?? (Number(pg.start) || 1);
    let total = Number(pick(data, pg.totalPages));
    // Sin total de páginas, pero con total de resultados y tamaño de página: se calcula.
    if (!total && pg.total && Number(pg.limit)) total = Math.ceil(Number(pick(data, pg.total)) / Number(pg.limit));
    if (total && page >= total) return null;
    return { page: page + 1, n };
  }
  if (pg.type === "offset") {
    const limit = Number(pg.limit) || 50;
    const offset = (cursor?.offset ?? 0) + count;
    const total = Number(pick(data, pg.total));
    if ((total && offset >= total) || count < limit) return null;
    return { offset, n };
  }
  const next = pick(data, pg.next);
  if (!next) return null;
  if (pg.type === "cursor") return { cursor: String(next).slice(0, 500), n };
  // "link": dirección de la página siguiente; tiene que ser del mismo servidor.
  let u;
  try { u = new URL(String(next), root); } catch { return null; }
  if (u.origin !== root.origin) throw new ProviderError("La página siguiente apunta a otro servidor; se detuvo la importación.");
  return { link: u.pathname + u.search, n };
}

function mapFields(row, map, prefixes = {}) {
  const out = { data: {}, playback: {} };
  for (const [key, path] of Object.entries(map || {})) {
    let value = key.startsWith("=") ? path : pick(row, path);
    const name = key.replace(/^=/, "");
    if (value !== undefined && prefixes[name] && typeof value === "string" && !/^https?:/i.test(value)) value = prefixes[name] + value;
    if (name.startsWith("data.")) out.data[name.slice(5)] = value;
    else if (name.startsWith("playback.")) out.playback[name.slice(9)] = value;
    else out[name] = value;
  }
  return out;
}

const rowsOf = (data, path) => {
  const rows = path ? pick(data, path) : data;
  if (!Array.isArray(rows)) throw new ProviderError(`La respuesta no tiene una lista en "${path || "(raíz)"}".`);
  return rows;
};

export default {
  id: "http-json",
  name: "API HTTP genérica (JSON)",
  description: "Cualquier API que responda JSON. Se describe con una especificación: rutas, paginación, autenticación y qué campo es cada dato.",
  kindsFor(config) {
    const enabled = categoriesOf(config);
    try { return Object.keys(parseSpec(config).catalog || {}).filter(k => KINDS.includes(k) && (k === "live" || enabled.includes(k))); } catch { return []; }
  },
  // ¿Se importan temporadas y episodios? (la especificación los define y la categoría está activa)
  episodesEnabled(config) {
    try { return Boolean(parseSpec(config).episodes) && categoriesOf(config).includes("episodes"); } catch { return false; }
  },
  kinds: KINDS,
  fields: [
    { key: "baseUrl", label: "Dirección base de la API", type: "url", required: true, help: "Por ejemplo https://api.proveedor.com/v1" },
    { key: "spec", label: "Especificación (JSON)", type: "json", required: true, help: "Rutas, paginación, autenticación y correspondencia de campos. Ver worker/README.md." },
    { key: "apiKey", label: "Clave de API", type: "password", secret: true, help: "Se usa donde la especificación diga {apiKey}." },
    { key: "token", label: "Token", type: "password", secret: true, help: "Se usa donde la especificación diga {token}." },
    { key: "username", label: "Usuario", type: "password", secret: true, help: "Para autenticación básica o {username}." },
    { key: "password", label: "Contraseña", type: "password", secret: true, help: "Para autenticación básica o {password}." },
    { key: "playbackKey", label: "Credencial de reproducción", type: "password", secret: true, help: "Solo para pedir los enlaces de reproducción ({playbackKey} en \"playbackAuth\")." },
    { key: "categories", label: "Categorías", type: "text", help: "movie, series, anime y episodes, separadas por coma. Vacío = todas." }
  ],
  validate(config) {
    const p = [];
    try {
      const u = new URL(String(config.baseUrl || ""));
      const local = ["localhost", "127.0.0.1"].includes(u.hostname);
      if (u.protocol !== "https:" && !(local && u.protocol === "http:")) p.push("La dirección base tiene que ser https.");
      if (u.username || u.password || u.search) p.push("La dirección base no puede llevar usuario, contraseña ni parámetros: usá \"auth\" en la especificación.");
    } catch { p.push("La dirección base no es válida."); }
    let spec;
    try { spec = parseSpec(config); } catch (err) { return [...p, err.message]; }
    return [...p, ...specProblems(spec)];
  },
  supportsIncremental(config) {
    try {
      return Object.values(parseSpec(config).catalog || {}).some(ep => [ep.path, ...Object.values(ep.query || {})].some(t => placeholders(t).includes("since")));
    } catch { return false; }
  },
  embedOrigins(config) {
    try { return [].concat(parseSpec(config).embedOrigins || []); } catch { return []; }
  },

  async test(ctx) {
    const spec = parseSpec(ctx.config);
    if (spec.test) {
      await call(ctx, spec, spec.test, {});
      return { message: "Conexión correcta." };
    }
    const [kind] = Object.keys(spec.catalog);
    const page = await this.listPage(ctx, { kind, cursor: null, since: null });
    return { message: `Conexión correcta: ${page.items.length} título(s) en la primera página de "${kind}".`, sample: page.items.slice(0, 3).map(i => i.title) };
  },

  async listPage(ctx, { kind, cursor, since }) {
    const spec = parseSpec(ctx.config);
    const ep = spec.catalog?.[kind];
    if (!ep) return { items: [], next: null };
    const vars = { ...pageVars(ep, cursor), since: sinceValue(since, ep.sinceFormat) };
    const root = base(ctx.config);
    const data = await call(ctx, spec, ep, vars, cursor?.link || "");
    const rows = rowsOf(data, ep.items);
    const lazy = Boolean(kind === "movie" || kind === "live" || kind === "anime" ? spec.resolve : false);
    const items = rows.map(row => {
      const m = mapFields(row, ep.map, ep.prefix);
      const playback = m.playback.url ? { url: m.playback.url, type: m.playback.type ?? ep.playbackType ?? "" } : lazy ? { lazy: true } : null;
      const hasEpisodes = kind === "series" || (kind === "anime" && Boolean(spec.episodes) && (m.hasEpisodes ?? !playback));
      return { ...m, kind, playback, hasEpisodes, data: { ...m.data, id: m.data.id ?? m.id } };
    });
    const next = nextCursor(ep, cursor, data, rows.length, root, rows);
    // El enlace siguiente se guarda en la base: se le quitan los parámetros de autenticación
    // (se vuelven a agregar al pedirlo).
    if (next?.link) {
      const u = new URL(root.origin + next.link);
      for (const a of [].concat(spec.auth || [])) if (a.in === "query") u.searchParams.delete(a.name);
      next.link = u.pathname + u.search;
    }
    return { items, next };
  },

  // Episodios de una serie. Si la especificación tiene "seasons", primero pide las temporadas
  // y después los episodios de cada una ({season} en la ruta).
  async listEpisodes(ctx, { source, cursor }) {
    const spec = parseSpec(ctx.config);
    if (!spec.episodes) return { episodes: [], next: null };
    const vars0 = { id: source.externalId, data: source.data || {} };
    let state = cursor || {};
    if (spec.seasons && !state.seasons) {
      const rows = rowsOf(await call(ctx, spec, spec.seasons, vars0), spec.seasons.items);
      const seasons = rows.map(r => Number(pick(r, spec.seasons.map?.number || "season_number"))).filter(n => n >= 0).slice(0, 200);
      if (!seasons.length) return { episodes: [], next: null };
      state = { seasons, si: 0 };
    }
    const season = state.seasons ? state.seasons[state.si] : undefined;
    const ep = spec.episodes;
    const vars = { ...vars0, ...pageVars(ep, state.page), season: season ?? "" };
    const data = await call(ctx, spec, ep, vars);
    const rows = rowsOf(data, ep.items);
    const episodes = rows.map(row => {
      const m = mapFields(row, ep.map, ep.prefix);
      const playback = m.playback.url ? { url: m.playback.url, type: m.playback.type ?? ep.playbackType ?? "" } : spec.resolveEpisode ? { lazy: true } : null;
      return { ...m, season: m.season ?? season ?? ep.defaultSeason ?? 1, playback, data: { ...m.data, id: m.data.id ?? m.id } };
    });
    const nextPage = nextCursor(ep, state.page, data, rows.length, base(ctx.config), rows);
    let next = null;
    if (nextPage) next = { ...state, page: nextPage };
    else if (state.seasons && state.si + 1 < state.seasons.length) next = { seasons: state.seasons, si: state.si + 1 };
    return { episodes, next };
  },

  async resolve(ctx, { source, episode }) {
    const spec = parseSpec(ctx.config);
    const ep = episode ? spec.resolveEpisode : spec.resolve;
    if (!ep) throw new ProviderError("Este proveedor no indica cómo obtener la fuente de reproducción.");
    const target = episode || source;
    const vars = { id: target.externalId, data: target.data || {}, seriesId: source?.externalId ?? "", season: episode?.season ?? "", number: episode?.number ?? "" };
    if (episode) vars.data = { ...(source?.data || {}), ...(episode.data || {}) };
    const data = await call(ctx, spec, ep, vars, "", { playback: true });
    const url = pick(data, ep.url);
    if (!url) throw new ProviderError("El proveedor no devolvió una dirección de reproducción.");
    return { url: String(url), type: playbackType(ep.type ? pick(data, ep.type) ?? ep.typeValue : ep.typeValue ?? "") };
  }
};
