// Catálogo central con UNA fuente de contenido: configuración desde Ajustes, credenciales
// (API y reproducción, separadas), importación por tandas, reintentos, duplicados, búsqueda,
// episodios y reproducción. Todo contra un proveedor simulado (sin red).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, api } from "./helpers/api.js";
import { BASE, KEY, PLAY_KEY, SPEC, providerNet, movies } from "./helpers/proveedor-simulado.js";
import genericHttp from "../worker/src/providers/generic-http.js";

const OWNER = { uid: "dueno" };
const FORM = { label: "Fuente de prueba", baseUrl: BASE, spec: JSON.stringify(SPEC), apiKey: KEY, playbackKey: PLAY_KEY, categories: ["movie", "series", "anime", "episodes"] };

// Guarda la fuente como desde Ajustes (prueba la conexión y arranca la importación).
async function saveSource(env, net, body = {}) {
  const r = await api(env, "PUT", "/api/admin/source", { ...OWNER, fetchImpl: net, body: { ...FORM, ...body } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}

// Sigue un trabajo hasta que termine (como lo haría el cron), con un tope de vueltas.
async function finish(env, net, job) {
  for (let i = 0; i < 40 && job && ["queued", "running"].includes(job.status); i++) {
    job = (await api(env, "POST", `/api/admin/jobs/${job.id}/continue`, { ...OWNER, fetchImpl: net })).body.job;
  }
  return job;
}

async function setup(envExtra = {}, netState = {}) {
  const env = makeEnv(envExtra);
  const net = providerNet(netState);
  const saved = await saveSource(env, net);
  const job = await finish(env, net, saved.job);
  return { env, net, saved, job };
}

async function sync(env, net, mode) {
  const r = await api(env, "POST", "/api/admin/source/sync", { ...OWNER, fetchImpl: net, body: { mode } });
  return finish(env, net, r.body.job);
}

const titles = async (env, kind) => (await api(env, "GET", `/api/catalog/titles?kind=${kind}&pageSize=50`, { uid: "ana" })).body.items;
const dump = env => ["logs", "audit", "sync_jobs", "providers"].map(t => JSON.stringify(env.DB.sqlite.prepare(`SELECT * FROM ${t}`).all())).join("");

test("guardar la fuente: prueba las dos credenciales, la activa y arranca la importación completa", async () => {
  const { env, net, saved, job } = await setup();
  assert.equal(saved.test.ok, true, saved.test.message);
  assert.match(saved.test.message, /Catálogo: correcto.*Reproducción: correcta/);
  assert.equal(saved.source.enabled, true);
  assert.equal(job.status, "done", job.lastError);
  assert.equal(job.mode, "full");
  assert.equal(job.created, 5);
  assert.equal(job.episodes, 3);
  const status = (await api(env, "GET", "/api/catalog/status", { uid: "ana" })).body;
  assert.deepEqual([status.available, status.label, status.counts.movie, status.counts.series, status.counts.episodes], [true, "Fuente de prueba", 3, 2, 3]);
  assert.ok(!JSON.stringify(status).includes(BASE), "el estado público no muestra la dirección");
  assert.equal(net.state.playKeyLeaks, 0, "la credencial de reproducción no se manda en las consultas del catálogo");
});

test("credenciales: cifradas, nunca en respuestas, registros, auditoría ni trabajos; vacío conserva y 'borrar' quita", async () => {
  const { env, net } = await setup();
  const view = (await api(env, "GET", "/api/admin/source", OWNER)).body;
  assert.deepEqual(view.source.secretsSet.sort(), ["apiKey", "playbackKey"]);
  const all = JSON.stringify(view) + dump(env);
  for (const secret of [KEY, PLAY_KEY]) assert.ok(!all.includes(secret), "una credencial apareció");
  // Enlace que trae la credencial de reproducción: no se entrega.
  const m2 = (await titles(env, "movie")).find(t => t.title === "Canción de Otoño");
  const play = await api(env, "GET", `/api/catalog/titles/${m2.id}/play`, { uid: "dueno", fetchImpl: net });
  assert.equal(play.status, 502);
  assert.match(play.body.error, /credencial/);
  assert.ok(!dump(env).includes(PLAY_KEY));
  // Guardar con las credenciales vacías las conserva; "borrar" quita solo la elegida.
  await saveSource(env, net, { apiKey: "", playbackKey: "", label: "Renombrada" });
  assert.deepEqual((await api(env, "GET", "/api/admin/source", OWNER)).body.source.secretsSet.sort(), ["apiKey", "playbackKey"]);
  await saveSource(env, net, { apiKey: "", playbackKey: "", clearSecrets: ["playbackKey"] });
  const after = (await api(env, "GET", "/api/admin/source", OWNER)).body.source;
  assert.deepEqual(after.secretsSet, ["apiKey"]);
  assert.equal(after.lastTest.ok, false);
  assert.match(after.lastTest.message, /falta la credencial de reproducción/);
});

test("solo el propietario configura o prueba la fuente", async () => {
  const env = makeEnv();
  const net = providerNet();
  for (const [m, p] of [["GET", "/api/admin/source"], ["PUT", "/api/admin/source"], ["POST", "/api/admin/source/test"], ["POST", "/api/admin/source/sync"]]) {
    assert.equal((await api(env, m, p, { uid: "ana", fetchImpl: net, body: m === "GET" ? null : FORM })).status, 403, `${m} ${p}`);
  }
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM providers").get().n, 0);
});

test("sin SECRETS_KEY el servidor se niega a guardar credenciales", async () => {
  const env = makeEnv({ SECRETS_KEY: "" });
  const r = await api(env, "PUT", "/api/admin/source", { ...OWNER, fetchImpl: providerNet(), body: FORM });
  assert.equal(r.status, 503);
});

test("probar conexión sin guardar: clave de API equivocada y credencial de reproducción equivocada, por separado", async () => {
  const { env, net } = await setup();
  const ok = await api(env, "POST", "/api/admin/source/test", { ...OWNER, fetchImpl: net, body: {} });
  assert.equal(ok.body.ok, true, ok.body.message);
  const badApi = await api(env, "POST", "/api/admin/source/test", { ...OWNER, fetchImpl: net, body: { apiKey: "otra-clave-incorrecta" } });
  assert.equal(badApi.body.ok, false);
  assert.match(badApi.body.message, /^Catálogo: .*401.*credenciales/);
  const badPlay = await api(env, "POST", "/api/admin/source/test", { ...OWNER, fetchImpl: net, body: { playbackKey: "credencial-equivocada" } });
  assert.equal(badPlay.body.ok, false);
  assert.match(badPlay.body.message, /Catálogo: correcto.*Reproducción: .*403/);
  assert.ok(!JSON.stringify([badApi.body, badPlay.body]).match(/otra-clave-incorrecta|credencial-equivocada/));
  // Una prueba con valores sin guardar no cambia el estado guardado.
  assert.equal((await api(env, "GET", "/api/admin/source", OWNER)).body.source.lastTest.ok, true);
});

test("una configuración que falla no activa la fuente ni importa nada", async () => {
  const env = makeEnv();
  const net = providerNet();
  const r = await saveSource(env, net, { apiKey: "clave-equivocada" });
  assert.equal(r.test.ok, false);
  assert.equal(r.source.enabled, false);
  assert.equal(r.job, null);
  assert.equal((await api(env, "GET", "/api/catalog/status", { uid: "ana" })).body.available, false);
});

test("una única fuente activa: guardarla apaga cualquier otro proveedor (sin borrar sus datos)", async () => {
  const env = makeEnv();
  const now = Date.now();
  env.DB.sqlite.exec(`INSERT INTO providers (id, adapter, label, enabled, config_json, created_at, updated_at) VALUES ('viejo', 'http-json', 'Viejo', 1, '{}', ${now}, ${now})`);
  env.DB.sqlite.exec(`INSERT INTO titles (kind, title, title_norm, created_at, updated_at) VALUES ('movie', 'Título viejo', 'titulo viejo', ${now}, ${now})`);
  env.DB.sqlite.exec(`INSERT INTO title_sources (title_id, provider_id, external_id, seen_at) VALUES (last_insert_rowid(), 'viejo', 'v1', ${now})`);
  assert.deepEqual((await titles(env, "movie")).map(t => t.title), ["Título viejo"]);
  const net = providerNet();
  await finish(env, net, (await saveSource(env, net)).job);
  assert.equal(env.DB.sqlite.prepare("SELECT enabled FROM providers WHERE id = 'viejo'").get().enabled, 0);
  assert.ok(!(await titles(env, "movie")).some(t => t.title === "Título viejo"));
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM titles WHERE title = 'Título viejo'").get().n, 1);
});

test("categorías: sin 'series' ni 'episodes' no se importan; se respetan al volver a guardar", async () => {
  const env = makeEnv();
  const net = providerNet();
  const job = await finish(env, net, (await saveSource(env, net, { categories: ["movie"] })).job);
  assert.equal(job.created, 3);
  assert.equal(job.episodes, 0);
  assert.equal((await titles(env, "series")).length, 0);
  assert.equal((await api(env, "PUT", "/api/admin/source", { ...OWNER, fetchImpl: net, body: { ...FORM, categories: [] } })).status, 400);
});

test("importación por tandas: reanudable, recorre todas las páginas y no pasa de 50 consultas a D1 por tanda", async () => {
  const env = makeEnv({ SYNC_PAGES_PER_RUN: "1" });
  const net = providerNet();
  let job = (await saveSource(env, net)).job;
  assert.equal(job.status, "running");
  assert.equal(job.pages, 1);
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
  const one = (await titles(env, "movie")).find(t => t.title === "La Película Uno");
  assert.deepEqual(one.externalIds, { tmdb: 101, tmdbType: "movie", imdb: "tt0000101" });
  assert.equal(one.poster, "https://img.prov.ejemplo/w500/uno.jpg");
  const serie = (await titles(env, "series")).find(t => t.title === "Serie A");
  const detail = (await api(env, "GET", `/api/catalog/titles/${serie.id}`, { uid: "ana" })).body;
  assert.deepEqual(detail.seasons.map(s => [s.number, s.episodes.map(e => e.title)]), [[1, ["Piloto", "Dos"]], [2, ["Vuelta"]]]);
  const logs = (await api(env, "GET", "/api/admin/logs?level=warn", OWNER)).body.logs;
  assert.ok(logs.some(l => /Episodios del título/.test(l.message) && /404/.test(l.message)));
});

test("páginas grandes no se recortan: se importan todos los títulos", async () => {
  const many = Array.from({ length: 450 }, (_, i) => ({ id: `g${i}`, title: `Título ${i}`, release_date: "2000" }));
  const { job, env } = await setup({}, { moviesFn: page => (page === 1 ? many : []) });
  assert.equal(job.status, "done", job.lastError);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM title_sources WHERE external_id LIKE 'g%'").get().n, 450);
});

test("una ejecución que se corta varias veces sin avanzar deja el trabajo fallido con una explicación", async () => {
  const env = makeEnv({ SYNC_PAGES_PER_RUN: "1" });
  const net = providerNet();
  const job = (await saveSource(env, net)).job;
  // Simula ejecuciones que tomaron el trabajo y murieron sin guardar (candado vencido, stalls altos).
  env.DB.sqlite.exec(`UPDATE sync_jobs SET stalls = 6, locked_until = 0 WHERE id = ${job.id}`);
  const after = (await api(env, "POST", `/api/admin/jobs/${job.id}/continue`, { ...OWNER, fetchImpl: net })).body.job;
  assert.equal(after.status, "failed");
  assert.match(after.lastError, /límite de CPU/);
  assert.ok((await titles(env, "movie")).length > 0, "lo ya importado se conserva");
});

test("reintentos: una falla temporal (503) se reintenta y el trabajo termina", async () => {
  const { env, net } = await setup();
  net.state.failMovies = 2;
  const first = (await api(env, "POST", "/api/admin/source/sync", { ...OWNER, fetchImpl: net, body: { mode: "full" } })).body.job;
  assert.equal(first.status, "running");
  assert.equal(first.attempts, 1);
  assert.ok(first.nextRunAt > Date.now() + 50000, "espera antes del reintento");
  assert.match(first.lastError, /503/);
  const job = await finish(env, net, first);
  assert.equal(job.status, "done");
});

test("reintentos: después de 5 intentos el trabajo falla y los datos existentes se mantienen", async () => {
  const { env, net } = await setup();
  const before = (await titles(env, "movie")).length;
  net.state.failMovies = 999;
  const job = await sync(env, net, "full");
  assert.equal(job.status, "failed");
  assert.equal(job.attempts, 5);
  assert.equal((await titles(env, "movie")).length, before, "un error de sincronización no borra ni oculta lo importado");
  const status = (await api(env, "GET", "/api/catalog/status", { uid: "ana" })).body;
  assert.equal(status.available, true);
  assert.equal(status.failing, true);
});

test("duplicados dentro de la fuente: el mismo TMDb o IMDb en otro elemento se une al título existente", async () => {
  const env = makeEnv();
  const net = providerNet({ moviesFn: page => (page === 1 ? [
    { id: "a", title: "Original", release_date: "1999", ids: { tmdb: 101, imdb: "tt0000101" } },
    { id: "b", title: "Copia con otro id", ids: { tmdb: 101 } },
    { id: "c", title: "Otra", ids: { imdb: "tt0000555" } }
  ] : page === 2 ? [
    { id: "d", title: "Misma por IMDb", ids: { imdb: "tt0000555" } }
  ] : []) });
  const job = await finish(env, net, (await saveSource(env, net, { categories: ["movie"] })).job);
  assert.equal(job.created, 2);
  assert.equal(job.merged, 2);
  assert.deepEqual((await titles(env, "movie")).map(t => t.title).sort(), ["Original", "Otra"]);
});

test("incremental: pide solo cambios (since), no reescribe lo igual y actualiza lo cambiado", async () => {
  const { env, net } = await setup();
  net.calls.length = 0;
  net.state.moviesFn = page => movies(page).map(m => (m.id === "m1" ? { ...m, overview: "Sinopsis nueva." } : m));
  const job = await sync(env, net, "incremental");
  assert.equal(job.mode, "incremental");
  assert.ok(net.calls.some(c => new URL(c.url).searchParams.get("changed_since")));
  assert.equal(job.updated, 1);
  assert.equal(job.unchanged, 4);
  assert.equal((await titles(env, "movie")).find(t => t.title === "La Película Uno").description, "Sinopsis nueva.");
});

test("completa otra vez: lo que la fuente ya no ofrece se oculta, pero no se borra", async () => {
  const { env, net } = await setup();
  net.state.moviesFn = page => movies(page).filter(m => m.id !== "m3");
  assert.equal((await sync(env, net, "full")).status, "done");
  assert.deepEqual((await titles(env, "movie")).map(t => t.title).sort(), ["Canción de Otoño", "La Película Uno"]);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM titles WHERE title = 'Ñandú Veloz'").get().n, 1);
});

test("búsqueda remota paginada: sin acentos, por palabras y por tipo", async () => {
  const { env } = await setup();
  const q = async s => (await api(env, "GET", `/api/catalog/search?${s}`, { uid: "ana" })).body;
  assert.deepEqual((await q("q=nandu")).items.map(t => t.title), ["Ñandú Veloz"]);
  assert.deepEqual((await q("q=Cancion%20oto")).items.map(t => t.title), ["Canción de Otoño"]);
  assert.deepEqual((await q("q=serie&kind=series")).items.map(t => t.title).sort(), ["Serie A", "Serie B"]);
  const p1 = await q("q=serie&pageSize=1");
  assert.equal(p1.hasMore, true);
  assert.notEqual((await q("q=serie&pageSize=1&page=2")).items[0].id, p1.items[0].id);
  assert.equal((await q("q=%22%29%20OR%20*")).items.length, 0);
});

test("reproducción: el enlace se pide con la credencial de reproducción; episodio directo; iframe no declarado", async () => {
  const { env, net } = await setup();
  const list = await titles(env, "movie");
  const m1 = list.find(t => t.title === "La Película Uno");
  net.calls.length = 0;
  const play = await api(env, "GET", `/api/catalog/titles/${m1.id}/play`, { uid: "ana", fetchImpl: net });
  assert.deepEqual(play.body, { url: "https://cdn.prov.ejemplo/m1.m3u8", type: "application/x-mpegurl", provider: "Fuente de prueba" });
  const call = net.calls.find(c => c.url.includes("/play/"));
  assert.equal(call.init.headers["X-Play-Token"], PLAY_KEY);
  const embed = await api(env, "GET", `/api/catalog/titles/${list.find(t => t.title === "Ñandú Veloz").id}/play`, { uid: "ana", fetchImpl: net });
  assert.equal(embed.status, 502);
  assert.doesNotMatch(embed.body.error, /otro\.ejemplo/);
  const serie = (await titles(env, "series")).find(t => t.title === "Serie A");
  const ep = (await api(env, "GET", `/api/catalog/titles/${serie.id}`, { uid: "ana" })).body.seasons[1].episodes[0];
  const epPlay = await api(env, "GET", `/api/catalog/titles/${serie.id}/play?episode=${ep.id}`, { uid: "ana", fetchImpl: net });
  assert.equal(epPlay.body.url, "https://cdn.prov.ejemplo/a/2/1.m3u8");
  assert.equal((await api(env, "GET", `/api/catalog/titles/${m1.id}/play?episode=${ep.id}`, { uid: "ana", fetchImpl: net })).status, 502);
});

test("especificación: cada credencial solo en su lugar; https; rutas; enlaces a otro servidor", async () => {
  const check = spec => genericHttp.validate({ baseUrl: BASE, spec: JSON.stringify(spec) });
  const base = { catalog: { movie: { path: "/m", map: { id: "id", title: "t" } } }, resolve: { path: "/p/{id}", url: "u" } };
  assert.ok(check({ ...base, auth: [{ in: "header", name: "X", value: "{playbackKey}" }] }).some(p => /reproducción va solo en "playbackAuth"/.test(p)));
  assert.ok(check({ ...base, playbackAuth: [{ in: "header", name: "X", value: "{apiKey}" }] }).some(p => /solo va la credencial de reproducción/.test(p)));
  assert.ok(check({ catalog: base.catalog, playbackAuth: [{ in: "header", name: "X", value: "{playbackKey}" }] }).some(p => /necesita "resolve"/.test(p)));
  assert.ok(check({ ...base, catalog: { movie: { path: "/m/{playbackKey}", map: { id: "id", title: "t" } } } }).some(p => /credenciales/.test(p)));
  const bad = genericHttp.validate({ baseUrl: "http://api.prov.ejemplo", spec: JSON.stringify(base) });
  assert.ok(bad.some(p => /https/.test(p)));
  assert.deepEqual(check(SPEC), []);
  const spec = { catalog: { movie: { path: "/list", items: "items", pagination: { type: "link", next: "next" }, map: { id: "id", title: "t" } } } };
  const ctx = { config: { baseUrl: BASE, spec: JSON.stringify(spec) }, secrets: {}, fetch: async () => new Response(JSON.stringify({ items: [{ id: 1, t: "a" }], next: "https://malo.ejemplo/robar" })) };
  await assert.rejects(genericHttp.listPage(ctx, { kind: "movie" }), /otro servidor/);
});

test("cron: a las 05:00 crea el trabajo incremental de la fuente y cada minuto lo sigue hasta terminar", async () => {
  const { env, net } = await setup();
  const worker = (await import("../worker/src/index.js")).default;
  const realFetch = globalThis.fetch;
  globalThis.fetch = net;
  try {
    const run = async cron => { const tasks = []; await worker.scheduled({ cron }, env, { waitUntil: p => tasks.push(p) }); await Promise.all(tasks); };
    const count = () => env.DB.sqlite.prepare("SELECT COUNT(*) n FROM sync_jobs").get().n;
    const n0 = count();
    await run("* * * * *");
    assert.equal(count(), n0, "sin trabajos pendientes no hace nada");
    await run("0 5 * * *");
    const job = env.DB.sqlite.prepare("SELECT * FROM sync_jobs ORDER BY id DESC").get();
    assert.deepEqual([job.trigger, job.mode], ["cron", "incremental"]);
    for (let i = 0; i < 10; i++) await run("* * * * *");
    assert.equal(env.DB.sqlite.prepare("SELECT status FROM sync_jobs ORDER BY id DESC").get().status, "done");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("guardar sin cambios (aunque la especificación venga con otro formato) no vuelve a importar todo", async () => {
  const { env, net } = await setup();
  const jobs = () => env.DB.sqlite.prepare("SELECT COUNT(*) n FROM sync_jobs").get().n;
  const before = jobs();
  const again = await saveSource(env, net, { spec: JSON.stringify(SPEC, null, 2), apiKey: "", playbackKey: "" });
  assert.equal(again.test.ok, true);
  assert.equal(again.job, null);
  assert.equal(jobs(), before);
  const changed = await saveSource(env, net, { baseUrl: BASE + "/", apiKey: "", playbackKey: "" });
  assert.notEqual(changed.job, null, "un cambio en la dirección sí vuelve a importar");
});

test("especificación incorporada al adaptador: Ajustes no la pide, no se manda al navegador y la del formulario se ignora", async t => {
  const { setBuiltInSpecForTests } = await import("../worker/src/providers/fuente-spec.js");
  setBuiltInSpecForTests(SPEC);
  t.after(() => setBuiltInSpecForTests(undefined));
  const env = makeEnv();
  const net = providerNet();
  const { spec, ...withoutSpec } = FORM;
  const saved = await saveSource(env, net, { ...withoutSpec, spec: undefined });
  assert.equal(saved.test.ok, true, saved.test.message);
  assert.equal(saved.source.builtInSpec, true);
  assert.equal(saved.source.spec, "");
  assert.equal((await finish(env, net, saved.job)).status, "done");
  // Una especificación mandada desde el navegador no reemplaza a la incorporada.
  const again = await saveSource(env, net, { ...withoutSpec, apiKey: "", playbackKey: "", spec: JSON.stringify({ catalog: { movie: { path: "/otra", map: { id: "x", title: "y" } } } }) });
  assert.equal(again.test.ok, true, again.test.message);
  assert.equal(again.job, null, "no cambió nada estructural");
  const view = JSON.stringify((await api(env, "GET", "/api/admin/source", OWNER)).body);
  assert.ok(!view.includes("/movies") && !view.includes("playbackAuth"), "la especificación no llega al navegador");
});

test("sin especificación incorporada ni en el formulario, la fuente no se puede guardar (no se inventan rutas)", async () => {
  const env = makeEnv();
  const { spec, ...withoutSpec } = FORM;
  const r = await api(env, "PUT", "/api/admin/source", { ...OWNER, fetchImpl: providerNet(), body: withoutSpec });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Especificación/);
});
