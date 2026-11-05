// Detección automática ("modo simple" de Ajustes → Fuentes de contenido).
//
// El propietario pega la dirección de películas (y, si hay, la de series y la de episodios de una
// serie) tal como la usa con su API Key. El servidor pide la primera página y deduce:
//   - dónde va la clave (si está en la dirección, se saca de ahí; si no, prueba los lugares habituales),
//   - dónde está la lista de títulos y qué campo es cada dato (por el nombre del campo),
//   - cómo se pasa de página,
//   - la reproducción, si cada título trae su enlace (video directo o reproductor externo).
// Devuelve un formulario completo (el mismo de la configuración avanzada) para revisarlo y guardarlo.
// Nada de esto es específico de un proveedor: solo nombres de campo y formatos comunes.
import { pick, readJsonBody, normalizeTitle, normalizeEpisode, ProviderError } from "./contract.js";
import { compile } from "./configurable.js";
import { mapFields } from "./generic-http.js";

const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const isObj = v => v && typeof v === "object" && !Array.isArray(v);
const filled = v => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length);
const uniq = list => [...new Set(list.filter(Boolean))];

// ---------- dirección de ejemplo ----------
const PAGE_PARAMS = ["page", "p", "pagina", "pagenumber", "pageno", "pg", "pagenum"];
const SIZE_PARAMS = ["limit", "perpage", "pagesize", "size", "per", "rows", "take", "pp", "count"];
const OFFSET_PARAMS = ["offset", "skip", "start", "from"];
const CURSOR_PARAMS = ["cursor", "after", "pagetoken", "continuation", "nextcursor"];
const KEY_PARAMS = ["apikey", "key", "token", "accesstoken", "apitoken", "auth", "authkey", "secret", "clave", "password", "pass"];

export function parseExampleUrl(raw, apiKey = "") {
  const text = String(raw || "").trim();
  if (!text) return null;
  let u;
  try { u = new URL(text); } catch { throw new ProviderError(`"${text.slice(0, 80)}" no es una dirección válida. Pegala completa, empezando con https://`); }
  const local = ["localhost", "127.0.0.1"].includes(u.hostname);
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) throw new ProviderError("La dirección tiene que empezar con https://");
  if (u.username || u.password) throw new ProviderError("La dirección no puede llevar usuario ni contraseña.");
  const out = { origin: u.origin, path: decodeURIComponent(u.pathname) || "/", params: [], key: null };
  for (const [k, v] of u.searchParams) {
    const n = norm(k);
    if ((apiKey && v === apiKey) || (!out.key && KEY_PARAMS.includes(n))) out.key = { name: k, value: v };
    else if (!out.page && PAGE_PARAMS.includes(n)) out.page = { name: k, value: v };
    else if (!out.size && SIZE_PARAMS.includes(n)) out.size = { name: k, value: v };
    else if (!out.offset && OFFSET_PARAMS.includes(n)) out.offset = { name: k, value: v };
    else if (!out.cursor && CURSOR_PARAMS.includes(n)) out.cursor = { name: k, value: v };
    else out.params.push([k, v]);
  }
  return out;
}

// Dirección sin la clave (para mostrarla y guardarla).
export function cleanExampleUrl(raw, parsed) {
  if (!parsed) return "";
  const u = new URL(String(raw).trim());
  if (parsed.key) u.searchParams.delete(parsed.key.name);
  return decodeURIComponent(u.toString());
}

// ---------- lista de resultados ----------
// La lista "más grande" de objetos dentro de la respuesta (sin entrar en listas).
export function findList(json) {
  let best = null;
  const visit = (v, path, depth) => {
    if (depth > 5 || v == null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      const objs = v.filter(isObj);
      if (objs.length && objs.length >= v.length * 0.8) {
        const score = objs.length * 10 - depth;
        if (!best || score > best.score) best = { path, rows: objs, score };
      }
      return;
    }
    for (const [k, x] of Object.entries(v)) if (!/[.|[\]\s]/.test(k)) visit(x, path ? `${path}.${k}` : k, depth + 1);
  };
  visit(json, "", 0);
  return best && { path: best.path, rows: best.rows };
}

// ---------- campos ----------
// Rutas disponibles en los elementos: campos de primer nivel y de objetos anidados (a.b).
function pathsOf(rows) {
  const out = new Set();
  for (const row of rows.slice(0, 50)) {
    for (const [k, v] of Object.entries(row)) {
      if (/[.|[\]\s]/.test(k)) continue;
      out.add(k);
      if (isObj(v)) for (const k2 of Object.keys(v)) if (!/[.|[\]\s]/.test(k2)) out.add(`${k}.${k2}`);
    }
  }
  return [...out];
}

const ratio = (rows, path, ok = filled) => {
  const sample = rows.slice(0, 50);
  return sample.filter(r => { const v = pick(r, path); return filled(v) && ok(v); }).length / sample.length;
};

// Primer candidato (en orden de preferencia) con datos válidos en al menos `min` de los elementos.
function choose(rows, paths, candidates, ok = filled, min = 0.2) {
  for (const c of candidates) {
    const want = norm(c);
    for (const p of paths.filter(x => norm(x) === want)) {
      const r = ratio(rows, p, ok);
      if (r >= min) return { path: p, ratio: r };
    }
  }
  return null;
}

const isText = v => typeof v === "string" && v.trim() !== "";
const isIdValue = v => (typeof v === "string" && v.trim() !== "" && v.length <= 200) || (typeof v === "number" && Number.isFinite(v));
const isTmdb = v => /^\d{1,9}$/.test(String(v)) && Number(v) > 0;
const isImdb = v => /^tt\d{5,10}$/.test(String(v));
const isYearish = v => { const n = parseInt(String(v).slice(0, 4), 10); return n > 1800 && n < 2200; };
const isRating = v => Number(v) > 0 && Number(v) <= 10;
const isCount = v => Number.isFinite(Number(v)) && Number(v) >= 0;
const isHttp = v => typeof v === "string" && /^https?:\/\//i.test(v.trim());
const isImage = v => typeof v === "string" && (/^https?:\/\//i.test(v) || /^\//.test(v) || /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(v));

const CANDIDATES = {
  id: ["id", "_id", "uuid", "guid", "slug", "movie_id", "series_id", "show_id", "content_id", "video_id", "code", "key"],
  title: ["title", "name", "titulo", "nombre", "display_name", "label", "original_title", "original_name"],
  originalTitle: ["original_title", "original_name", "title_original", "titulo_original"],
  description: ["overview", "description", "plot", "synopsis", "sinopsis", "descripcion", "summary", "storyline", "desc"],
  poster: ["poster", "poster_path", "poster_url", "images.poster", "image", "image_url", "cover", "cover_url", "thumbnail", "thumb", "img", "picture", "artwork"],
  backdrop: ["backdrop", "backdrop_path", "backdrop_url", "images.backdrop", "fanart", "background", "background_image", "banner"],
  year: ["year", "release_year", "anio", "releaseyear"],
  releaseDate: ["release_date", "first_air_date", "released", "air_date", "premiere", "date", "fecha", "fecha_estreno"],
  tmdb: ["tmdb_id", "tmdb", "tmdbid", "themoviedb_id", "ids.tmdb"],
  imdb: ["imdb_id", "imdb", "imdbid", "ids.imdb"],
  rating: ["vote_average", "rating", "score", "tmdb_rating", "imdb_rating", "puntaje"],
  seasonsCount: ["number_of_seasons", "seasons_count", "total_seasons"],
  episodesCount: ["number_of_episodes", "episodes_count", "total_episodes"],
  updatedAt: ["updated_at", "updated", "modified", "last_updated", "modified_at"]
};
const CHECKS = { id: isIdValue, title: isText, originalTitle: isText, description: isText, poster: isImage, backdrop: isImage, year: isYearish,
  releaseDate: isYearish, tmdb: isTmdb, imdb: isImdb, rating: isRating, seasonsCount: isCount, episodesCount: isCount, updatedAt: isText };

function categoriesPath(rows, paths) {
  for (const c of ["genres", "genre", "categories", "category", "generos", "genero"]) {
    const p = paths.find(x => norm(x) === norm(c));
    if (!p) continue;
    const v = rows.map(r => pick(r, p)).find(filled);
    if (Array.isArray(v)) {
      if (v.every(x => typeof x === "string")) return p;
      const sub = ["name", "title", "nombre"].find(k => v.some(x => isObj(x) && isText(x[k])));
      if (sub) return `${p}[].${sub}`;
    } else if (isText(v)) return p;
  }
  return "";
}

// Campos de títulos de una lista. Devuelve { map: { campo: ruta }, idOk }.
export function detectTitleFields(rows) {
  const paths = pathsOf(rows);
  const map = {};
  for (const [field, list] of Object.entries(CANDIDATES)) {
    const found = choose(rows, paths, list, CHECKS[field], field === "id" ? 0.95 : 0.2);
    if (found) map[field] = found.path;
  }
  // Sin un ID propio en todos los títulos: TMDb o IMDb sirven de identificador.
  if (!map.id) {
    const alt = [map.tmdb && ratio(rows, map.tmdb, isTmdb) >= 0.95 && map.tmdb, map.imdb && ratio(rows, map.imdb, isImdb) >= 0.95 && map.imdb].find(Boolean);
    const loose = choose(rows, paths, CANDIDATES.id, isIdValue, 0.5);
    map.id = alt || [loose?.path, map.tmdb, map.imdb].filter(Boolean).join("|") || "";
  }
  if (map.title === map.originalTitle) delete map.originalTitle;
  const cats = categoriesPath(rows, paths);
  if (cats) map.categories = cats;
  return map;
}

// ---------- reproducción incluida en cada elemento ----------
const VIDEO_EXT = /\.(m3u8|mp4|webm|m4v|mov|ogg)(\?|#|$)/i;
const BAD_EXT = /\.(mkv|avi|wmv|flv|ts)(\?|#|$)/i;
const VIDEO_NAMES = ["hls", "m3u8", "mp4", "stream", "stream_url", "video", "video_url", "file", "file_url", "download_url", "download", "source", "src", "playback_url", "play_url", "url", "link", "video_link"];
const EMBED_NAMES = ["embed_url", "embed", "iframe", "iframe_url", "player", "player_url", "embed_link", "watch_url"];

export function detectPlayback(rows) {
  const paths = pathsOf(rows);
  const urlPaths = paths.filter(p => ratio(rows, p, isHttp) >= 0.3);
  const values = p => rows.map(r => pick(r, p)).filter(isHttp);
  const score = p => {
    const vals = values(p), n = norm(p.split(".").pop());
    const ext = vals.filter(v => VIDEO_EXT.test(v)).length / Math.max(1, vals.length);
    const named = VIDEO_NAMES.some(c => norm(c) === n) ? 1 : 0;
    const embed = EMBED_NAMES.some(c => norm(c) === n) || /embed|iframe|player/.test(n);
    return { p, vals, ext, named, embed, image: vals.every(v => /\.(jpe?g|png|webp|gif|avif|svg)(\?|$)/i.test(v)) };
  };
  const scored = urlPaths.map(score).filter(s => !s.image);
  const video = scored.filter(s => !s.embed && (s.ext >= 0.5 || s.named)).sort((a, b) => b.ext - a.ext || b.named - a.named)[0];
  const embed = scored.filter(s => s.embed).sort((a, b) => b.vals.length - a.vals.length)[0];
  if (video) {
    const exts = video.vals.map(v => (VIDEO_EXT.exec(v) || [])[1]?.toLowerCase()).filter(Boolean);
    const top = exts.sort((a, b) => exts.filter(x => x === b).length - exts.filter(x => x === a).length)[0] || "";
    const format = top === "m3u8" ? "hls" : ["mp4", "m4v", "mov"].includes(top) ? "mp4" : top === "webm" ? "webm" : "";
    const bad = video.vals.some(v => BAD_EXT.test(v));
    return { kind: "video", path: video.p, format, bad, alt: embed?.p || "" };
  }
  if (embed) return { kind: "embed", path: embed.p, origins: uniq(embed.vals.map(v => { try { return new URL(v).origin; } catch { return ""; } })).slice(0, 10) };
  return null;
}

// ---------- episodios ----------
const EP_CANDIDATES = {
  id: ["id", "_id", "episode_id", "uuid", "guid", "slug", "code"],
  season: ["season", "season_number", "temporada", "season_num", "seasonnumber", "s"],
  number: ["episode", "episode_number", "number", "ep", "episode_num", "capitulo", "num", "episodenumber", "e"],
  title: ["title", "name", "titulo", "nombre", "episode_title"],
  description: ["overview", "description", "plot", "synopsis", "sinopsis", "descripcion", "summary"],
  still: ["still", "still_path", "image", "thumbnail", "thumb", "poster", "cover", "img", "screenshot", "image_url"],
  duration: ["duration", "runtime", "length", "duracion"]
};
const isPositiveInt = v => /^\d{1,5}$/.test(String(v)) && Number(v) > 0;
const isSeason = v => /^\d{1,3}$/.test(String(v));
const EP_CHECKS = { id: isIdValue, season: isSeason, number: isPositiveInt, title: isText, description: isText, still: isImage, duration: v => /^\d+$/.test(String(v)) };

export function detectEpisodeFields(rows) {
  const paths = pathsOf(rows);
  const map = {}, notes = [];
  for (const [field, list] of Object.entries(EP_CANDIDATES)) {
    const found = choose(rows, paths, list, EP_CHECKS[field], field === "id" || field === "number" ? 0.9 : 0.2);
    if (found) map[field] = found.path;
  }
  if (map.duration) {
    const vals = rows.map(r => Number(pick(r, map.duration))).filter(n => n > 0).sort((a, b) => a - b);
    if (vals.length && vals[Math.floor(vals.length / 2)] < 300) { delete map.duration; notes.push("La duración de los episodios parece estar en minutos: no se usa (Supat la necesita en segundos)."); }
  }
  return { map, notes };
}

// ---------- paginación ----------
const META = {
  totalPages: ["total_pages", "last_page", "pages", "page_count", "num_pages", "total_page", "pages_total", "totalpages", "lastpage"],
  total: ["total", "total_results", "total_count", "count", "total_items", "total_records", "records_total", "totalresults", "totalcount"],
  next: ["next", "next_page_url", "next_page", "next_url", "next_link", "next_cursor", "cursor_next", "next_page_token", "next_token", "end_cursor", "nextpage"],
  current: ["page", "current_page", "page_number", "currentpage"],
  last: ["is_last", "is_last_page", "last"]
};
// Valores sueltos (no listas) de la respuesta, fuera de la lista de resultados.
function metaValues(json, listPath) {
  const out = [];
  const visit = (v, path, depth) => {
    if (depth > 3 || !isObj(v)) return;
    for (const [k, x] of Object.entries(v)) {
      if (/[.|[\]\s]/.test(k)) continue;
      const p = path ? `${path}.${k}` : k;
      if (p === listPath) continue;
      if (isObj(x)) visit(x, p, depth + 1);
      else if (!Array.isArray(x)) out.push([p, x]);
    }
  };
  visit(json, "", 0);
  return out;
}
function metaFind(values, names, ok) {
  for (const n of names) {
    const hit = values.filter(([p, v]) => norm(p.split(".").pop()) === norm(n) && ok(v)).sort((a, b) => a[0].split(".").length - b[0].split(".").length)[0];
    if (hit) return hit;
  }
  return null;
}

// Paginación deducida de la dirección y de la respuesta. probe(): pide la página 2 (si hace falta confirmarla).
export function detectPagination(json, listPath, rows, parsed) {
  const values = metaValues(json, listPath);
  const totalPages = metaFind(values, META.totalPages, v => isCount(v) && Number(v) >= 1 && typeof v !== "boolean");
  const total = metaFind(values, META.total, v => isCount(v) && Number(v) >= rows.length && typeof v !== "boolean");
  const next = metaFind(values, META.next, v => (typeof v === "string" && v.trim() !== "") || (typeof v === "number" && v > 0));
  const current = metaFind(values, META.current, v => isCount(v) && typeof v !== "boolean");
  const last = metaFind(values, META.last, v => typeof v === "boolean");
  const size = parsed.size ? { sizeParam: parsed.size.name, size: String(Number(parsed.size.value) || rows.length) } : { size: String(rows.length) };
  const common = { totalPagesPath: totalPages?.[0] || "", totalResultsPath: total?.[0] || "", lastPagePath: last?.[0] || "" };
  const nextIsLink = next && typeof next[1] === "string" && /^(https?:\/\/|\/|\?)/i.test(next[1]);
  if (parsed.offset) return { type: "offset", param: parsed.offset.name, ...size, ...common, how: `desplazamiento con "${parsed.offset.name}"` };
  if (parsed.cursor && next && !nextIsLink) return { type: "cursor", param: parsed.cursor.name, nextPath: next[0], ...size, how: `cursor "${parsed.cursor.name}" tomado de ${next[0]}` };
  if (parsed.page) return { type: "page", param: parsed.page.name, start: parsed.page.value === "0" ? "0" : "1", ...size, ...common, how: `número de página con "${parsed.page.name}"` };
  if (nextIsLink) return { type: "link", nextPath: next[0], ...size, how: `enlace a la página siguiente en ${next[0]}` };
  if (next && typeof next[1] === "number") return { type: "page", param: "page", start: "1", ...size, ...common, probe: true, how: 'número de página con "page"' };
  if (next) {
    const n = norm(next[0].split(".").pop());
    const param = n.includes("token") ? "page_token" : "cursor";
    return { type: "cursor", param, nextPath: next[0], ...size, guess: true, how: `cursor tomado de ${next[0]} (se manda como "${param}")` };
  }
  if (totalPages || total || current) return { type: "page", param: "page", start: current && Number(current[1]) === 0 ? "0" : "1", ...size, ...common, probe: true, how: 'número de página con "page"' };
  return { type: "none", probe: rows.length >= 10, how: "sin paginación (todo en una respuesta)" };
}

const fingerprint = rows => JSON.stringify(rows.slice(0, 3));

// ---------- detección completa ----------
// input: { displayName, movieUrl, seriesUrl, episodesUrl, apiKey, keyHeader }
// saved: { form, secrets } de la fuente (si ya existe). fetch: el fetch con límites (guardedFetch).
export async function detectSource(args) {
  const keys = [args.input?.apiKey, args.saved?.secrets?.apiKey, args.saved?.secrets?.token].map(k => String(k || "").trim()).filter(k => k.length >= 4);
  for (const raw of [args.input?.movieUrl, args.input?.seriesUrl, args.input?.episodesUrl]) {
    try { const p = parseExampleUrl(raw, keys[0] || ""); if (p?.key?.value?.length >= 4) keys.push(p.key.value); } catch { /* se informa abajo */ }
  }
  const hide = text => keys.reduce((t, k) => t.split(k).join("••••"), String(text));
  try {
    const out = await detect(args);
    return JSON.parse(hide(JSON.stringify(out)));
  } catch (err) {
    throw new ProviderError(hide(err?.message || "No se pudo detectar la configuración."), { status: err?.status || 0 });
  }
}

async function detect({ input, saved = {}, fetch }) {
  const warnings = [], notes = [];
  const savedForm = saved.form || {};
  const key = String(input.apiKey || "").trim() || saved.secrets?.apiKey || saved.secrets?.token || "";
  const urls = { movie: input.movieUrl, series: input.seriesUrl };
  const parsed = {};
  for (const [k, raw] of Object.entries(urls)) parsed[k] = parseExampleUrl(raw, key);
  if (!parsed.movie && !parsed.series) throw new ProviderError("Pegá al menos la dirección de películas o la de series.");
  const origins = uniq(Object.values(parsed).filter(Boolean).map(p => p.origin));
  if (origins.length > 1) throw new ProviderError("Las direcciones de películas y series tienen que ser del mismo servidor.");
  const origin = origins[0];
  const urlKey = Object.values(parsed).find(p => p?.key)?.key || null;
  const theKey = String(input.apiKey || "").trim() || urlKey?.value || key;

  // Dónde va la clave: la dirección manda; si no, el encabezado indicado; si no, se prueban los habituales.
  let authOptions;
  if (urlKey) authOptions = [{ in: "query", name: urlKey.name }];
  else if (!theKey) authOptions = [{ in: "none" }];
  else if (input.keyHeader) {
    const name = String(input.keyHeader).trim();
    authOptions = norm(name) === "authorization" ? [{ in: "header", name, prefix: "Bearer " }, { in: "header", name, prefix: "" }] : [{ in: "header", name, prefix: "" }];
  } else {
    authOptions = [
      savedForm.authType === "apiKeyHeader" && savedForm.apiKeyName && { in: "header", name: savedForm.apiKeyName, prefix: savedForm.apiKeyPrefix || "" },
      savedForm.authType === "apiKeyQuery" && savedForm.apiKeyName && { in: "query", name: savedForm.apiKeyName },
      { in: "header", name: "Authorization", prefix: "Bearer " }, { in: "header", name: "X-API-Key", prefix: "" },
      { in: "query", name: "api_key" }, { in: "query", name: "apikey" }, { in: "header", name: "apikey", prefix: "" },
      { in: "query", name: "key" }, { in: "header", name: "Authorization", prefix: "" }
    ].filter(Boolean);
  }
  const request = async (p, auth, extra = {}) => {
    const u = new URL(origin + p.path.replace(/[^/]+/g, s => encodeURIComponent(s)));
    for (const [k, v] of p.params) u.searchParams.set(k, v);
    for (const part of ["page", "size", "offset", "cursor"]) if (p[part] && !(part in extra)) u.searchParams.set(p[part].name, p[part].value);
    for (const [k, v] of Object.entries(extra)) if (v !== null) u.searchParams.set(k, v);
    const headers = { Accept: "application/json" };
    if (auth.in === "query") u.searchParams.set(auth.name, theKey);
    if (auth.in === "header") headers[auth.name] = `${auth.prefix || ""}${theKey}`;
    return readJsonBody(await fetch(u.toString(), { headers }));
  };

  // Primera respuesta (y lugar de la clave).
  const first = parsed.movie ? "movie" : "series";
  let auth = null, firstJson = null, lastErr = null;
  for (const option of authOptions) {
    try {
      const json = await request(parsed[first], option);
      if (findList(json)) { auth = option; firstJson = json; break; }
      lastErr = new ProviderError("La respuesta no trae ninguna lista de títulos.");
      if (authOptions.length === 1) break;
    } catch (err) {
      lastErr = err;
      if (![401, 403].includes(err.status)) break;
    }
  }
  if (!auth) throw lastErr || new ProviderError("No se pudo leer la dirección.");

  // Cada lista: resultados, campos y paginación.
  const lists = {};
  for (const kind of ["movie", "series"]) {
    if (!parsed[kind]) continue;
    const json = kind === first ? firstJson : await request(parsed[kind], auth);
    const list = findList(json);
    if (!list) { warnings.push(`La dirección de ${kind === "movie" ? "películas" : "series"} no trae una lista de títulos: no se usa.`); continue; }
    const paging = detectPagination(json, list.path, list.rows, parsed[kind]);
    if (paging.probe) {
      // Confirmar que la página 2 existe y es distinta (si no, todo viene en una respuesta).
      try {
        const page2 = findList(await request(parsed[kind], auth, { [paging.param || "page"]: String(Number(paging.start || 1) + 1) }));
        if (page2?.rows.length && fingerprint(page2.rows) !== fingerprint(list.rows)) Object.assign(paging, { type: "page", param: paging.param || "page", start: paging.start || "1", how: 'número de página con "page"' });
        else Object.assign(paging, { type: "none", how: "sin paginación (todo en una respuesta)" });
      } catch { Object.assign(paging, { type: "none", how: "sin paginación (todo en una respuesta)" }); }
    }
    if (paging.guess) warnings.push(`${kind === "movie" ? "Películas" : "Series"}: la paginación por cursor es una suposición; si la importación se corta en la primera página, revisala en la configuración avanzada.`);
    if (paging.type === "none" && list.rows.length >= 20 && list.rows.length % 10 === 0) warnings.push(`${kind === "movie" ? "Películas" : "Series"}: llegaron exactamente ${list.rows.length} títulos y no se encontró cómo pedir más. Si la API tiene más páginas, agregá el parámetro de página a la dirección (por ejemplo ?page=1).`);
    lists[kind] = { ...list, paging, fields: detectTitleFields(list.rows), playback: detectPlayback(list.rows), parsed: parsed[kind] };
  }
  if (!Object.keys(lists).length) throw new ProviderError("Ninguna dirección trae una lista de títulos.");

  // Episodios de una serie (dirección de ejemplo con el ID de una serie).
  let episodes = null;
  const epParsed = parseExampleUrl(input.episodesUrl, theKey);
  if (epParsed) {
    if (epParsed.origin !== origin) warnings.push("La dirección de episodios es de otro servidor: no se usa.");
    else if (!lists.series) warnings.push("Para los episodios hace falta también la dirección de series.");
    else {
      const seriesRows = lists.series.rows;
      const seriesPaths = pathsOf(seriesRows);
      const valueField = v => seriesPaths.find(p => seriesRows.some(r => String(pick(r, p) ?? "") === v));
      // ¿Qué parte de la dirección es la serie? {id} escrito a mano, o un valor que coincida con un campo de las series.
      const segs = epParsed.path.split("/");
      let where = null;
      if (epParsed.path.includes("{id}") || epParsed.params.some(([, v]) => v === "{id}")) where = { manual: true };
      else {
        for (let i = 0; i < segs.length && !where; i++) if (segs[i] && valueField(segs[i])) where = { seg: i, field: valueField(segs[i]), value: segs[i] };
        for (const [k, v] of epParsed.params) if (!where && v && valueField(v)) where = { param: k, field: valueField(v), value: v };
      }
      if (!where) warnings.push("No se encontró en la dirección de episodios el ID de ninguna serie de la primera página. Escribí {id} en el lugar del ID de la serie (por ejemplo /series/{id}/episodes) y volvé a detectar.");
      else {
        const concrete = { ...epParsed, path: epParsed.path, params: epParsed.params };
        let json = null;
        if (where.manual) {
          const sample = seriesRows.map(r => pick(r, lists.series.fields.id?.split("|")[0] || "id")).find(filled);
          concrete.path = epParsed.path.replace("{id}", String(sample ?? ""));
          concrete.params = epParsed.params.map(([k, v]) => [k, v === "{id}" ? String(sample ?? "") : v]);
        }
        try { json = await request(concrete, auth); } catch (err) { warnings.push(`Episodios: ${err.message}`); }
        const list = json && findList(json);
        if (json && !list) warnings.push("La dirección de episodios no trae una lista de episodios.");
        if (list) {
          const ep = detectEpisodeFields(list.rows);
          notes.push(...ep.notes);
          const epPlay = detectPlayback(list.rows);
          // Sin ID propio: el enlace del video (único por episodio) o, si no hay temporadas, el número.
          if (!ep.map.id && ep.map.number) {
            if (epPlay) { ep.map.id = epPlay.path; notes.push("Los episodios no traen un ID propio: se identifican por su enlace de video."); }
            else if (!ep.map.season) { ep.map.id = ep.map.number; notes.push("Los episodios no traen un ID propio: se identifican por su número."); }
          }
          if (!ep.map.id || !ep.map.number) warnings.push("En la lista de episodios no se encontraron el ID y el número de episodio: no se importan episodios.");
          else {
            const tplPath = where.seg !== undefined ? segs.map((s, i) => (i === where.seg ? "{id}" : s)).join("/") : epParsed.path;
            const tplParams = epParsed.params.map(([k, v]) => [k, k === where.param ? "{id}" : v]);
            if (/season|temporada/i.test(tplPath + JSON.stringify(tplParams)) && !ep.map.season) warnings.push("Los episodios parecen pedirse por temporada: la detección simple pide una sola temporada. Si faltan temporadas, configurá el endpoint de temporadas en la configuración avanzada.");
            episodes = { list, map: ep.map, path: tplPath, params: tplParams, idField: where.field, paging: detectPagination(json, list.path, list.rows, epParsed), playback: epPlay };
          }
        }
      }
    }
  }

  // ID compartido: el campo que usa la dirección de episodios manda para las series.
  const fieldUnion = field => uniq([
    field === "id" && episodes?.idField,
    ...["series", "movie"].map(k => lists[k]?.fields[field])
  ].flatMap(p => String(p || "").split("|"))).join("|");

  // ---------- formulario ----------
  const keep = ["internalName", "timeoutSec", "retryMax", "retryDelaySec", "minIntervalMs", "rate.windowSec", "rate.windowMax", "rate.honorRetryAfter", "rate.on429", "rate.maxWaitSec", "safety.removalPercent", "safety.removalMin"];
  const form = Object.fromEntries(keep.filter(k => k in savedForm).map(k => [k, savedForm[k]]));
  if (!("rate.honorRetryAfter" in form)) form["rate.honorRetryAfter"] = true;
  Object.assign(form, {
    displayName: String(input.displayName || savedForm.displayName || "").trim().slice(0, 60),
    baseUrl: origin, httpMethod: "GET", "page.type": "none",
    "simple.movieUrl": input.movieUrl ? cleanExampleUrl(input.movieUrl, parsed.movie) : "",
    "simple.seriesUrl": input.seriesUrl ? cleanExampleUrl(input.seriesUrl, parsed.series) : "",
    "simple.episodesUrl": input.episodesUrl && epParsed ? cleanExampleUrl(input.episodesUrl, epParsed) : ""
  });
  if (auth.in === "query") Object.assign(form, { authType: "apiKeyQuery", apiKeyName: auth.name });
  else if (auth.in === "header") Object.assign(form, { authType: "apiKeyHeader", apiKeyName: auth.name, apiKeyPrefix: auth.prefix || "" });
  else form.authType = "none";

  const kv = list => list.map(([k, v]) => `${k}=${v}`).join("\n");
  const endpoint = (key, p, list, paging) => {
    Object.assign(form, { [`${key}.path`]: p.path, [`${key}.items`]: list.path, [`${key}.params`]: kv(p.params), [`${key}.page.type`]: paging.type });
    if (paging.param) form[`${key}.page.param`] = paging.param;
    if (paging.sizeParam) form[`${key}.page.sizeParam`] = paging.sizeParam;
    if (paging.type !== "none" && paging.size) form[`${key}.page.size`] = paging.size;
    for (const [from, to] of [["nextPath", "nextPath"], ["totalPagesPath", "totalPagesPath"], ["totalResultsPath", "totalResultsPath"], ["lastPagePath", "lastPagePath"]]) if (paging[from]) form[`${key}.page.${to}`] = paging[from];
    if (paging.start) form["page.start"] = paging.start;
  };
  for (const kind of ["movie", "series"]) {
    if (!lists[kind]) continue;
    form[`cat.${kind}`] = true;
    endpoint(`ep.${kind}`, lists[kind].parsed, lists[kind], lists[kind].paging);
  }
  for (const field of Object.keys(CANDIDATES).concat("categories")) {
    const path = fieldUnion(field);
    if (path) form[`map.${field}`] = path;
  }
  if (form["map.year"] && form["map.releaseDate"] === form["map.year"]) delete form["map.releaseDate"];

  // Imágenes con ruta relativa: si los títulos tienen TMDb y las rutas tienen su formato, son de TMDb.
  for (const [field, size] of [["poster", "w500"], ["backdrop", "w1280"]]) {
    const path = form[`map.${field}`];
    if (!path) continue;
    const vals = Object.values(lists).flatMap(l => l.rows.map(r => pick(r, path.split("|")[0]))).filter(isText);
    const relative = vals.filter(v => !/^https?:/i.test(v));
    if (relative.length / Math.max(1, vals.length) < 0.5) continue;
    if (form["map.tmdb"] && relative.every(v => /^\/[A-Za-z0-9_-]+\.(jpe?g|png|webp)$/.test(v))) {
      form[`img.${field}Prefix`] = `https://image.tmdb.org/t/p/${size}`;
      notes.push(`Las imágenes (${field === "poster" ? "pósters" : "fondos"}) vienen como rutas de TMDb: se completan con la dirección de imágenes de TMDb.`);
    } else if (relative.every(v => v.startsWith("/"))) {
      form[`img.${field}Prefix`] = origin;
      warnings.push(`Las imágenes (${field === "poster" ? "pósters" : "fondos"}) vienen sin dominio: se usa el de la API. Si no se ven, corregí el prefijo en la configuración avanzada.`);
    } else warnings.push(`Las imágenes (${field === "poster" ? "pósters" : "fondos"}) vienen sin dirección completa y no se pudo deducir el dominio.`);
  }

  // Reproducción: el enlace de cada título (si lo trae).
  const play = lists.movie?.playback || lists.series?.playback || episodes?.playback;
  let playText = "No se encontró un enlace de video en los títulos: la reproducción queda para la configuración avanzada.";
  if (play) {
    form["play.mode"] = "direct";
    const titlePlay = lists.movie?.playback || lists.series?.playback;
    if (titlePlay?.kind === play.kind) form["map.playbackUrl"] = uniq(["movie", "series"].map(k => lists[k]?.playback?.kind === play.kind && lists[k].playback.path)).join("|");
    if (episodes?.playback?.kind === play.kind) form["epmap.playbackUrl"] = episodes.playback.path;
    if (play.kind === "video") {
      Object.assign(form, { "play.contentType": "video", "play.format": play.format || "" });
      playText = `Video directo desde el campo "${play.path}"${play.format ? ` (${play.format.toUpperCase()})` : ""}.`;
      if (play.bad) warnings.push("Algunos videos tienen un formato (por ejemplo .mkv) que los navegadores en general no reproducen.");
      if (play.alt) notes.push(`También hay un reproductor externo en "${play.alt}"; se usa el video directo.`);
    } else {
      Object.assign(form, { "play.contentType": "embed", "play.domains": play.origins.join("\n") });
      playText = `Reproductor externo (página con su propio reproductor) desde el campo "${play.path}". Dominios permitidos: ${play.origins.join(", ")}.`;
      warnings.push("La reproducción usa el reproductor externo de la fuente (se muestra dentro de Supat). Si algún título usa otro dominio, agregalo en la configuración avanzada.");
    }
  } else warnings.push(playText);

  if (episodes) {
    form["cat.episodes"] = true;
    endpoint("ep.episodes", { path: episodes.path, params: episodes.params }, episodes.list, episodes.paging);
    for (const [field, path] of Object.entries(episodes.map)) form[`epmap.${field}`] = path;
  }

  // ---------- verificación con el código real de importación ----------
  const spec = compile({ form });
  const check = {};
  const coverage = {};
  for (const kind of Object.keys(lists)) {
    const ep = spec.catalog[kind];
    const mapped = lists[kind].rows.map(row => {
      const m = mapFields(row, ep.map, ep.prefix);
      return { ...m, kind, id: m.id == null || m.id === "" ? "" : `${kind}:${m.id}` };
    });
    const valid = mapped.map(i => normalizeTitle(i, [kind])).filter(Boolean);
    check[kind] = { received: mapped.length, valid: valid.length, samples: valid.slice(0, 3).map(t => t.title) };
    const has = f => valid.filter(t => (Array.isArray(t[f]) ? t[f].length : t[f])).length;
    coverage[kind] = { titulo: has("title"), anio: has("year"), poster: has("poster"), fondo: has("backdrop"), sinopsis: has("description"), tmdb: has("tmdb"), imdb: has("imdb"), video: valid.filter(t => t.playback?.url).length };
  }
  if (episodes && spec.episodes) {
    const mapped = episodes.list.rows.map(row => mapFields(row, spec.episodes.map, spec.episodes.prefix)).map(m => ({ ...m, season: m.season ?? 1 }));
    const valid = mapped.map(normalizeEpisode).filter(Boolean);
    check.episodes = { received: mapped.length, valid: valid.length, samples: valid.slice(0, 3).map(e => `T${e.season} E${e.number}${e.title ? ` · ${e.title}` : ""}`) };
  }
  for (const [kind, c] of Object.entries(check)) {
    if (!c.valid) warnings.push(`${{ movie: "Películas", series: "Series", episodes: "Episodios" }[kind]}: ningún registro quedó válido con lo detectado. Revisá la configuración avanzada.`);
  }

  const labels = { id: "ID", title: "Título", originalTitle: "Título original", description: "Sinopsis", poster: "Póster", backdrop: "Fondo", year: "Año", releaseDate: "Fecha de estreno",
    tmdb: "TMDb", imdb: "IMDb", rating: "Puntaje", categories: "Géneros", seasonsCount: "Temporadas", episodesCount: "Episodios", updatedAt: "Actualización" };
  return {
    form,
    keyParam: urlKey?.name || "",
    report: {
      auth: auth.in === "query" ? `La clave va en el parámetro "${auth.name}".` : auth.in === "header" ? `La clave va en el encabezado "${auth.name}"${auth.prefix ? ` (con "${auth.prefix.trim()}")` : ""}.` : "Sin clave.",
      lists: Object.fromEntries(Object.entries(lists).map(([k, l]) => [k, { path: l.path || "(la respuesta es la lista)", paging: l.paging.how }])),
      fields: Object.entries(labels).filter(([f]) => form[`map.${f}`]).map(([f, label]) => ({ label, path: form[`map.${f}`] })),
      episodes: episodes ? { path: episodes.path, fields: Object.entries(episodes.map).map(([f, p]) => `${f}: ${p}`) } : null,
      playback: playText,
      check, coverage
    },
    warnings: uniq(warnings), notes: uniq(notes)
  };
}
