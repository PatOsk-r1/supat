// Catálogo central: proveedores, credenciales, importación por tandas, reintentos, duplicados,
// búsqueda, episodios y reproducción. Todo contra un proveedor simulado (sin red).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, api } from "./helpers/api.js";
import { BASE, KEY, SPEC, providerNet, movies } from "./helpers/proveedor-simulado.js";
import genericHttp from "../worker/src/providers/generic-http.js";

const OWNER = { uid: "dueno" };

async function addProvider(env, net, { base = BASE, label = "Proveedor simulado", spec = SPEC, key = KEY } = {}) {
  const r = await api(env, "POST", "/api/admin/providers", { ...OWNER, fetchImpl: net, body: { adapter: "http-json", label, config: { baseUrl: base, spec: JSON.stringify(spec), apiKey: key } } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const on = await api(env, "PATCH", `/api/admin/providers/${r.body.provider.id}`, { ...OWNER, fetchImpl: net, body: { enabled: true } });
  assert.equal(on.status, 200, JSON.stringify(on.body));
  return r.body.provider.id;
}

// Corre un trabajo hasta que termine (como lo haría el cron), con un tope de vueltas.
async function syncAll(env, net, providerId, mode = "full") {
  let { body } = await api(env, "POST", `/api/admin/providers/${providerId}/sync`, { ...OWNER, fetchImpl: net, body: { mode } });
  let job = body.job;
  for (let i = 0; i < 30 && ["queued", "running"].includes(job.status); i++) {
    job = (await api(env, "POST", `/api/admin/jobs/${job.id}/continue`, { ...OWNER, fetchImpl: net })).body.job;
  }
  return job;
}

const titles = async (env, kind) => (await api(env, "GET", `/api/catalog/titles?kind=${kind}&pageSize=50`, { uid: "ana" })).body.items;

test("credenciales: se guardan cifradas y nunca salen en respuestas, registros ni auditoría", async () => {
  const env = makeEnv();
  const net = providerNet();
  const id = await addProvider(env, net);
  const list = await api(env, "GET", "/api/admin/providers", OWNER);
  assert.ok(!JSON.stringify(list.body).includes(KEY));
  assert.deepEqual(list.body.providers[0].secretsSet, ["apiKey"]);
  assert.equal(list.body.providers[0].config.apiKey, undefined);
  const row = env.DB.sqlite.prepare("SELECT secrets_enc, config_json FROM providers").get();
  assert.match(row.secrets_enc, /^v1:/);
  assert.ok(!row.secrets_enc.includes(KEY) && !row.config_json.includes(KEY));
  // La API se llamó con la clave en el encabezado.
  await syncAll(env, net, id);
  assert.ok(net.calls.some(c => c.init.headers?.["X-Api-Key"] === KEY));
  // Una fuente cuya dirección incluye la clave no se entrega, y el registro no la muestra.
  const m2 = (await titles(env, "movie")).find(t => t.title === "Canción de Otoño");
  const play = await api(env, "GET", `/api/catalog/titles/${m2.id}/play`, { uid: "dueno", fetchImpl: net });
  assert.equal(play.status, 502);
  assert.match(play.body.error, /credencial/);
  const dump = JSON.stringify(env.DB.sqlite.prepare("SELECT * FROM logs").all()) + JSON.stringify(env.DB.sqlite.prepare("SELECT * FROM audit").all()) + JSON.stringify(env.DB.sqlite.prepare("SELECT * FROM sync_jobs").all());
  assert.ok(!dump.includes(KEY), "la clave apareció en registros");
  // Guardar sin reescribir la clave la conserva; borrarla explícitamente la quita.
  await api(env, "PATCH", `/api/admin/providers/${id}`, { ...OWNER, body: { config: { apiKey: "" }, label: "Renombrado" } });
  assert.deepEqual((await api(env, "GET", "/api/admin/providers", OWNER)).body.providers[0].secretsSet, ["apiKey"]);
  await api(env, "PATCH", `/api/admin/providers/${id}`, { ...OWNER, body: { clearSecrets: ["apiKey"] } });
  assert.deepEqual((await api(env, "GET", "/api/admin/providers", OWNER)).body.providers[0].secretsSet, []);
});

test("sin SECRETS_KEY el servidor se niega a guardar credenciales", async () => {
  const env = makeEnv({ SECRETS_KEY: "" });
  const r = await api(env, "POST", "/api/admin/providers", { ...OWNER, body: { adapter: "http-json", config: { baseUrl: BASE, spec: JSON.stringify(SPEC), apiKey: KEY } } });
  assert.equal(r.status, 503);
});

test("prueba de conexión desde el panel: correcta y con clave equivocada (sin mostrarla)", async () => {
  const env = makeEnv();
  const net = providerNet();
  const id = await addProvider(env, net);
  const ok = await api(env, "POST", `/api/admin/providers/${id}/test`, { ...OWNER, fetchImpl: net });
  assert.equal(ok.body.ok, true, ok.body.message);
  assert.match(ok.body.message, /2 título/);
  const bad = await api(env, "POST", `/api/admin/providers/${id}/test`, { ...OWNER, fetchImpl: net, body: { config: { apiKey: "otra-clave-incorrecta" } } });
  assert.equal(bad.body.ok, false);
  assert.match(bad.body.message, /401.*credenciales/);
  assert.ok(!JSON.stringify(bad.body).includes("otra-clave-incorrecta"));
});

test("importación completa por tandas: reanudable, con temporadas y episodios", async () => {
  const env = makeEnv({ SYNC_PAGES_PER_RUN: "1" });
  const net = providerNet();
  const id = await addProvider(env, net);
  const first = await api(env, "POST", `/api/admin/providers/${id}/sync`, { ...OWNER, fetchImpl: net, body: { mode: "full" } });
  assert.equal(first.body.job.status, "running");
  assert.equal(first.body.job.pages, 1); // una página por ejecución: el resto queda para después
  let job = first.body.job;
  const queriesPerRun = [];
  for (let i = 0; i < 20 && job.status === "running"; i++) {
    const before = env.DB.queries;
    job = (await api(env, "POST", `/api/admin/jobs/${job.id}/continue`, { ...OWNER, fetchImpl: net })).body.job;
    queriesPerRun.push(env.DB.queries - before);
  }
  assert.equal(job.status, "done", job.lastError);
  assert.equal(job.created, 5);
  assert.equal(job.skipped, 2); // el título sin nombre y la serie cuyos episodios dan 404
  assert.equal(job.episodes, 3);
  assert.ok(Math.max(...queriesPerRun) < 50, `consultas a D1 por ejecución: ${queriesPerRun}`);
  assert.deepEqual((await titles(env, "movie")).map(t => t.title).sort(), ["Canción de Otoño", "La Película Uno", "Ñandú Veloz"]);
  const one = (await titles(env, "movie")).find(t => t.title === "La Película Uno");
  assert.deepEqual(one.externalIds, { tmdb: 101, tmdbType: "movie", imdb: "tt0000101" });
  assert.equal(one.year, 1999);
  assert.equal(one.poster, "https://img.prov.ejemplo/w500/uno.jpg");
  const serie = (await titles(env, "series")).find(t => t.title === "Serie A");
  const detail = (await api(env, "GET", `/api/catalog/titles/${serie.id}`, { uid: "ana" })).body;
  assert.deepEqual(detail.seasons.map(s => [s.number, s.episodes.map(e => e.title)]), [[1, ["Piloto", "Dos"]], [2, ["Vuelta"]]]);
  // La serie que falló queda registrada como aviso, sin cortar la importación.
  const logs = (await api(env, "GET", "/api/admin/logs?level=warn", OWNER)).body.logs;
  assert.ok(logs.some(l => /Episodios del título/.test(l.message) && /404/.test(l.message)));
});

test("reintentos: una falla temporal (503) se reintenta y el trabajo termina", async () => {
  const env = makeEnv();
  const net = providerNet({ failMovies: 2 });
  const id = await addProvider(env, net);
  const first = (await api(env, "POST", `/api/admin/providers/${id}/sync`, { ...OWNER, fetchImpl: net, body: { mode: "full" } })).body.job;
  assert.equal(first.status, "running");
  assert.equal(first.attempts, 1);
  assert.ok(first.nextRunAt > Date.now() + 50000, "espera antes del reintento");
  assert.match(first.lastError, /503/);
  const job = await syncAll(env, net, id);
  assert.equal(job.status, "done");
  assert.equal(job.created, 5);
});

test("reintentos: después de 5 intentos el trabajo queda fallido; un error 400 falla enseguida", async () => {
  const env = makeEnv();
  const net = providerNet({ failMovies: 999 });
  const id = await addProvider(env, net);
  const job = await syncAll(env, net, id);
  assert.equal(job.status, "failed");
  assert.equal(job.attempts, 5);
  const provider = (await api(env, "GET", "/api/admin/providers", OWNER)).body.providers[0];
  assert.equal(provider.lastStatus, "error");

  const env2 = makeEnv();
  const net2 = providerNet({ fatal: true });
  const id2 = await addProvider(env2, net2);
  const job2 = (await api(env2, "POST", `/api/admin/providers/${id2}/sync`, { ...OWNER, fetchImpl: net2, body: { mode: "full" } })).body.job;
  assert.equal(job2.status, "failed");
  assert.equal(job2.attempts, 1);
});

test("no se duplican trabajos: pedir otra sincronización devuelve la que está en curso", async () => {
  const env = makeEnv({ SYNC_PAGES_PER_RUN: "1" });
  const net = providerNet();
  const id = await addProvider(env, net);
  const a = (await api(env, "POST", `/api/admin/providers/${id}/sync`, { ...OWNER, fetchImpl: net, body: { mode: "full" } })).body;
  const b = (await api(env, "POST", `/api/admin/providers/${id}/sync`, { ...OWNER, fetchImpl: net, body: { mode: "full" } })).body;
  assert.equal(b.existing, true);
  assert.equal(b.job.id, a.job.id);
});

test("duplicados: un segundo proveedor con el mismo TMDb/IMDb se une al título existente", async () => {
  const env = makeEnv();
  const net = providerNet();
  const id = await addProvider(env, net);
  await syncAll(env, net, id);
  const OTHER = "https://api.otro.ejemplo/v1";
  const net2 = providerNet({ moviesFn: page => (page === 1 ? [
    { id: "x-9", title: "La pelicula uno (versión restaurada)", release_date: "1999", ids: { tmdb: 101 } },       // TMDb igual
    { id: "x-10", title: "Nandu veloz", ids: { imdb: "tt0000103" } },                                              // IMDb igual
    { id: "x-11", title: "Otra distinta", ids: { tmdb: 999 } }
  ] : []) });
  const both = async (url, init) => (String(url).startsWith(OTHER) ? net2(String(url).replace(OTHER, BASE), init) : net(url, init));
  const id2 = await addProvider(env, both, { base: OTHER, label: "Otro proveedor" });
  const job = await syncAll(env, both, id2);
  assert.equal(job.status, "done", job.lastError);
  assert.equal(job.merged, 2 + 2); // 2 películas + las 2 series (mismo tmdb_id 501/502)
  assert.equal(job.created, 1);
  const list = await titles(env, "movie");
  assert.equal(list.length, 4);
  const one = list.find(t => t.externalIds.tmdb === 101);
  assert.equal(one.title, "La Película Uno"); // manda el proveedor que lo creó
  const detail = (await api(env, "GET", `/api/catalog/titles/${one.id}`, { uid: "ana" })).body;
  assert.deepEqual(detail.sources.map(s => s.provider), ["Proveedor simulado", "Otro proveedor"]);
  const stats = (await api(env, "GET", "/api/admin/stats", OWNER)).body;
  assert.equal(stats.catalog.multiSource, 4);
});

test("incremental: pide solo cambios (since), no reescribe lo igual y actualiza lo cambiado", async () => {
  const env = makeEnv();
  const net = providerNet();
  const id = await addProvider(env, net);
  await syncAll(env, net, id);
  net.calls.length = 0;
  net.state.moviesFn = page => movies(page).map(m => (m.id === "m1" ? { ...m, overview: "Sinopsis nueva." } : m));
  const job = await syncAll(env, net, id, "incremental");
  assert.equal(job.mode, "incremental");
  assert.ok(net.calls.some(c => new URL(c.url).searchParams.get("changed_since")), "manda la fecha de la última sincronización");
  assert.equal(job.updated, 1);
  assert.equal(job.created, 0);
  assert.equal(job.unchanged, 4);
  const one = (await titles(env, "movie")).find(t => t.title === "La Película Uno");
  assert.equal(one.description, "Sinopsis nueva.");
});

test("completa otra vez: lo que el proveedor ya no ofrece se oculta, pero no se borra", async () => {
  const env = makeEnv();
  const net = providerNet();
  const id = await addProvider(env, net);
  await syncAll(env, net, id);
  net.state.moviesFn = page => movies(page).filter(m => m.id !== "m3");
  const job = await syncAll(env, net, id, "full");
  assert.equal(job.status, "done");
  assert.deepEqual((await titles(env, "movie")).map(t => t.title).sort(), ["Canción de Otoño", "La Película Uno"]);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM titles WHERE title = 'Ñandú Veloz'").get().n, 1);
  assert.equal(env.DB.sqlite.prepare("SELECT removed FROM title_sources WHERE external_id = 'm3'").get().removed, 1);
});

test("búsqueda remota paginada: sin acentos, por palabras y por tipo", async () => {
  const env = makeEnv();
  const net = providerNet();
  await syncAll(env, net, await addProvider(env, net));
  const q = async s => (await api(env, "GET", `/api/catalog/search?${s}`, { uid: "ana" })).body;
  assert.deepEqual((await q("q=nandu")).items.map(t => t.title), ["Ñandú Veloz"]);
  assert.deepEqual((await q("q=Cancion%20oto")).items.map(t => t.title), ["Canción de Otoño"]);
  assert.deepEqual((await q("q=serie&kind=series")).items.map(t => t.title).sort(), ["Serie A", "Serie B"]);
  const p1 = await q("q=serie&pageSize=1");
  assert.equal(p1.items.length, 1);
  assert.equal(p1.hasMore, true);
  const p2 = await q("q=serie&pageSize=1&page=2");
  assert.notEqual(p2.items[0].id, p1.items[0].id);
  assert.equal((await q('q=%22%29%20OR%20*')).items.length, 0); // texto raro no rompe la consulta
});

test("reproducción: fuente pedida al proveedor, episodio directo y reproductor externo no declarado", async () => {
  const env = makeEnv();
  const net = providerNet();
  await syncAll(env, net, await addProvider(env, net));
  const list = await titles(env, "movie");
  const m1 = list.find(t => t.title === "La Película Uno");
  const play = await api(env, "GET", `/api/catalog/titles/${m1.id}/play`, { uid: "ana", fetchImpl: net });
  assert.equal(play.status, 200);
  assert.deepEqual(play.body, { url: "https://cdn.prov.ejemplo/m1.m3u8", type: "application/x-mpegurl", provider: "Proveedor simulado" });
  const m3 = list.find(t => t.title === "Ñandú Veloz");
  const embed = await api(env, "GET", `/api/catalog/titles/${m3.id}/play`, { uid: "ana", fetchImpl: net });
  assert.equal(embed.status, 502);
  assert.doesNotMatch(embed.body.error, /otro\.ejemplo/); // el usuario común no ve el detalle técnico
  const serie = (await titles(env, "series")).find(t => t.title === "Serie A");
  const detail = (await api(env, "GET", `/api/catalog/titles/${serie.id}`, { uid: "ana" })).body;
  const ep = detail.seasons[1].episodes[0];
  const epPlay = await api(env, "GET", `/api/catalog/titles/${serie.id}/play?episode=${ep.id}`, { uid: "ana", fetchImpl: net });
  assert.deepEqual(epPlay.body, { url: "https://cdn.prov.ejemplo/a/2/1.m3u8", type: "application/x-mpegurl", provider: "Proveedor simulado" });
  // Un episodio de otra serie no se puede pedir con el id de esta.
  const other = (await titles(env, "movie"))[0];
  assert.equal((await api(env, "GET", `/api/catalog/titles/${other.id}/play?episode=${ep.id}`, { uid: "ana", fetchImpl: net })).status, 502);
});

test("proveedor desactivado: sus títulos dejan de verse y sus trabajos se cancelan", async () => {
  const env = makeEnv({ SYNC_PAGES_PER_RUN: "1" });
  const net = providerNet();
  const id = await addProvider(env, net);
  const job = (await api(env, "POST", `/api/admin/providers/${id}/sync`, { ...OWNER, fetchImpl: net, body: { mode: "full" } })).body.job;
  await api(env, "PATCH", `/api/admin/providers/${id}`, { ...OWNER, body: { enabled: false } });
  assert.equal((await titles(env, "movie")).length, 0);
  const after = (await api(env, "POST", `/api/admin/jobs/${job.id}/continue`, { ...OWNER, fetchImpl: net })).body.job;
  assert.equal(after.status, "cancelled");
});

test("especificación genérica: valida credenciales fuera de 'auth', https, rutas y enlaces a otro servidor", async () => {
  const bad = genericHttp.validate({ baseUrl: "http://api.prov.ejemplo", spec: JSON.stringify({ catalog: { movie: { path: "/m/{apiKey}", map: { id: "id", title: "t" } } } }) });
  assert.ok(bad.some(p => /https/.test(p)));
  assert.ok(bad.some(p => /credenciales/.test(p)));
  assert.ok(genericHttp.validate({ baseUrl: BASE, spec: "{no es json" }).some(p => /JSON/.test(p)));
  assert.ok(genericHttp.validate({ baseUrl: BASE, spec: JSON.stringify({ catalog: { pelis: { path: "/x", map: { id: "a", title: "b" } } } }) }).some(p => /desconocido/.test(p)));
  assert.deepEqual(genericHttp.validate({ baseUrl: BASE, spec: JSON.stringify(SPEC) }), []);
  // Paginación por enlace: un "siguiente" a otro servidor detiene la importación.
  const spec = { catalog: { movie: { path: "/list", items: "items", pagination: { type: "link", next: "next" }, map: { id: "id", title: "t" } } } };
  const ctx = { config: { baseUrl: BASE, spec: JSON.stringify(spec) }, secrets: {}, fetch: async () => new Response(JSON.stringify({ items: [{ id: 1, t: "a" }], next: "https://malo.ejemplo/robar" })) };
  await assert.rejects(genericHttp.listPage(ctx, { kind: "movie" }), /otro servidor/);
  const ctx2 = { ...ctx, fetch: async () => new Response(JSON.stringify({ items: [{ id: 1, t: "a" }], next: `${BASE}/list?after=1` })) };
  assert.deepEqual((await genericHttp.listPage(ctx2, { kind: "movie" })).next, { link: "/v1/list?after=1", n: 1 });
});

test("cron: a las 05:00 crea un trabajo por proveedor diario (no los manuales) y cada 10 minutos los sigue", async () => {
  const env = makeEnv();
  const net = providerNet();
  const daily = await addProvider(env, net);
  const manual = await addProvider(env, net, { label: "Manual" });
  await api(env, "PATCH", `/api/admin/providers/${manual}`, { ...OWNER, body: { schedule: "manual" } });
  const worker = (await import("../worker/src/index.js")).default;
  const realFetch = globalThis.fetch;
  globalThis.fetch = net; // el cron usa el fetch global
  try {
    const run = async cron => { const tasks = []; await worker.scheduled({ cron }, env, { waitUntil: p => tasks.push(p) }); await Promise.all(tasks); };
    await run("*/10 * * * *");
    assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM sync_jobs").get().n, 0, "sin trabajos pendientes no hace nada");
    await run("0 5 * * *");
    const jobs = env.DB.sqlite.prepare("SELECT provider_id, trigger, mode FROM sync_jobs").all();
    assert.deepEqual(jobs.map(j => [j.provider_id, j.trigger, j.mode]), [[daily, "cron", "full"]]); // primera vez: completa
    for (let i = 0; i < 10; i++) await run("*/10 * * * *");
    assert.equal(env.DB.sqlite.prepare("SELECT status FROM sync_jobs").get().status, "done");
    await run("0 5 * * *");
    assert.equal(env.DB.sqlite.prepare("SELECT mode FROM sync_jobs ORDER BY id DESC").get().mode, "incremental");
  } finally {
    globalThis.fetch = realFetch;
  }
});
