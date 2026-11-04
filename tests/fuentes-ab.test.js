// Fuente A y Fuente B: configuración desde Ajustes, independencia, credenciales, importación,
// duplicados, reproducción y permisos. PRUEBAS CON SIMULADORES (tests/helpers/fuentes-simuladas.js):
// no prueban ninguna fuente real. Las pruebas reales están en tests/integracion-real.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, api } from "./helpers/api.js";
import { KEY, PLAY_KEY, movies } from "./helpers/proveedor-simulado.js";
import { FORM_A, FORM_B, SECRETS_A, SECRETS_B, TOKEN_B, PLAY_KEY_B, BASE_B, bothNets, emptyForm } from "./helpers/fuentes-simuladas.js";
import { missingToSave, missingToActivate, parseKv, FORM_KEYS } from "../src/shared/fuente-esquema.js";
import { compile, capabilities } from "../worker/src/providers/configurable.js";
import genericHttp from "../worker/src/providers/generic-http.js";

const OWNER = { uid: "dueno" };
const ALL_SECRETS = [KEY, PLAY_KEY, TOKEN_B, PLAY_KEY_B];

const save = (env, net, slot, form, secrets = {}, extra = {}) =>
  api(env, "PUT", `/api/admin/sources/${slot}`, { ...OWNER, fetchImpl: net, body: { form, secrets, ...extra } });
const act = (env, net, slot, action, body = {}, who = OWNER) => api(env, "POST", `/api/admin/sources/${slot}/${action}`, { ...who, fetchImpl: net, body });

async function finish(env, net, job) {
  for (let i = 0; i < 60 && job && ["queued", "running"].includes(job.status) && !job.paused; i++) {
    job = (await api(env, "POST", `/api/admin/jobs/${job.id}/continue`, { ...OWNER, fetchImpl: net })).body.job;
  }
  return job;
}

async function configure(env, net, slot, form, secrets) {
  const r = await save(env, net, slot, form, secrets);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const on = await act(env, net, slot, "enable", { enabled: true });
  assert.equal(on.status, 200, JSON.stringify(on.body));
  return on.body.source;
}

async function importAll(env, net, slot, mode = "full") {
  const r = await act(env, net, slot, "import", { mode });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return finish(env, net, r.body.job);
}

async function setupBoth(envExtra = {}, stA = {}, stB = {}) {
  const env = makeEnv(envExtra);
  const net = bothNets(stA, stB);
  await configure(env, net, "a", FORM_A(), SECRETS_A);
  await configure(env, net, "b", FORM_B(), SECRETS_B);
  const jobA = await importAll(env, net, "a");
  const jobB = await importAll(env, net, "b");
  return { env, net, jobA, jobB };
}

const titles = async (env, kind) => (await api(env, "GET", `/api/catalog/titles?kind=${kind}&pageSize=50`, { uid: "ana" })).body.items;
const dump = env => ["logs", "audit", "sync_jobs", "providers", "title_sources", "episode_sources"].map(t => JSON.stringify(env.DB.sqlite.prepare(`SELECT * FROM ${t}`).all())).join("");

// ---------- esquema y normalización ----------

test("esquema: los campos empiezan vacíos y se explica qué falta para guardar y para activar", async () => {
  const env = makeEnv();
  const view = (await api(env, "GET", "/api/admin/sources", OWNER)).body.sources;
  for (const slot of ["a", "b"]) {
    assert.equal(view[slot].configured, false);
    assert.deepEqual(view[slot].form, {});
    assert.deepEqual(view[slot].secretsSet, []);
  }
  assert.deepEqual(missingToSave(emptyForm()), ["Nombre visible", "URL base de la API"]);
  assert.match(missingToSave({ displayName: "x", baseUrl: "http://api.ejemplo" })[0], /https/);
  const r = await save(env, null, "a", emptyForm());
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Nombre visible.*URL base/);
  const missing = missingToActivate({ ...emptyForm(), displayName: "x", baseUrl: "https://api.ejemplo", "cat.movie": true, authType: "apiKeyHeader" }, []);
  for (const m of [/Endpoint de películas/, /ID del contenido/, /Título/, /nombre del encabezado/, /API Key/]) assert.ok(missing.some(x => m.test(x)), `falta "${m}"`);
  assert.deepEqual(missingToActivate(FORM_A(), ["apiKey", "playbackKey"]), []);
  assert.deepEqual(missingToActivate(FORM_B(), ["token", "playbackKey"]), []);
  assert.deepEqual(parseKv("a=1\n\nmal\n b = dos=2 "), [["a", "1"], ["b", "dos=2"]]);
});

test("normalización: cada fuente se traduce a su propia especificación (APIs distintas)", () => {
  const a = compile({ form: FORM_A() }), b = compile({ form: FORM_B() });
  assert.deepEqual(a.auth, [{ in: "header", name: "X-Api-Key", value: "{apiKey}" }]);
  assert.deepEqual(b.auth, [{ in: "header", name: "Authorization", value: "Bearer {token}" }]);
  assert.equal(a.catalog.movie.query.page, "{page}");
  assert.equal(b.catalog.movie.query.start, "{offset}");
  assert.equal(b.catalog.movie.query.count, "3");
  assert.equal(b.catalog.movie.pagination.total, "meta.total");
  assert.ok(a.seasons && !b.seasons);
  assert.equal(compile({ form: { ...FORM_A(), "cat.series": false, "cat.movie": false } }).episodes, undefined);
  const withCustom = compile({ form: { ...FORM_A(), authType: "custom" } }, { authHeaders: "X-Uno=1\nX-Dos=2", authParams: "p=3" });
  assert.deepEqual(withCustom.auth.map(x => [x.in, x.name, x.value]), [["header", "X-Uno", "{authHeader_0}"], ["header", "X-Dos", "{authHeader_1}"], ["query", "p", "{authParam_0}"]]);
  const caps = Object.fromEntries(capabilities({ form: FORM_B() }).map(c => [c.id, c.supported]));
  assert.equal(caps.anime, false);
  assert.equal(caps.seasons, false);
  assert.equal(caps.episodes, true);
  assert.equal(caps.playEpisode, true);
  assert.equal(caps.subtitles, false);
});

// ---------- permisos y secretos ----------

test("solo el propietario configura, prueba, importa o consulta las fuentes", async () => {
  const env = makeEnv();
  const net = bothNets();
  const routes = [["GET", "/api/admin/sources"], ["PUT", "/api/admin/sources/a"], ["POST", "/api/admin/sources/a/test-connection"], ["POST", "/api/admin/sources/b/test-catalog"],
    ["POST", "/api/admin/sources/a/test-playback"], ["POST", "/api/admin/sources/a/enable"], ["POST", "/api/admin/sources/b/import"], ["POST", "/api/admin/sources/a/pause"],
    ["POST", "/api/admin/sources/a/resume"], ["POST", "/api/admin/sources/a/restart"], ["GET", "/api/admin/sources/b/errors"]];
  for (const [m, p] of routes) {
    assert.equal((await api(env, m, p, { uid: "ana", fetchImpl: net, body: m === "GET" ? null : { form: FORM_A(), secrets: SECRETS_A, confirm: true } })).status, 403, `${m} ${p}`);
    assert.equal((await api(env, m, p, { fetchImpl: net, body: m === "GET" ? null : {} })).status, 401, `${m} ${p} sin sesión`);
  }
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM providers").get().n, 0);
  assert.equal((await api(env, "PUT", "/api/admin/sources/c", { ...OWNER, body: { form: FORM_A() } })).status, 404);
});

test("credenciales de las dos fuentes: cifradas, nunca en respuestas, registros ni catálogo; vacío conserva y 'borrar' quita", async () => {
  const { env, net } = await setupBoth();
  await save(env, net, "a", { ...FORM_A(), authType: "apiKeyHeader" }, { authHeaders: "X-Extra=valor-secreto-extra" });
  const view = (await api(env, "GET", "/api/admin/sources", OWNER)).body;
  const text = JSON.stringify(view) + dump(env);
  for (const secret of [...ALL_SECRETS, "valor-secreto-extra"]) assert.ok(!text.includes(secret), `apareció una credencial`);
  assert.deepEqual(view.sources.a.secretsSet.sort(), ["apiKey", "authHeaders", "playbackKey"]);
  assert.deepEqual(view.sources.a.customSecretNames.authHeaders, ["X-Extra"]);
  assert.deepEqual(view.sources.b.secretsSet.sort(), ["playbackKey", "token"]);
  // Guardar sin reescribirlas las conserva; "borrar" quita solo la elegida.
  await save(env, net, "b", FORM_B(), {});
  assert.deepEqual((await api(env, "GET", "/api/admin/sources", OWNER)).body.sources.b.secretsSet.sort(), ["playbackKey", "token"]);
  await save(env, net, "b", FORM_B(), {}, { clearSecrets: ["playbackKey"] });
  assert.deepEqual((await api(env, "GET", "/api/admin/sources", OWNER)).body.sources.b.secretsSet, ["token"]);
  assert.match(env.DB.sqlite.prepare("SELECT secrets_enc FROM providers WHERE id = 'fuente-a'").get().secrets_enc, /^v1:/);
});

test("sin SECRETS_KEY el servidor se niega a guardar credenciales", async () => {
  const env = makeEnv({ SECRETS_KEY: "" });
  assert.equal((await save(env, bothNets(), "a", FORM_A(), SECRETS_A)).status, 503);
});

test("activar exige la configuración mínima y lo explica", async () => {
  const env = makeEnv();
  const net = bothNets();
  assert.equal((await save(env, net, "a", { ...emptyForm(), displayName: "Opción 1", baseUrl: "https://api.ejemplo" })).status, 200);
  const r = await act(env, net, "a", "enable", { enabled: true });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /No se puede activar\. Falta: .*categoría.*ID del contenido.*Título/);
  assert.equal((await act(env, net, "a", "import", { mode: "full" })).status, 409);
});

// ---------- herramientas de prueba ----------

test("probar conexión y catálogo en cada fuente; una clave equivocada falla sin mostrarse", async () => {
  const env = makeEnv();
  const net = bothNets();
  await configure(env, net, "a", FORM_A(), SECRETS_A);
  await configure(env, net, "b", FORM_B(), SECRETS_B);
  const okA = (await act(env, net, "a", "test-connection")).body;
  assert.equal(okA.ok, true, okA.message);
  const okB = (await act(env, net, "b", "test-connection")).body;
  assert.equal(okB.ok, true, okB.message);
  const cat = (await act(env, net, "b", "test-catalog", { kind: "movie" })).body;
  assert.equal(cat.ok, true, cat.message);
  assert.match(cat.message, /3 resultado\(s\).*hay página siguiente/);
  assert.deepEqual([cat.coverage.titulo, cat.coverage.poster, cat.coverage.tmdb], [3, 1, 2]);
  assert.equal((await act(env, net, "b", "test-catalog", { kind: "episodes" })).body.ok, true);
  const anime = (await act(env, net, "a", "test-catalog", { kind: "anime" })).body;
  assert.equal(anime.ok, false);
  assert.match(anime.message, /no soportado/);
  await save(env, net, "b", FORM_B(), { token: "token-equivocado-123" });
  const bad = (await act(env, net, "b", "test-connection")).body;
  assert.equal(bad.ok, false);
  assert.match(bad.message, /401.*credenciales/);
  assert.ok(!JSON.stringify(bad).includes("token-equivocado-123"));
  const view = (await api(env, "GET", "/api/admin/sources", OWNER)).body.sources;
  assert.equal(view.b.lastTest.ok, false);
  assert.equal(view.a.lastTest.ok, true);
});

test("probar reproducción: endpoint con credencial en encabezado (A) y plantilla con credencial en la URL (B, con aviso)", async () => {
  const env = makeEnv();
  const net = bothNets();
  await configure(env, net, "a", FORM_A(), SECRETS_A);
  await configure(env, net, "b", FORM_B(), SECRETS_B);
  const pa = (await act(env, net, "a", "test-playback", { kind: "movie" })).body;
  assert.equal(pa.ok, true, pa.message);
  assert.match(pa.message, /Respondió 206/);
  const pe = (await act(env, net, "a", "test-playback", { kind: "episode" })).body;
  assert.equal(pe.ok, true, pe.message);
  const pb = (await act(env, net, "b", "test-playback", { kind: "movie" })).body;
  assert.equal(pb.ok, true, pb.message);
  assert.match(pb.message, /Vence en 10 min.*credencial de reproducción queda visible/);
  const peb = (await act(env, net, "b", "test-playback", { kind: "episode" })).body;
  assert.equal(peb.ok, true, peb.message);
  for (const r of [pa, pe, pb, peb]) for (const s of ALL_SECRETS) assert.ok(!JSON.stringify(r).includes(s));
  assert.ok(!JSON.stringify([pa, pb]).includes("https://"), "la prueba no devuelve el enlace");
  // Plantilla con {playbackKey} sin elegir "dentro de la URL": se explica y no se reproduce.
  await save(env, net, "b", { ...FORM_B(), "play.keyIn": "", "play.movieTemplate": `${FORM_B()["play.baseUrl"]}/m/{id}.mp4?t={playbackKey}` });
  const bad = (await act(env, net, "b", "test-playback", { kind: "movie" })).body;
  assert.equal(bad.ok, false);
  assert.match(bad.message, /quedará visible/);
});

// ---------- importación ----------

test("importación completa de cada fuente: todas las páginas, temporadas y episodios, menos de 50 consultas a D1 por tanda", async () => {
  const env = makeEnv({ SYNC_PAGES_PER_RUN: "1" });
  const net = bothNets();
  await configure(env, net, "a", FORM_A(), SECRETS_A);
  let job = (await act(env, net, "a", "import", { mode: "full" })).body.job;
  assert.equal(job.pages, 1);
  const perRun = [];
  for (let i = 0; i < 30 && job.status === "running"; i++) {
    const before = env.DB.queries;
    job = (await api(env, "POST", `/api/admin/jobs/${job.id}/continue`, { ...OWNER, fetchImpl: net })).body.job;
    perRun.push(env.DB.queries - before);
  }
  assert.equal(job.status, "done", job.lastError);
  assert.equal(job.created, 5);
  assert.equal(job.episodes, 3);
  assert.ok(Math.max(...perRun) < 50, `consultas por tanda: ${perRun}`);
  const one = (await titles(env, "movie")).find(t => t.title === "La Película Uno");
  assert.deepEqual(one.externalIds, { tmdb: 101, tmdbType: "movie", imdb: "tt0000101" });
  assert.equal(one.poster, "https://img.prov.ejemplo/w500/uno.jpg");
  const serieA = (await titles(env, "series")).find(t => t.title === "Serie A");
  const detail = (await api(env, "GET", `/api/catalog/titles/${serieA.id}`, { uid: "ana" })).body;
  assert.deepEqual(detail.seasons.map(s => [s.number, s.episodes.map(e => e.title)]), [[1, ["Piloto", "Dos"]], [2, ["Vuelta"]]]);
});

test("independencia: cada fuente importa sola, y si una falla la otra sigue funcionando", async () => {
  const env = makeEnv();
  const net = bothNets({ failMovies: 999 });
  await configure(env, net, "a", { ...FORM_A(), retryMax: "2", retryDelaySec: "5" }, SECRETS_A);
  await configure(env, net, "b", FORM_B(), SECRETS_B);
  const jobB = await importAll(env, net, "b");
  assert.equal(jobB.status, "done", jobB.lastError);
  assert.equal(jobB.created, 5);
  const jobA = await importAll(env, net, "a");
  assert.equal(jobA.status, "failed");
  assert.equal(jobA.attempts, 2, "reintentos configurados desde Ajustes");
  const movies = (await titles(env, "movie")).map(t => t.title);
  assert.ok(movies.includes("Película solo de B"));
  const status = (await api(env, "GET", "/api/catalog/status", { uid: "ana" })).body;
  assert.equal(status.available, true);
  assert.equal(status.failing, true);
  const errors = (await api(env, "GET", "/api/admin/sources/a/errors", OWNER)).body.errors;
  assert.ok(errors.some(e => /503/.test(e.message)));
  assert.equal((await api(env, "GET", "/api/admin/sources/b/errors", OWNER)).body.errors.length, 0);
});

test("duplicados entre fuentes: TMDb une; el título muestra las dos fuentes y se puede elegir cuál reproducir", async () => {
  const { env, net, jobB } = await setupBoth();
  assert.equal(jobB.merged, 2, "la película (TMDb 101) y la serie (TMDb 501) ya existían por A");
  const list = await titles(env, "movie");
  assert.equal(list.filter(t => t.externalIds.tmdb === 101).length, 1);
  const one = list.find(t => t.externalIds.tmdb === 101);
  assert.equal(one.title, "La Película Uno", "mandan los datos de la fuente que lo creó");
  const sources = (await api(env, "GET", `/api/catalog/titles/${one.id}/sources`, { uid: "ana" })).body.sources;
  assert.deepEqual(sources.map(s => s.label), ["Opción 1", "Opción 2"]);
  const fromA = (await api(env, "GET", `/api/catalog/titles/${one.id}/play?source=${sources[0].id}`, { uid: "ana", fetchImpl: net })).body;
  assert.equal(fromA.provider, "Opción 1");
  assert.match(fromA.url, /^https:\/\/cdn\.prov\.ejemplo\/m1\.m3u8$/);
  const fromB = (await api(env, "GET", `/api/catalog/titles/${one.id}/play?source=${sources[1].id}`, { uid: "ana", fetchImpl: net })).body;
  assert.equal(fromB.provider, "Opción 2");
  assert.ok(fromB.url.startsWith("https://video.otra.ejemplo/m/b1.mp4"));
  assert.ok(fromB.expiresAt > Date.now());
  // Sin TMDb ni IMDb no se fusiona por título.
  assert.equal(list.filter(t => /Otra de B/.test(t.title)).length, 1);
  // Episodio en las dos fuentes (T2 E1): una sola fila, con las dos fuentes.
  const serie = (await titles(env, "series")).find(t => t.externalIds.tmdb === 501);
  const detail = (await api(env, "GET", `/api/catalog/titles/${serie.id}`, { uid: "ana" })).body;
  const e21 = detail.seasons.find(s => s.number === 2).episodes.find(e => e.number === 1);
  const epSources = (await api(env, "GET", `/api/catalog/titles/${serie.id}/sources?episode=${e21.id}`, { uid: "ana" })).body.sources;
  assert.deepEqual(epSources.map(s => s.label), ["Opción 1", "Opción 2"]);
  const epB = (await api(env, "GET", `/api/catalog/titles/${serie.id}/play?episode=${e21.id}&source=${epSources[1].id}`, { uid: "ana", fetchImpl: net })).body;
  assert.ok(epB.url.startsWith("https://video.otra.ejemplo/e/show-1/2/1.m3u8?"));
  assert.equal(epB.type, "", "formato a detectar por el reproductor");
});

test("errores de reproducción: un error de una fuente no bloquea a la otra; enlaces con credencial privada o de otro dominio se rechazan", async () => {
  const { env, net } = await setupBoth();
  const one = (await titles(env, "movie")).find(t => t.externalIds.tmdb === 101);
  // A deja de responder la reproducción: sin elegir fuente, se usa B.
  await save(env, net, "a", FORM_A(), { playbackKey: "credencial-equivocada" });
  const play = (await api(env, "GET", `/api/catalog/titles/${one.id}/play`, { uid: "ana", fetchImpl: net })).body;
  assert.equal(play.provider, "Opción 2");
  // Un enlace que contiene una credencial privada (no la de reproducción en URL) no se entrega.
  await save(env, net, "a", FORM_A(), { playbackKey: PLAY_KEY });
  const m2 = (await titles(env, "movie")).find(t => t.title === "Canción de Otoño");
  const r = await api(env, "GET", `/api/catalog/titles/${m2.id}/play`, { uid: "dueno", fetchImpl: net });
  assert.equal(r.status, 502);
  assert.match(r.body.error, /credencial privada/);
  // Un dominio fuera de los permitidos tampoco.
  await save(env, net, "a", { ...FORM_A(), "play.domains": "https://otro-cdn.ejemplo" });
  const m1 = (await titles(env, "movie")).find(t => t.title === "Ñandú Veloz");
  const r2 = await api(env, "GET", `/api/catalog/titles/${m1.id}/play`, { uid: "dueno", fetchImpl: net });
  assert.equal(r2.status, 502);
  assert.match(r2.body.error, /dominio/);
  // El usuario común no ve el detalle técnico.
  const r3 = await api(env, "GET", `/api/catalog/titles/${m1.id}/play`, { uid: "ana", fetchImpl: net });
  assert.doesNotMatch(r3.body.error, /dominio|credencial/);
  for (const s of ALL_SECRETS) assert.ok(!dump(env).includes(s));
});

test("reproducción por endpoint: subtítulos y vencimiento informados por la fuente", async () => {
  const env = makeEnv();
  const net = bothNets();
  await configure(env, net, "a", { ...FORM_A(), "play.subtitlesPath": "subs", "play.expiresPath": "ttl" }, SECRETS_A);
  await importAll(env, net, "a");
  net.a.state; // el simulador A no trae subtítulos: se verifica que la lista vacía no rompe nada
  const one = (await titles(env, "movie")).find(t => t.title === "La Película Uno");
  const play = (await api(env, "GET", `/api/catalog/titles/${one.id}/play`, { uid: "ana", fetchImpl: net })).body;
  assert.equal(play.type, "application/x-mpegurl");
  assert.equal(play.subtitles, undefined);
  // Respuesta con subtítulos y vencimiento.
  const fetchWithSubs = async (url, init) => (String(url).includes("/play/")
    ? new Response(JSON.stringify({ stream: { url: "https://cdn.prov.ejemplo/x.m3u8", type: "hls" }, ttl: 120, subs: [{ url: "https://cdn.prov.ejemplo/es.vtt", lang: "es", label: "Español" }, { url: "javascript:mal" }] }))
    : net(url, init));
  const play2 = (await api(env, "GET", `/api/catalog/titles/${one.id}/play`, { uid: "ana", fetchImpl: fetchWithSubs })).body;
  assert.deepEqual(play2.subtitles, [{ url: "https://cdn.prov.ejemplo/es.vtt", lang: "es", label: "Español" }]);
  assert.ok(play2.expiresAt > Date.now() + 100e3 && play2.expiresAt < Date.now() + 125e3);
});

test("pausar, reanudar y reiniciar (con confirmación) una importación; lo importado se conserva", async () => {
  const env = makeEnv({ SYNC_PAGES_PER_RUN: "1" });
  const net = bothNets();
  await configure(env, net, "a", FORM_A(), SECRETS_A);
  let job = (await act(env, net, "a", "import", { mode: "full" })).body.job;
  const paused = (await act(env, net, "a", "pause")).body.source;
  assert.equal(paused.activeJob.paused, true);
  // El cron no toma un trabajo en pausa.
  const worker = (await import("../worker/src/index.js")).default;
  const real = globalThis.fetch;
  globalThis.fetch = net;
  try {
    const tasks = [];
    await worker.scheduled({ cron: "* * * * *" }, env, { waitUntil: p => tasks.push(p) });
    await Promise.all(tasks);
  } finally { globalThis.fetch = real; }
  assert.equal(env.DB.sqlite.prepare(`SELECT pages FROM sync_jobs WHERE id = ${job.id}`).get().pages, 1);
  const resumed = (await act(env, net, "a", "resume")).body.source;
  assert.equal(resumed.activeJob.paused, false);
  assert.equal(resumed.activeJob.pages, 2);
  assert.equal((await act(env, net, "a", "restart", {})).status, 400, "sin confirmación no reinicia");
  const restarted = (await act(env, net, "a", "restart", { confirm: true })).body.source;
  assert.notEqual(restarted.activeJob.id, job.id);
  assert.equal(restarted.activeJob.pages, 1);
  assert.equal(env.DB.sqlite.prepare(`SELECT status FROM sync_jobs WHERE id = ${job.id}`).get().status, "cancelled");
  job = await finish(env, net, restarted.activeJob);
  assert.equal(job.status, "done");
  assert.ok((await titles(env, "movie")).length >= 3);
});

test("reanudación tras cortes: varias ejecuciones sin avance dejan el trabajo fallido con explicación y conservan lo importado", async () => {
  const env = makeEnv({ SYNC_PAGES_PER_RUN: "1" });
  const net = bothNets();
  await configure(env, net, "a", FORM_A(), SECRETS_A);
  const job = (await act(env, net, "a", "import", { mode: "full" })).body.job;
  env.DB.sqlite.exec(`UPDATE sync_jobs SET stalls = 6, locked_until = 0 WHERE id = ${job.id}`);
  const after = (await api(env, "POST", `/api/admin/jobs/${job.id}/continue`, { ...OWNER, fetchImpl: net })).body.job;
  assert.equal(after.status, "failed");
  assert.match(after.lastError, /límite de CPU/);
  assert.ok((await titles(env, "movie")).length > 0);
});

test("reintentos: una falla temporal se reintenta y termina; un error 400 falla enseguida", async () => {
  const env = makeEnv();
  const net = bothNets({ failMovies: 2 });
  await configure(env, net, "a", FORM_A(), SECRETS_A);
  const first = (await act(env, net, "a", "import", { mode: "full" })).body.job;
  assert.equal(first.attempts, 1);
  assert.match(first.lastError, /503/);
  assert.ok(first.nextRunAt > Date.now() + 50000);
  assert.equal((await finish(env, net, first)).status, "done");
  net.a.state.fatal = true;
  const job = (await act(env, net, "a", "import", { mode: "full" })).body.job;
  assert.equal(job.status, "failed");
  assert.equal(job.attempts, 1);
});

test("actualización: incremental con 'cambios desde', sin reescribir lo igual; un error no borra ni oculta lo importado", async () => {
  const { env, net } = await setupBoth();
  net.a.calls.length = 0;
  net.a.state.moviesFn = page => movies(page).map(m => (m.id === "m1" ? { ...m, overview: "Sinopsis nueva." } : m));
  const inc = await importAll(env, net, "a", "incremental");
  assert.equal(inc.mode, "incremental");
  assert.ok(net.a.calls.some(c => new URL(c.url).searchParams.get("changed_since")));
  assert.equal(inc.updated, 1);
  assert.equal((await titles(env, "movie")).find(t => t.title === "La Película Uno").description, "Sinopsis nueva.");
  // Una respuesta sin un campo que antes estaba no lo borra si otra fuente lo aporta; la fuente que
  // lo creó manda, pero una completa fallida no toca nada.
  const before = (await titles(env, "movie")).length;
  net.a.state.failMovies = 999;
  const failed = await importAll(env, net, "a", "full");
  assert.equal(failed.status, "failed");
  assert.equal((await titles(env, "movie")).length, before);
});

test("completa otra vez: lo que una fuente ya no ofrece se oculta solo si ninguna otra lo tiene; nada se borra", async () => {
  const { env, net } = await setupBoth();
  net.a.state.moviesFn = page => movies(page).filter(m => m.id !== "m3" && m.id !== "m1");
  assert.equal((await importAll(env, net, "a", "full")).status, "done");
  const list = (await titles(env, "movie")).map(t => t.title);
  assert.ok(!list.includes("Ñandú Veloz"), "solo estaba en A");
  assert.ok(list.includes("La Película Uno"), "sigue en B");
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM titles WHERE title = 'Ñandú Veloz'").get().n, 1);
});

test("categorías desmarcadas no se importan; páginas grandes no se recortan", async () => {
  const env = makeEnv();
  const many = Array.from({ length: 450 }, (_, i) => ({ id: `g${i}`, title: `Título ${i}`, release_date: "2000" }));
  const net = bothNets({ moviesFn: page => (page === 1 ? many : []) });
  await configure(env, net, "a", { ...FORM_A(), "cat.series": false, "cat.episodes": false }, SECRETS_A);
  const job = await importAll(env, net, "a");
  assert.equal(job.status, "done", job.lastError);
  assert.equal(job.created, 450);
  assert.equal(job.episodes, 0);
  assert.equal((await titles(env, "series")).length, 0);
});

test("solo Fuente A y Fuente B: guardarlas apaga proveedores anteriores sin borrar sus datos", async () => {
  const env = makeEnv();
  const now = Date.now();
  env.DB.sqlite.exec(`INSERT INTO providers (id, adapter, label, enabled, config_json, created_at, updated_at) VALUES ('viejo', 'http-json', 'Viejo', 1, '{}', ${now}, ${now})`);
  env.DB.sqlite.exec(`INSERT INTO titles (kind, title, title_norm, created_at, updated_at) VALUES ('movie', 'Título viejo', 'titulo viejo', ${now}, ${now})`);
  env.DB.sqlite.exec(`INSERT INTO title_sources (title_id, provider_id, external_id, seen_at) VALUES (last_insert_rowid(), 'viejo', 'v1', ${now})`);
  await save(env, bothNets(), "a", FORM_A(), SECRETS_A);
  assert.equal(env.DB.sqlite.prepare("SELECT enabled FROM providers WHERE id = 'viejo'").get().enabled, 0);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM titles WHERE title = 'Título viejo'").get().n, 1);
});

test("estado público del catálogo: títulos únicos entre las dos fuentes, sin datos técnicos", async () => {
  const { env } = await setupBoth();
  const status = (await api(env, "GET", "/api/catalog/status", { uid: "ana" })).body;
  assert.deepEqual([status.available, status.counts.movie, status.counts.series], [true, 6, 2]);
  assert.ok(!JSON.stringify(status).match(/ejemplo|Opción|fuente-a/));
  const empty = (await api(env.DB ? makeEnv() : env, "GET", "/api/catalog/status", { uid: "ana" })).body;
  assert.equal(empty.configured, false);
});

test("búsqueda remota paginada sobre el catálogo de las dos fuentes", async () => {
  const { env } = await setupBoth();
  const q = async s => (await api(env, "GET", `/api/catalog/search?${s}`, { uid: "ana" })).body;
  assert.deepEqual((await q("q=solo%20de%20b")).items.map(t => t.title), ["Película solo de B"]);
  assert.deepEqual((await q("q=nandu")).items.map(t => t.title), ["Ñandú Veloz"]);
  const p1 = await q("q=b&pageSize=1");
  assert.equal(p1.items.length, 1);
});

test("cron: a las 05:00 crea un trabajo por cada fuente activa y cada minuto los sigue", async () => {
  const { env, net } = await setupBoth();
  const worker = (await import("../worker/src/index.js")).default;
  const real = globalThis.fetch;
  globalThis.fetch = net;
  try {
    const run = async cron => { const t = []; await worker.scheduled({ cron }, env, { waitUntil: p => t.push(p) }); await Promise.all(t); };
    const n0 = env.DB.sqlite.prepare("SELECT COUNT(*) n FROM sync_jobs").get().n;
    await run("0 5 * * *");
    const created = env.DB.sqlite.prepare(`SELECT provider_id, mode FROM sync_jobs ORDER BY id DESC LIMIT 2`).all();
    assert.deepEqual(created.map(j => j.provider_id).sort(), ["fuente-a", "fuente-b"]);
    assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM sync_jobs").get().n, n0 + 2);
    for (let i = 0; i < 15; i++) await run("* * * * *");
    assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM sync_jobs WHERE status IN ('queued','running')").get().n, 0);
  } finally { globalThis.fetch = real; }
});

test("motor genérico: cada credencial en su lugar, https y enlaces a otro servidor", async () => {
  const BASE = "https://api.prov.ejemplo/v1";
  const check = spec => genericHttp.validate({ baseUrl: BASE, spec: JSON.stringify(spec) });
  const base = { catalog: { movie: { path: "/m", map: { id: "id", title: "t" } } }, resolve: { path: "/p/{id}", url: "u" } };
  assert.ok(check({ ...base, auth: [{ in: "header", name: "X", value: "{playbackKey}" }] }).some(p => /playbackAuth/.test(p)));
  assert.ok(check({ ...base, catalog: { movie: { path: "/m/{apiKey}", map: { id: "id", title: "t" } } } }).some(p => /credenciales/.test(p)));
  assert.ok(genericHttp.validate({ baseUrl: "http://api.ejemplo", spec: JSON.stringify(base) }).some(p => /https/.test(p)));
  const spec = { catalog: { movie: { path: "/list", items: "items", pagination: { type: "link", next: "next" }, map: { id: "id", title: "t" } } } };
  const ctx = { config: { baseUrl: BASE, spec }, secrets: {}, fetch: async () => new Response(JSON.stringify({ items: [{ id: 1, t: "a" }], next: "https://malo.ejemplo/x" })) };
  await assert.rejects(genericHttp.listPage(ctx, { kind: "movie" }), /otro servidor/);
  // Indicador de última página.
  const spec2 = { catalog: { movie: { path: "/list", items: "items", pagination: { type: "page", lastPage: "fin" }, map: { id: "id", title: "t" } } } };
  const ctx2 = { config: { baseUrl: BASE, spec: spec2 }, secrets: {}, fetch: async () => new Response(JSON.stringify({ items: [{ id: 1, t: "a" }], fin: true })) };
  assert.equal((await genericHttp.listPage(ctx2, { kind: "movie" })).next, null);
});

test("las claves del formulario no incluyen credenciales (se guardan aparte, cifradas)", () => {
  for (const k of ["apiKey", "token", "username", "password", "playbackKey", "authHeaders", "authParams"]) assert.ok(!FORM_KEYS.includes(k));
  assert.ok(BASE_B.startsWith("https://"));
});

test("una API que ignora el parámetro de página no deja la importación pidiendo páginas para siempre", async () => {
  const env = makeEnv();
  const net = bothNets();
  await configure(env, net, "a", { ...FORM_A(), "ep.episodes.paged": "" }, SECRETS_A);
  const job = await importAll(env, net, "a");
  assert.equal(job.status, "done", job.lastError);
  assert.equal(job.episodes, 3);
  assert.ok(job.pages < 20, `páginas: ${job.pages}`);
});
