// Cliente de TMDb (The Movie Database): solo metadatos e imágenes, nunca video.
// Documentación oficial: https://developer.themoviedb.org/docs
// Acepta la clave v3 (api_key) o el token de lectura v4 (empieza con "eyJ").
import { cacheGet, cacheSet } from "../app/cache.js";

const API = "https://api.themoviedb.org/3";
export const IMG = "https://image.tmdb.org/t/p/";
const CACHE_DAYS = 14;

export class TmdbError extends Error {}

const image = (path, size) => (path ? `${IMG}${size}${path}` : "");

// Limpia el título para buscar: saca años y aclaraciones entre paréntesis o corchetes.
export function cleanTitle(title) {
  return String(title).replace(/\(.*?\)|\[.*?\]/g, " ").replace(/\s+/g, " ").trim();
}

export function buildRequest(path, params, key, language) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries({ language, ...params })) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  const headers = { accept: "application/json" };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  else url.searchParams.set("api_key", key);
  return { url: url.toString(), headers };
}

async function request(path, params, { key, language, fetchFn = fetch }, attempt = 0) {
  const { url, headers } = buildRequest(path, params, key, language);
  let res;
  try {
    res = await fetchFn(url, { headers });
  } catch {
    throw new TmdbError("No se pudo conectar con TMDb. Revisá la conexión a internet.");
  }
  if (res.status === 401) throw new TmdbError("TMDb rechazó la clave. Revisá que esté bien copiada.");
  if (res.status === 429 && attempt < 2) {
    await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
    return request(path, params, { key, language, fetchFn }, attempt + 1);
  }
  if (!res.ok) throw new TmdbError(`TMDb respondió con un error (${res.status}).`);
  return res.json();
}

export async function testKey(opts) {
  await request("/configuration", {}, opts);
  return true;
}

// Grupos de "Dónde verla", en el orden en que se muestran.
const WATCH_GROUPS = [["flatrate", "Incluida en suscripción"], ["free", "Gratis"], ["ads", "Gratis con anuncios"], ["rent", "Alquiler"], ["buy", "Compra"]];

// Plataformas legales donde está el título en un país (datos de JustWatch vía TMDb).
export function mapWatchProviders(data, region) {
  const r = data?.results?.[region];
  if (!r) return null;
  const groups = WATCH_GROUPS
    .map(([key, label]) => ({ label, providers: (r[key] || []).map(p => ({ name: p.provider_name, logo: image(p.logo_path, "w92") })) }))
    .filter(g => g.providers.length);
  return groups.length ? { link: r.link || "", groups } : null;
}

function mapDetails(d, type, region) {
  const isTv = type === "tv";
  return {
    tmdbId: d.id,
    type,
    title: isTv ? d.name : d.title,
    originalTitle: isTv ? d.original_name : d.original_title,
    description: d.overview || "",
    poster: image(d.poster_path, "w342"),
    backdrop: image(d.backdrop_path, "w1280"),
    rating: d.vote_count > 0 ? Math.round(d.vote_average * 10) / 10 : null,
    year: parseInt((isTv ? d.first_air_date : d.release_date) || "", 10) || null,
    genres: (d.genres || []).map(g => g.name),
    runtime: isTv ? (d.episode_run_time?.[0] || null) : (d.runtime || null),
    seasonCount: isTv ? d.number_of_seasons || null : null,
    cast: (d.credits?.cast || []).slice(0, 8).map(c => c.name),
    watch: region ? mapWatchProviders(d["watch/providers"], region) : null,
    attribution: "Información e imágenes de TMDb."
  };
}

// Busca un título del catálogo en TMDb. Devuelve los metadatos o null si no lo encuentra.
export async function lookup(item, opts) {
  const type = item.kind === "series" ? "tv" : "movie";
  const query = cleanTitle(item.title);
  const cacheKey = `tmdb:${opts.language}:${opts.region || ""}:${type}:${query.toLowerCase()}:${item.year || ""}`;
  const cached = await cacheGet(cacheKey);
  if (cached && Date.now() - cached.savedAt < CACHE_DAYS * 864e5) return cached.info;

  const yearParam = type === "tv" ? "first_air_date_year" : "year";
  let found = await request(`/search/${type}`, { query, [yearParam]: item.year || undefined, include_adult: "false" }, opts);
  if (!found.results?.length && item.year) found = await request(`/search/${type}`, { query, include_adult: "false" }, opts);
  const first = found.results?.[0];
  let info = null;
  if (first) {
    const details = await request(`/${type}/${first.id}`, { append_to_response: "credits,watch/providers" }, opts);
    info = mapDetails(details, type, opts.region);
  }
  await cacheSet(cacheKey, { info, savedAt: Date.now() });
  return info;
}

// Episodios de una temporada (para completar títulos, sinopsis e imágenes).
export async function seasonEpisodes(tvId, seasonNumber, opts) {
  const cacheKey = `tmdb:${opts.language}:season:${tvId}:${seasonNumber}`;
  const cached = await cacheGet(cacheKey);
  if (cached && Date.now() - cached.savedAt < CACHE_DAYS * 864e5) return cached.episodes;
  const d = await request(`/tv/${tvId}/season/${seasonNumber}`, {}, opts);
  const episodes = (d.episodes || []).map(ep => ({
    number: ep.episode_number,
    title: ep.name || "",
    description: ep.overview || "",
    still: image(ep.still_path, "w300"),
    duration: ep.runtime ? ep.runtime * 60 : 0
  }));
  await cacheSet(cacheKey, { episodes, savedAt: Date.now() });
  return episodes;
}
