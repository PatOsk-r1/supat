// Adaptador configurable: Fuente A y Fuente B se configuran desde Ajustes (sin tocar código).
// Traduce el formulario (src/shared/fuente-esquema.js) a la especificación del motor genérico
// (generic-http.js), que hace las consultas, la paginación y el mapeo. Es la capa de normalización:
// cada fuente tiene su propio mapeo, así que no hace falta que las dos APIs se parezcan.
// La reproducción la arma este archivo (plantilla, endpoint o URL directa del catálogo).
import generic, { callEndpoint, render, placeholders } from "./generic-http.js";
import { ProviderError, pick, playbackType, safeUrl } from "./contract.js";
import { parseKv, parseList, missingToActivate } from "../../../src/shared/fuente-esquema.js";

const KINDS = ["movie", "series", "anime"];
const clamp = (v, min, max, def) => {
  const n = Number(v);
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? Math.min(max, Math.max(min, n)) : def;
};
const str = v => String(v ?? "").trim();
const formOf = config => (config && typeof config.form === "object" && config.form) || {};

// IDs guardados con "espacio de nombres", para que no choquen:
//   títulos: "<tipo>:<id>"  (una película y una serie pueden tener el mismo id en la fuente);
//   episodios: "<id de la serie guardado>/<id>"  (muchas fuentes repiten "1", "2"… en cada serie).
// El ID ORIGINAL de la fuente queda en data.id y es el que se usa en rutas y plantillas.
const rawId = src => (src?.data?.id !== undefined && src.data.id !== null && src.data.id !== "" ? String(src.data.id) : String(src?.externalId ?? "").replace(/^[a-z]+:/, ""));

// Credenciales personalizadas ("Nombre=valor" por línea) → authHeader_0, authParam_0, …
export function expandSecrets(secrets = {}) {
  const out = { ...secrets };
  parseKv(secrets.authHeaders).forEach(([, v], i) => { out[`authHeader_${i}`] = v; });
  parseKv(secrets.authParams).forEach(([, v], i) => { out[`authParam_${i}`] = v; });
  return out;
}

function authEntries(form, secrets) {
  const auth = [];
  const type = form.authType || "none";
  if (type === "apiKeyHeader") auth.push({ in: "header", name: str(form.apiKeyName), value: "{apiKey}" });
  if (type === "apiKeyQuery") auth.push({ in: "query", name: str(form.apiKeyName), value: "{apiKey}" });
  if (type === "bearer") auth.push({ in: "header", name: "Authorization", value: "Bearer {token}" });
  if (type === "basic") auth.push({ in: "basic" });
  if (type === "login") {
    const prefix = form["login.prefix"] === "-" ? "" : str(form["login.prefix"]) ? form["login.prefix"] : "Bearer ";
    auth.push({ in: "header", name: str(form["login.header"]) || "Authorization", value: `${prefix}{sessionToken}` });
  }
  // Los personalizados se mandan con cualquier tipo de autenticación (si están cargados).
  parseKv(secrets.authHeaders).forEach(([name], i) => auth.push({ in: "header", name, value: `{authHeader_${i}}` }));
  parseKv(secrets.authParams).forEach(([name], i) => auth.push({ in: "query", name, value: `{authParam_${i}}` }));
  return auth;
}

// Paginación de un endpoint: sus propios valores y, si un campo queda vacío, el de la general.
// (Compatibilidad: la opción anterior "paged = none" equivale a "sin paginación".)
export function paginationFor(form, key) {
  const own = k => str(form[`${key}.page.${k}`]);
  const type = own("type") || (form[`${key}.paged`] === "none" ? "none" : "") || form["page.type"] || "none";
  const info = str(form["page.infoPath"]);
  const at = (ownPath, generalKey) => {
    const p = ownPath || str(form[generalKey]);
    return p ? (info && !ownPath ? `${info}.${p}` : p) : undefined;
  };
  return {
    type,
    param: own("param") || str(form["page.pageParam"]),
    sizeParam: own("sizeParam") || str(form["page.sizeParam"]),
    start: clamp(form["page.start"], 0, 1e6, 1),
    limit: clamp(own("size") || form["page.size"], 1, 10000, 50),
    totalPages: at(own("totalPagesPath"), "page.totalPagesPath"),
    total: at(own("totalResultsPath"), "page.totalResultsPath"),
    next: at(own("nextPath"), "page.nextPath"),
    lastPage: at(own("lastPagePath"), "page.lastPagePath"),
    maxPages: clamp(own("maxPages"), 0, 1e6, 0),
    maxItems: clamp(own("maxItems"), 0, 1e9, 0),
    onEmpty: own("onEmpty") || "end",
    onRepeat: own("onRepeat") || "partial",
    onInvalid: own("onInvalid") || "fail"
  };
}

function endpointSpec(form, key, map, prefix) {
  const path = str(form[`${key}.path`]);
  if (!path) return null;
  const pg = paginationFor(form, key);
  const query = Object.fromEntries(parseKv(form[`${key}.params`]));
  if (pg.param && pg.type === "page") query[pg.param] = "{page}";
  if (pg.param && pg.type === "offset") query[pg.param] = "{offset}";
  if (pg.param && pg.type === "cursor") query[pg.param] = "{cursor}";
  if (pg.sizeParam && pg.type !== "none") query[pg.sizeParam] = String(pg.limit);
  if (str(form["page.sinceParam"])) query[str(form["page.sinceParam"])] = "{since}";
  return {
    path,
    method: form[`${key}.method`] || form.httpMethod || "GET",
    query,
    headers: Object.fromEntries(parseKv(form[`${key}.headers`])),
    items: str(form[`${key}.items`]) || undefined,
    pagination: pg,
    sinceFormat: form["page.sinceFormat"] || "iso",
    map,
    prefix
  };
}

function titleMap(form) {
  const m = {};
  const set = (to, key) => { if (str(form[key])) m[to] = str(form[key]); };
  set("id", "map.id"); set("title", "map.title"); set("originalTitle", "map.originalTitle"); set("description", "map.description");
  set("poster", "map.poster"); set("backdrop", "map.backdrop"); set("tmdb", "map.tmdb"); set("imdb", "map.imdb");
  set("categories", "map.categories"); set("rating", "map.rating");
  if (str(form["map.year"]) || str(form["map.releaseDate"])) m.year = [str(form["map.year"]), str(form["map.releaseDate"])].filter(Boolean).join("|");
  set("data.type", "map.type"); set("data.seasonsCount", "map.seasonsCount"); set("data.episodesCount", "map.episodesCount");
  set("data.updatedAt", "map.updatedAt"); set("data.releaseDate", "map.releaseDate");
  if (form["play.mode"] === "direct") set("playback.url", "map.playbackUrl");
  set("data.subtitleUrl", "map.subtitleUrl");
  for (const [name, path] of parseKv(form["map.extra"])) m[`data.${name}`] = path;
  return m;
}

function episodeMap(form) {
  const m = {};
  const set = (to, key) => { if (str(form[key])) m[to] = str(form[key]); };
  set("id", "epmap.id"); set("season", "epmap.season"); set("number", "epmap.number"); set("title", "epmap.title");
  set("description", "epmap.description"); set("still", "epmap.still"); set("duration", "epmap.duration");
  if (form["play.mode"] === "direct") set("playback.url", "epmap.playbackUrl");
  set("data.subtitleUrl", "epmap.subtitleUrl");
  for (const [name, path] of parseKv(form["epmap.extra"])) m[`data.${name}`] = path;
  return m;
}

// Formulario → especificación del motor genérico (sin credenciales: solo referencias {apiKey}, etc.).
export function compile(config, secrets = {}) {
  const form = formOf(config);
  const prefix = { poster: str(form["img.posterPrefix"]), backdrop: str(form["img.backdropPrefix"]) };
  const catalog = {};
  for (const k of KINDS) {
    if (!form[`cat.${k}`]) continue;
    const ep = endpointSpec(form, `ep.${k}`, titleMap(form), prefix);
    if (ep) catalog[k] = ep;
  }
  const spec = { auth: authEntries(form, secrets), catalog };
  const episodesOn = form["cat.episodes"] && (form["cat.series"] || form["cat.anime"]);
  if (episodesOn) {
    const seasons = endpointSpec(form, "ep.seasons", {}, {});
    if (seasons) spec.seasons = { ...seasons, map: { number: str(form["season.number"]) || "number" }, pagination: { type: "none" } };
    const episodes = endpointSpec(form, "ep.episodes", episodeMap(form), { still: str(form["img.stillPrefix"]) });
    if (episodes) spec.episodes = episodes;
  }
  const test = endpointSpec(form, "ep.test", {}, {});
  if (test) spec.test = { ...test, pagination: { type: "none" } };
  return spec;
}

const withSpec = (ctx, spec) => ({ ...ctx, config: { baseUrl: formOf(ctx.config).baseUrl, spec } });
const lazyModes = ["template", "api"];

// Con "inicio de sesión": pone el token en las credenciales (para "auth" y para ocultarlo en textos)
// y, si la fuente responde 401, renueva el token una vez y reintenta.
async function withSession(ctx, fn) {
  if (!ctx.session) return fn(ctx);
  ctx.secrets.sessionToken = await ctx.session.token();
  try {
    return await fn(ctx);
  } catch (err) {
    if (err?.status !== 401) throw err;
    ctx.secrets.sessionToken = await ctx.session.token(true);
    return fn(ctx);
  }
}

export const subtitleFormat = url => (/\.srt(\?|#|$)/i.test(String(url)) ? "srt" : "vtt");

// Subtítulos que no requieren pedir nada: por plantilla (un idioma por línea) o con la URL del catálogo.
function subtitleList(ctx, { source, episode, title = {} }) {
  const form = formOf(ctx.config);
  const out = [];
  const tpl = str(episode ? form["play.subtitleEpisodeTemplate"] : form["play.subtitleMovieTemplate"]);
  const playBase = str(form["play.baseUrl"]) || str(form.baseUrl);
  const enc = v => encodeURIComponent(v ?? "");
  const data = { ...(source?.data || {}), ...(episode?.data || {}) };
  const vars = {
    id: enc(episode ? rawId(episode) : source ? rawId(source) : ""), seriesId: enc(episode && source ? rawId(source) : ""),
    season: enc(episode?.season ?? ""), episode: enc(episode?.number ?? ""), tmdb: enc(title.tmdb ?? ""), imdb: enc(title.imdb ?? ""),
    data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)]))
  };
  if (tpl) {
    for (const [code, label] of parseKv(form["play.subtitleLangs"])) {
      const filled = render(tpl, { ...vars, lang: enc(code) });
      const url = safeUrl(/^https?:\/\//i.test(filled) ? filled : playBase.replace(/\/$/, "") + filled);
      if (url) out.push({ url, lang: code, label: label || code, format: subtitleFormat(url) });
    }
  }
  const mapped = safeUrl((episode ? episode.data : source?.data)?.subtitleUrl);
  if (mapped) {
    const lang = str(form["play.subtitleDefaultLang"]);
    out.push({ url: mapped, lang, label: lang || "Subtítulos", format: subtitleFormat(mapped) });
  }
  return out;
}

// ¿Qué puede hacer esta fuente con la configuración actual? (lo que no está, figura como no soportado)
export function capabilities(config) {
  const form = formOf(config);
  const mode = form["play.mode"] || "";
  const has = k => Boolean(str(form[k]));
  const playMovie = mode === "template" ? has("play.movieTemplate") || has("play.movieIdParam") || has("play.params")
    : mode === "api" ? has("play.apiPath") && has("play.urlPath") : mode === "direct" ? has("map.playbackUrl") : false;
  const playEpisode = mode === "template" ? has("play.episodeTemplate") || has("play.seriesIdParam") || has("play.episodeParam")
    : mode === "api" ? (has("play.apiEpisodePath") || has("play.apiPath")) && has("play.urlPath") : mode === "direct" ? has("epmap.playbackUrl") : false;
  const compatible = !playbackProblems(config).some(p => p.startsWith("NO COMPATIBLE"));
  return [
    ["connection", "Probar conexión", has("baseUrl")],
    ["movie", "Películas", form["cat.movie"] && has("ep.movie.path")],
    ["series", "Series", form["cat.series"] && has("ep.series.path")],
    ["anime", "Anime", form["cat.anime"] && has("ep.anime.path")],
    ["seasons", "Temporadas", Boolean(form["cat.episodes"]) && has("ep.seasons.path")],
    ["episodes", "Episodios", Boolean(form["cat.episodes"]) && has("ep.episodes.path")],
    ["pagination", "Paginación", (form["page.type"] || "none") !== "none"],
    ["incremental", "Sincronización incremental", has("page.sinceParam")],
    ["playMovie", "Reproducir películas", playMovie && compatible],
    ["playEpisode", "Reproducir episodios", playEpisode && compatible],
    ["subtitles", "Subtítulos", (mode === "api" && has("play.subtitlesPath")) || has("play.subtitleMovieTemplate") || has("play.subtitleEpisodeTemplate") || has("map.subtitleUrl") || has("epmap.subtitleUrl")],
    ["directPlayback", "Reproducción directa compatible", !form["play.requiresHeaders"] && !form["play.requiresCookies"] && form["play.keyIn"] !== "url"],
    ["expiry", "Enlaces que vencen", has("play.expiresPath") || has("play.expiresSec")]
  ].map(([id, label, supported]) => ({ id, label, supported: Boolean(supported) }));
}

// Problemas de configuración de la reproducción (se informan al probarla, no impiden importar).
export function playbackProblems(config) {
  const form = formOf(config);
  const p = [];
  const mode = form["play.mode"] || "";
  if (!mode) return ["Elegí el método de reproducción."];
  const keyIn = form["play.keyIn"] || "";
  const templates = [form["play.movieTemplate"], form["play.episodeTemplate"], form["play.subtitleMovieTemplate"], form["play.subtitleEpisodeTemplate"], ...parseKv(form["play.params"]).map(([, v]) => v)];
  const secretRefs = templates.flatMap(t => placeholders(t || "")).filter(n => ["playbackKey", "apiKey", "token", "username", "password", "sessionToken"].includes(n) || /^auth(Header|Param)_/.test(n));
  // Incompatibilidades con la reproducción directa en el navegador (no se resuelven ocultando nada).
  if (keyIn === "url" || secretRefs.length) p.push("NO COMPATIBLE con reproducción directa: la fuente exige una credencial dentro de la URL que usa el navegador, y Supat no envía credenciales privadas al navegador.");
  if (form["play.requiresHeaders"]) p.push("NO COMPATIBLE con reproducción directa: el servidor de video exige encabezados propios que el navegador no puede enviar de forma segura.");
  if (form["play.requiresCookies"]) p.push("NO COMPATIBLE con reproducción directa: el servidor de video exige cookies.");
  if (["header", "query", "body"].includes(keyIn) && !str(form["play.keyName"])) p.push("Falta el nombre del encabezado o parámetro de la credencial de reproducción.");
  if (["header", "query", "body"].includes(keyIn) && mode !== "api") p.push("La credencial en encabezado, parámetro o cuerpo solo funciona con el método \"Pedir la URL a un endpoint\".");
  for (const d of parseList(form["play.domains"])) {
    try {
      const u = new URL(d);
      const local = ["localhost", "127.0.0.1"].includes(u.hostname) && u.protocol === "http:";
      if ((u.protocol !== "https:" && !local) || u.origin !== d.replace(/\/$/, "")) throw new Error();
    }
    catch { p.push(`Dominio de reproducción inválido: ${d} (usar https://dominio).`); }
  }
  if (form["play.contentType"] === "embed" && !parseList(form["play.domains"]).length) p.push("Un reproductor externo necesita al menos un dominio de reproducción permitido.");
  if (mode === "api" && !str(form["play.urlPath"])) p.push("Falta la ruta de la URL en la respuesta del endpoint de reproducción.");
  if (form["play.baseUrl"]) {
    try { const u = new URL(form["play.baseUrl"]); if (!["https:", "http:"].includes(u.protocol)) throw new Error(); } catch { p.push("La URL base de reproducción no es válida."); }
  }
  return p;
}

function expiresAtFrom(raw, form) {
  const now = Date.now();
  if (raw !== undefined && raw !== null && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) {
      if (n > 1e12) return n;              // milisegundos Unix
      if (n > 1e9) return n * 1000;        // segundos Unix
      if (n > 0) return now + n * 1000;    // duración en segundos
    }
    const t = Date.parse(String(raw));
    if (Number.isFinite(t)) return t;
  }
  const sec = clamp(form["play.expiresSec"], 0, 30 * 86400, 0);
  return sec ? now + sec * 1000 : null;
}

const FORMAT_TYPES = { hls: "application/x-mpegurl", mp4: "video/mp4", webm: "video/webm" };

export default {
  id: "configurable",
  name: "Fuente configurable",
  description: "Fuente de contenido configurada desde Ajustes.",
  kinds: KINDS,
  fields: [],
  expandSecrets,
  kindsFor: config => Object.keys(compile(config).catalog),
  episodesEnabled: config => Boolean(compile(config).episodes),
  supportsIncremental: config => Boolean(str(formOf(config)["page.sinceParam"])),
  timeoutMs: config => clamp(formOf(config).timeoutSec, 2, 30, 15) * 1000,
  minIntervalMs: config => clamp(formOf(config).minIntervalMs, 0, 10000, 0),
  retryPolicy: config => ({ max: clamp(formOf(config).retryMax, 1, 10, 5), delayMs: clamp(formOf(config).retryDelaySec, 5, 3600, 60) * 1000 }),
  embedOrigins: config => (formOf(config)["play.contentType"] === "embed" ? parseList(formOf(config)["play.domains"]).map(d => d.replace(/\/$/, "")) : []),
  // Con "dentro de la URL", la credencial de reproducción puede ir en el enlace que usa el navegador.
  // Ninguna credencial puede ir en el enlace que usa el navegador.
  urlSecretsAllowed: () => [],
  // Límite de frecuencia persistente (provider-state.js).
  rateConfig: config => {
    const f = formOf(config);
    return {
      minIntervalMs: clamp(f.minIntervalMs, 0, 600000, 0),
      windowSec: clamp(f["rate.windowSec"], 0, 86400, 0),
      windowMax: clamp(f["rate.windowMax"], 0, 1e6, 0),
      honorRetryAfter: Boolean(f["rate.honorRetryAfter"]),
      on429: f["rate.on429"] === "retry" ? "retry" : "wait",
      maxWaitMs: clamp(f["rate.maxWaitSec"], 1, 86400, 3600) * 1000,
      retryDelayMs: clamp(f.retryDelaySec, 5, 3600, 60) * 1000
    };
  },
  // Umbral de seguridad de bajas (títulos y episodios).
  removalPolicy: config => ({ percent: clamp(formOf(config)["safety.removalPercent"], 0, 100, 10), min: clamp(formOf(config)["safety.removalMin"], 0, 1e6, 20) }),
  // Inicio de sesión → token (provider-state.js makeSession).
  loginConfig: config => {
    const f = formOf(config);
    if (f.authType !== "login" || !str(f["login.path"])) return null;
    return { path: str(f["login.path"]), format: f["login.format"] === "form" ? "form" : "json", userField: str(f["login.userField"]), passField: str(f["login.passField"]),
      extra: parseKv(f["login.extra"]), tokenPath: str(f["login.tokenPath"]), expiresPath: str(f["login.expiresPath"]), ttlSec: clamp(f["login.ttlSec"], 60, 30 * 86400, 3600) };
  },
  subtitlesFor: (ctx, args) => subtitleList(ctx, args),
  validate: config => missingToActivate(formOf(config), config.__secretsSet || []),

  test(ctx) { return withSession(ctx, c => this._test(c)); },
  listPage(ctx, args) { return withSession(ctx, c => this._listPage(c, args)); },
  listEpisodes(ctx, args) { return withSession(ctx, c => this._listEpisodes(c, args)); },
  resolve(ctx, args) { return withSession(ctx, c => this._resolve(c, args)); },

  async _test(ctx) {
    const spec = compile(ctx.config, ctx.secrets);
    if (spec.test) {
      await callEndpoint(withSpec(ctx, spec), spec, spec.test, {});
      return { message: "Conexión correcta (endpoint de prueba)." };
    }
    const [kind] = Object.keys(spec.catalog);
    if (!kind) throw new ProviderError("No hay ningún endpoint de catálogo configurado para probar.");
    const page = await this._listPage(ctx, { kind, cursor: null, since: null });
    return { message: `Conexión correcta: ${page.items.length} resultado(s) en la primera página de "${kind}".`, sample: page.items.slice(0, 3).map(i => i.title) };
  },

  async _listPage(ctx, { kind, cursor, since }) {
    const spec = compile(ctx.config, ctx.secrets);
    const form = formOf(ctx.config);
    const page = await generic.listPage(withSpec(ctx, spec), { kind, cursor, since });
    const lazy = lazyModes.includes(form["play.mode"]);
    page.items = page.items.map(item => {
      const playback = item.playback?.url ? item.playback : lazy ? { lazy: true } : null;
      let hasEpisodes = item.hasEpisodes;
      if (kind === "anime") {
        const counts = [item.data?.seasonsCount, item.data?.episodesCount].filter(v => v !== undefined && v !== null && v !== "");
        hasEpisodes = Boolean(spec.episodes) && (counts.length ? counts.some(v => Number(v) > 0) : true);
      }
      return { ...item, id: item.id == null || item.id === "" ? item.id : `${kind}:${item.id}`, playback, hasEpisodes };
    });
    return page;
  },

  async _listEpisodes(ctx, args) {
    const spec = compile(ctx.config, ctx.secrets);
    const lazy = lazyModes.includes(formOf(ctx.config)["play.mode"]);
    const source = args.source;
    const page = await generic.listEpisodes(withSpec(ctx, spec), { ...args, source: { ...source, externalId: rawId(source) } });
    page.episodes = page.episodes.map(e => ({
      ...e,
      id: e.id == null || e.id === "" ? e.id : `${source.externalId}/${e.id}`,
      playback: e.playback?.url ? e.playback : lazy ? { lazy: true } : null
    }));
    return page;
  },

  // Fuente de reproducción de una película o de un episodio.
  // title: { tmdb, imdb } del título; source: fuente del título; episode: { externalId, season, number, data } o null.
  async _resolve(ctx, { source, episode, title = {} }) {
    const form = formOf(ctx.config);
    const problems = playbackProblems(ctx.config);
    if (problems.length) throw new ProviderError(problems.join(" "));
    const mode = form["play.mode"];
    if (mode === "direct") throw new ProviderError("El método directo usa la URL del catálogo, y este título no la trae.");
    const vars = {
      id: episode ? rawId(episode) : source ? rawId(source) : "",
      seriesId: episode && source ? rawId(source) : "",
      season: episode?.season ?? "",
      episode: episode?.number ?? "",
      number: episode?.number ?? "",
      tmdb: title.tmdb ?? "",
      imdb: title.imdb ?? "",
      lang: str(form["play.langValue"]),
      data: { ...(source?.data || {}), ...(episode?.data || {}) }
    };
    const keyIn = form["play.keyIn"] || "";
    const playBase = str(form["play.baseUrl"]) || str(form.baseUrl);
    const idParams = episode
      ? [[form["play.seriesIdParam"], "{seriesId}"], [form["play.seasonParam"], "{season}"], [form["play.episodeParam"], "{episode}"]]
      : [[form["play.movieIdParam"], "{id}"]];
    const extraParams = [...idParams.filter(([k]) => str(k)).map(([k, v]) => [str(k), v]), ...parseKv(form["play.params"])];
    if (str(form["play.langParam"])) extraParams.push([str(form["play.langParam"]), "{lang}"]);

    let url, rawType, rawExpires, rawSubs = [];
    if (mode === "template") {
      const encoded = { ...Object.fromEntries(Object.entries(vars).filter(([k]) => k !== "data").map(([k, v]) => [k, encodeURIComponent(v)])), data: Object.fromEntries(Object.entries(vars.data).map(([k, v]) => [k, encodeURIComponent(v ?? "")])) };
      const tpl = str(episode ? form["play.episodeTemplate"] : form["play.movieTemplate"]);
      let u;
      try { u = new URL(tpl ? (/^https?:\/\//i.test(tpl) ? render(tpl, encoded) : playBase.replace(/\/$/, "") + render(tpl, encoded)) : playBase); }
      catch { throw new ProviderError("La plantilla de reproducción no forma una URL válida."); }
      if (!tpl && !extraParams.length) throw new ProviderError(`Falta la plantilla de URL de ${episode ? "episodios" : "películas"} o sus parámetros.`);
      for (const [k, t] of extraParams) {
        const v = render(t, vars);
        if (v !== "") u.searchParams.set(k, v);
      }
      url = u.toString();
    } else if (mode === "api") {
      const path = str(episode ? form["play.apiEpisodePath"] || form["play.apiPath"] : form["play.apiPath"]);
      if (!path) throw new ProviderError(`Falta el endpoint de reproducción de ${episode ? "episodios" : "películas"}.`);
      const spec = compile(ctx.config, ctx.secrets);
      spec.playbackAuth = ["header", "query", "body"].includes(keyIn) ? [{ in: keyIn, name: str(form["play.keyName"]), value: "{playbackKey}" }] : [];
      const ep = { path, method: form["play.apiMethod"] || form.httpMethod || "GET", query: Object.fromEntries(extraParams), headers: Object.fromEntries(parseKv(form["play.headers"])) };
      const data = await callEndpoint(withSpec(ctx, spec), spec, ep, vars, { playback: true, baseUrl: playBase });
      url = pick(data, str(form["play.urlPath"]));
      rawType = str(form["play.typePath"]) ? pick(data, str(form["play.typePath"])) : undefined;
      rawExpires = str(form["play.expiresPath"]) ? pick(data, str(form["play.expiresPath"])) : undefined;
      if (str(form["play.subtitlesPath"])) {
        const list = pick(data, str(form["play.subtitlesPath"]));
        rawSubs = Array.isArray(list) ? list : [];
      }
    } else {
      throw new ProviderError("Método de reproducción desconocido.");
    }
    if (!url) throw new ProviderError("La fuente no devolvió una URL de reproducción.");

    const embed = form["play.contentType"] === "embed";
    const type = embed ? "embed" : FORMAT_TYPES[form["play.format"]] || playbackType(rawType || "");
    const subtitles = rawSubs.slice(0, 20).map(s => ({
      url: safeUrl(pick(s, str(form["play.subtitleUrl"]) || "url")),
      lang: String(pick(s, str(form["play.subtitleLang"]) || "lang") ?? "").slice(0, 20),
      label: String(pick(s, str(form["play.subtitleLabel"]) || "label") ?? "").slice(0, 60)
    })).filter(s => s.url).map(s => ({ ...s, format: subtitleFormat(s.url) }));
    return { url: String(url), type, subtitles: [...subtitles, ...subtitleList(ctx, { source, episode, title })], expiresAt: expiresAtFrom(rawExpires, form) };
  },

  // Dominios permitidos para los enlaces (vacío = cualquiera, salvo reproductores externos).
  allowedPlaybackOrigins: config => parseList(formOf(config)["play.domains"]).map(d => d.replace(/\/$/, "")),
  playbackProblems,
  capabilities
};
