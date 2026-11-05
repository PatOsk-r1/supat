// Modo simple: detección automática de la configuración de una fuente con la dirección y la API Key.
// APIs SIMULADAS e inventadas (no existen ni imitan a ninguna real).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, api, fakeNet } from "./helpers/api.js";
import { findList, parseExampleUrl, detectTitleFields, detectPagination, detectPlayback } from "../worker/src/providers/detect.js";

const OWNER = { uid: "dueno" };
const KEY = "clave-simulada-123456";
const HDR_KEY = "otra-clave-simulada-7890";

// API 1 (el caso real que lo motivó): lista en data.result, sin campo "id", TMDb en todos, IMDb en
// algunos, sin año ni sinopsis en varios, enlaces download_url (.mp4) y embed_url. Clave en la dirección.
const BASE1 = "https://api.uno.ejemplo";
const movie = i => ({
  title: `Película ${i}`, tmdb_id: 5000 + i, poster: `https://img.uno.ejemplo/p/${i}.jpg`, backdrop: `https://img.uno.ejemplo/b/${i}.jpg`,
  download_url: `https://cdn.uno.ejemplo/v/${i}.mp4`, embed_url: `https://player.uno.ejemplo/e/${i}`,
  ...(i % 3 === 0 ? { imdb_id: `tt${1000000 + i}` } : {}), ...(i % 2 === 0 ? { year: 2000 + (i % 20), description: `Sinopsis ${i}` } : {})
});
const net1 = () => fakeNet({
  [`${BASE1}/api/movies`]: u => {
    if (u.searchParams.get("api_key") !== KEY) return { __status: 401, body: { error: "clave" } };
    const page = Number(u.searchParams.get("page") || 1);
    if (page > 3) return { data: { result: [] }, total_pages: 3 };
    return { status: "ok", data: { result: Array.from({ length: 100 }, (_, i) => movie((page - 1) * 100 + i)), total_pages: 3 } };
  }
});

// API 2: clave en un encabezado (no dicho), series con enlace "siguiente", episodios por serie,
// imágenes con rutas de TMDb y solo reproductor externo.
const BASE2 = "https://api.dos.ejemplo/v1";
const net2 = () => fakeNet({
  [`${BASE2}/shows/`]: (u, init) => {
    if (init.headers?.["X-API-Key"] !== HDR_KEY) return { __status: 401, body: {} };
    const id = u.pathname.split("/")[3];
    return { episodes: [1, 2, 3].map(n => ({ id: `${id}-e${n}`, season_number: 1, episode_number: n, name: `Ep ${n}`, runtime: 42 })) };
  },
  [`${BASE2}/shows`]: (u, init) => {
    if (init.headers?.["X-API-Key"] !== HDR_KEY) return { __status: 401, body: {} };
    const n = Number(u.searchParams.get("n") || 1);
    return { items: [{ id: `s${n}`, name: `Serie ${n}`, tmdb_id: 7000 + n, poster_path: `/abc${n}.jpg`, player: `https://ver.dos.ejemplo/embed/s${n}` }],
      links: { next: n < 2 ? `${BASE2}/shows?n=${n + 1}` : null } };
  }
});

const detect = (env, net, body, slot = "a", who = OWNER) => api(env, "POST", `/api/admin/sources/${slot}/detect`, { ...who, fetchImpl: net, body });
const act = (env, net, slot, action, body = {}) => api(env, "POST", `/api/admin/sources/${slot}/${action}`, { ...OWNER, fetchImpl: net, body });

test("detección: piezas sueltas (lista, dirección, campos, paginación, reproducción)", () => {
  assert.equal(findList({ status: "ok", data: { result: [{ a: 1 }, { a: 2 }], tags: ["x"] } }).path, "data.result");
  assert.equal(findList([{ a: 1 }]).path, "");
  assert.equal(findList({ error: "x" }), null);
  const p = parseExampleUrl(`${BASE1}/api/movies?type=movie&page=1&limit=20&api_key=${KEY}`);
  assert.deepEqual([p.key.name, p.page.name, p.size.name, p.params], ["api_key", "page", "limit", [["type", "movie"]]]);
  assert.throws(() => parseExampleUrl("http://api.uno.ejemplo/x"), /https/);
  const rows = Array.from({ length: 30 }, (_, i) => movie(i));
  const map = detectTitleFields(rows);
  assert.equal(map.id, "tmdb_id", "sin ID propio, TMDb lo reemplaza");
  assert.equal(map.title, "title");
  assert.equal(map.imdb, "imdb_id");
  assert.equal(map.year, "year");
  assert.equal(detectPagination({ data: { result: rows }, total_pages: 3 }, "data.result", rows, { params: [] }).type, "page");
  assert.equal(detectPagination({ r: rows, next: "https://x.ejemplo/a?page=2" }, "r", rows, { params: [] }).type, "link");
  const play = detectPlayback(rows);
  assert.deepEqual([play.kind, play.path, play.format, play.alt], ["video", "download_url", "mp4", "embed_url"]);
});

test("detección: lista en data.result sin campo id → 100 de 100 válidos, se guarda e importa todo", async () => {
  const env = makeEnv();
  const net = net1();
  const r = await detect(env, net, { displayName: "Mi fuente", movieUrl: `${BASE1}/api/movies?page=1&api_key=${KEY}` });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true, r.body.message);
  const f = r.body.form;
  assert.equal(f.authType, "apiKeyQuery");
  assert.equal(f.apiKeyName, "api_key");
  assert.equal(r.body.keyParam, "api_key");
  assert.equal(f["ep.movie.items"], "data.result");
  assert.equal(f["ep.movie.page.type"], "page");
  assert.equal(f["ep.movie.page.totalPagesPath"], "data.total_pages");
  assert.equal(f["map.id"], "tmdb_id");
  assert.equal(f["play.mode"], "direct");
  assert.equal(f["map.playbackUrl"], "download_url");
  assert.equal(f["play.format"], "mp4");
  assert.equal(r.body.report.check.movie.valid, 100);
  assert.equal(r.body.report.check.movie.received, 100);
  assert.equal(r.body.report.coverage.movie.imdb, 34);
  assert.equal(f["simple.movieUrl"], `${BASE1}/api/movies?page=1`, "la dirección se guarda sin la clave");
  assert.ok(!JSON.stringify(r.body).includes(KEY), "la clave no vuelve al navegador");

  // "Usar esta configuración": guarda el formulario detectado con la clave aparte.
  const saved = await api(env, "PUT", "/api/admin/sources/a", { ...OWNER, fetchImpl: net, body: { form: f, secrets: { apiKey: KEY } } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(saved.body.source.missingToActivate, []);
  const cat = await act(env, net, "a", "test-catalog", { kind: "movie" });
  assert.match(cat.body.message, /100 resultado\(s\) en la primera página, 100 válidos/);
  assert.equal((await act(env, net, "a", "enable", { enabled: true })).status, 200);
  let job = (await act(env, net, "a", "import", { mode: "full" })).body.job;
  for (let i = 0; i < 40 && ["queued", "running"].includes(job.status); i++) job = (await api(env, "POST", `/api/admin/jobs/${job.id}/continue`, { ...OWNER, fetchImpl: net })).body.job;
  assert.equal(job.status, "done", JSON.stringify(job));
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM titles WHERE kind = 'movie'").get().n, 300);
  assert.ok(!JSON.stringify(env.DB.sqlite.prepare("SELECT * FROM providers").all()).includes(KEY), "clave cifrada en la base");
});

test("detección: clave en un encabezado no indicado, series con enlace siguiente, episodios e imágenes TMDb", async () => {
  const env = makeEnv();
  const net = net2();
  const r = await detect(env, net, { displayName: "Otra", seriesUrl: `${BASE2}/shows`, episodesUrl: `${BASE2}/shows/s1/episodes`, apiKey: HDR_KEY });
  assert.equal(r.body.ok, true, r.body.message);
  const f = r.body.form;
  assert.deepEqual([f.authType, f.apiKeyName, f.apiKeyPrefix], ["apiKeyHeader", "X-API-Key", ""]);
  assert.equal(f.baseUrl, "https://api.dos.ejemplo");
  assert.equal(f["ep.series.path"], "/v1/shows");
  assert.equal(f["ep.series.page.type"], "link");
  assert.equal(f["ep.series.page.nextPath"], "links.next");
  assert.equal(f["ep.episodes.path"], "/v1/shows/{id}/episodes");
  assert.equal(f["ep.episodes.page.type"], "none", "el endpoint de episodios no hereda la paginación");
  assert.deepEqual([f["epmap.id"], f["epmap.season"], f["epmap.number"]], ["id", "season_number", "episode_number"]);
  assert.equal(f["epmap.duration"], undefined, "duración en minutos: no se usa");
  assert.equal(f["img.posterPrefix"], "https://image.tmdb.org/t/p/w500");
  assert.deepEqual([f["play.contentType"], f["play.domains"]], ["embed", "https://ver.dos.ejemplo"]);
  assert.equal(r.body.report.check.series.valid, 1);
  assert.equal(r.body.report.check.episodes.valid, 3);
  assert.ok(net.calls.some(c => c.init.headers?.Authorization === `Bearer ${HDR_KEY}`), "probó primero Bearer");
  assert.ok(!JSON.stringify(r.body).includes(HDR_KEY));

  // Guardado y episodios importados con el código real.
  await api(env, "PUT", "/api/admin/sources/b", { ...OWNER, fetchImpl: net, body: { form: f, secrets: { apiKey: HDR_KEY } } });
  const eps = await act(env, net, "b", "test-catalog", { kind: "episodes" });
  assert.match(eps.body.message, /3 recibidos, 3 válidos/);
});

test("detección: errores claros, sin la clave, y solo para el propietario", async () => {
  const env = makeEnv();
  const net = net1();
  const bad = await detect(env, net, { displayName: "X", movieUrl: `${BASE1}/api/movies?api_key=equivocada-999` });
  assert.equal(bad.body.ok, false);
  assert.match(bad.body.message, /401/);
  assert.ok(!bad.body.message.includes("equivocada-999"));
  assert.match((await detect(env, net, { displayName: "X", movieUrl: "no es una dirección" })).body.message, /no es una dirección válida/);
  assert.match((await detect(env, net, { displayName: "X" })).body.message, /al menos la dirección/);
  const otherNet = fakeNet({ [`${BASE1}/vacio`]: () => ({ ok: true, mensaje: "nada" }) });
  assert.match((await detect(env, otherNet, { displayName: "X", movieUrl: `${BASE1}/vacio?api_key=${KEY}` })).body.message, /ninguna lista/);
  const user = await detect(env, net, { displayName: "X", movieUrl: `${BASE1}/api/movies?api_key=${KEY}` }, "a", { uid: "ana" });
  assert.equal(user.status, 403);
  assert.ok(!JSON.stringify(env.DB.sqlite.prepare("SELECT * FROM logs").all()).includes(KEY));
});

test("probar catálogo explica por qué no hay registros válidos (sin ID) y cuenta campos sobre lo recibido", async () => {
  const env = makeEnv();
  const net = net1();
  const form = { displayName: "Mal", baseUrl: BASE1, authType: "apiKeyQuery", apiKeyName: "api_key", "cat.movie": true, "ep.movie.path": "/api/movies",
    "ep.movie.items": "data.result", "page.type": "none", "map.id": "id", "map.title": "title", "map.tmdb": "tmdb_id", "map.poster": "poster" };
  await api(env, "PUT", "/api/admin/sources/a", { ...OWNER, fetchImpl: net, body: { form, secrets: { apiKey: KEY } } });
  const r = await act(env, net, "a", "test-catalog", { kind: "movie" });
  assert.equal(r.body.ok, false);
  assert.match(r.body.message, /100 resultado\(s\) en la primera página, 0 válidos \(100 sin ID/);
  assert.equal(r.body.coverage.titulo, 100);
  assert.equal(r.body.coverage.tmdb, 100);
  assert.equal(r.body.coverage.poster, 100);
  assert.equal(r.body.coverage.id, 0);
});
