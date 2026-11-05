// Etapa de preparación: paginación por endpoint, límites persistentes, estados de importación,
// bajas de episodios, prioridades entre fuentes, inicio de sesión y subtítulos.
// Todo con APIs SIMULADAS (no existen, no imitan a ninguna real).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, api, fakeNet } from "./helpers/api.js";
import { emptyForm } from "./helpers/fuentes-simuladas.js";
import { srtToVtt, isSrt } from "../src/player/subtitles.js";

const OWNER = { uid: "dueno" };
const BASE = "https://api.e.ejemplo/v1";
const BASE_F = "https://api.f.ejemplo";
const KEY = "clave-simulada-e";

const formE = over => ({ ...emptyForm(), displayName: "Opción E", baseUrl: BASE, authType: "apiKeyHeader", apiKeyName: "X-Key", "map.id": "id", "map.title": "name", ...over });
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

async function configure(env, net, slot, form, secrets = { apiKey: KEY }) {
  const s = await api(env, "PUT", `/api/admin/sources/${slot}`, { ...OWNER, fetchImpl: net, body: { form, secrets } });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const on = await api(env, "POST", `/api/admin/sources/${slot}/enable`, { ...OWNER, fetchImpl: net, body: { enabled: true } });
  assert.equal(on.status, 200, JSON.stringify(on.body));
}
const startImport = async (env, net, slot = "a", mode = "full") => (await api(env, "POST", `/api/admin/sources/${slot}/import`, { ...OWNER, fetchImpl: net, body: { mode } })).body.job;
const step = async (env, net, job) => (await api(env, "POST", `/api/admin/jobs/${job.id}/continue`, { ...OWNER, fetchImpl: net })).body.job;
async function finish(env, net, job) {
  for (let i = 0; i < 100 && job && ["queued", "running"].includes(job.status) && !job.paused; i++) job = await step(env, net, job);
  return job;
}
const list = async (env, kind) => (await api(env, "GET", `/api/catalog/titles?kind=${kind}&pageSize=300`, { uid: "ana" })).body.items;
const detail = async (env, id) => (await api(env, "GET", `/api/catalog/titles/${id}`, { uid: "ana" })).body;

// ---------- 1. paginación independiente por endpoint ----------

test("una fuente con dos endpoints que paginan distinto (página y enlace) importa todo y queda COMPLETA", async () => {
  const movies = Array.from({ length: 7 }, (_, i) => ({ id: `m${i}`, name: `Película ${i}` }));
  const net = fakeNet({
    [`${BASE}/movies`]: u => { const p = Number(u.searchParams.get("p") || 1); return { data: movies.slice((p - 1) * 3, p * 3), meta: { pages: 3 } }; },
    [`${BASE}/shows`]: u => { const n = Number(u.searchParams.get("n") || 1); return { results: [{ id: `s${n}`, name: `Serie ${n}` }], links: { next: n < 4 ? `${BASE}/shows?n=${n + 1}` : null } }; }
  });
  const env = makeEnv();
  await configure(env, net, "a", formE({ "cat.movie": true, "cat.series": true,
    "ep.movie.path": "/movies", "ep.movie.items": "data", "ep.movie.page.type": "page", "ep.movie.page.param": "p", "ep.movie.page.totalPagesPath": "meta.pages",
    "ep.series.path": "/shows", "ep.series.items": "results", "ep.series.page.type": "link", "ep.series.page.nextPath": "links.next" }));
  const job = await finish(env, net, await startImport(env, net));
  assert.equal(job.status, "done", job.lastError);
  assert.equal(job.outcome, "complete", job.outcomeDetail);
  assert.equal((await list(env, "movie")).length, 7);
  assert.equal((await list(env, "series")).length, 4);
});

test("límite de páginas o registros alcanzado: la importación queda PARCIAL, nunca completa, y no da de baja nada", async () => {
  let total = 10;
  const net = fakeNet({ [`${BASE}/movies`]: u => { const o = Number(u.searchParams.get("o") || 0); return { items: Array.from({ length: total }, (_, i) => ({ id: `m${i}`, name: `P${i}` })).slice(o, o + 2), total }; } });
  const env = makeEnv();
  await configure(env, net, "a", formE({ "cat.movie": true, "ep.movie.path": "/movies", "ep.movie.items": "items",
    "ep.movie.page.type": "offset", "ep.movie.page.param": "o", "ep.movie.page.size": "2", "ep.movie.page.totalResultsPath": "total" }));
  assert.equal((await finish(env, net, await startImport(env, net))).outcome, "complete");
  await api(env, "PUT", "/api/admin/sources/a", { ...OWNER, fetchImpl: net, body: { form: formE({ "cat.movie": true, "ep.movie.path": "/movies", "ep.movie.items": "items",
    "ep.movie.page.type": "offset", "ep.movie.page.param": "o", "ep.movie.page.size": "2", "ep.movie.page.totalResultsPath": "total", "ep.movie.page.maxPages": "2" }) } });
  const job = await finish(env, net, await startImport(env, net));
  assert.equal(job.outcome, "partial");
  assert.match(job.outcomeDetail, /máximo de páginas/);
  assert.equal((await list(env, "movie")).length, 10, "lo no recorrido NO se ocultó");
  const view = (await api(env, "GET", "/api/admin/sources", OWNER)).body.sources.a;
  assert.equal(view.lastStatus, "partial");
});

test("respuesta sin la lista esperada: 'falla' o 'parcial' según el endpoint", async () => {
  const net = fakeNet({ [`${BASE}/movies`]: () => ({ error: "formato inesperado" }) });
  const env = makeEnv();
  await configure(env, net, "a", formE({ "cat.movie": true, "ep.movie.path": "/movies", "ep.movie.items": "items" }));
  assert.equal((await finish(env, net, await startImport(env, net))).status, "failed");
  await api(env, "PUT", "/api/admin/sources/a", { ...OWNER, fetchImpl: net, body: { form: formE({ "cat.movie": true, "ep.movie.path": "/movies", "ep.movie.items": "items", "ep.movie.page.onInvalid": "partial" }) } });
  const job = await finish(env, net, await startImport(env, net));
  assert.equal(job.status, "done");
  assert.equal(job.outcome, "partial");
});

// ---------- 2. límites de frecuencia persistentes ----------

test("una fuente que responde 429 con Retry-After: el trabajo se pospone sin gastar reintentos y la espera se respeta entre tandas", async () => {
  let limited = true, calls = 0;
  const net = async url => {
    calls++;
    if (limited) return json({ error: "too many" }, 429, { "Retry-After": "120" });
    return json({ items: [{ id: "m1", name: "Uno" }] });
  };
  const env = makeEnv();
  await configure(env, net, "a", formE({ "cat.movie": true, "ep.movie.path": "/movies", "ep.movie.items": "items", "rate.honorRetryAfter": true, "rate.on429": "wait" }));
  const job = await startImport(env, net);
  assert.equal(job.status, "running");
  assert.equal(job.attempts, 0, "un 429 con 'esperar' no gasta reintentos");
  assert.ok(job.nextRunAt > Date.now() + 100e3 && job.nextRunAt < Date.now() + 125e3, "pospuesto ~120 s");
  const state = env.DB.sqlite.prepare("SELECT next_at FROM provider_state WHERE provider_id = 'fuente-a'").get();
  assert.ok(state.next_at > Date.now() + 100e3, "la espera quedó guardada en la base");
  // Otra tanda antes de tiempo (aunque se fuerce con "Continuar") NO consulta a la fuente.
  limited = false;
  const before = calls;
  const again = await step(env, net, job);
  assert.equal(calls, before, "no se hizo ninguna solicitud antes de la hora permitida");
  assert.equal(again.status, "running");
  const logs = (await api(env, "GET", "/api/admin/logs?level=info", OWNER)).body.logs;
  assert.ok(logs.some(l => l.scope === "rate" && /pospuestas/.test(l.message)), "queda registrado");
  // Pasada la espera, sigue.
  env.DB.sqlite.exec("UPDATE provider_state SET next_at = 0, window_count = 0");
  assert.equal((await finish(env, net, again)).outcome, "complete");
});

test("una fuente que exige espera entre solicitudes y un máximo por ventana: se respeta entre tandas (persistente)", async () => {
  let calls = 0;
  const net = async url => { calls++; const o = Number(new URL(url).searchParams.get("o") || 0); return json({ items: [{ id: `m${o}`, name: `P${o}` }], total: 6 }); };
  const env = makeEnv({ SYNC_PAGES_PER_RUN: "10" });
  await configure(env, net, "a", formE({ "cat.movie": true, "ep.movie.path": "/movies", "ep.movie.items": "items",
    "ep.movie.page.type": "offset", "ep.movie.page.param": "o", "ep.movie.page.size": "1", "ep.movie.page.totalResultsPath": "total",
    "rate.windowSec": "3600", "rate.windowMax": "2" }));
  const job = await startImport(env, net);
  assert.equal(calls, 2, "solo 2 solicitudes por ventana");
  assert.ok(job.nextRunAt > Date.now() + 3000e3, "la siguiente tanda queda para cuando se abra la ventana");
  await step(env, net, job);
  assert.equal(calls, 2, "una tanda nueva tampoco consulta antes de tiempo");
  // Intervalo mínimo entre solicitudes.
  const env2 = makeEnv({ SYNC_PAGES_PER_RUN: "10" });
  let calls2 = 0;
  const net2 = async url => { calls2++; return net(url); };
  await configure(env2, net2, "a", formE({ "cat.movie": true, "ep.movie.path": "/movies", "ep.movie.items": "items",
    "ep.movie.page.type": "offset", "ep.movie.page.param": "o", "ep.movie.page.size": "1", "ep.movie.page.totalResultsPath": "total", minIntervalMs: "60000" }));
  const j2 = await startImport(env2, net2);
  assert.equal(calls2, 1);
  await step(env2, net2, j2);
  assert.equal(calls2, 1, "el intervalo mínimo se respeta en la tanda siguiente");
});

test("un trabajo que se reinicia antes de terminar: el anterior queda cancelado y el nuevo completa sin perder nada", async () => {
  const net = fakeNet({ [`${BASE}/movies`]: u => { const p = Number(u.searchParams.get("p") || 1); return { items: p <= 4 ? [{ id: `m${p}`, name: `P${p}` }] : [], pages: 4 }; } });
  const env = makeEnv({ SYNC_PAGES_PER_RUN: "1" });
  await configure(env, net, "a", formE({ "cat.movie": true, "ep.movie.path": "/movies", "ep.movie.items": "items", "ep.movie.page.type": "page", "ep.movie.page.param": "p", "ep.movie.page.totalPagesPath": "pages" }));
  const first = await startImport(env, net);
  await step(env, net, first);
  const restarted = (await api(env, "POST", "/api/admin/sources/a/restart", { ...OWNER, fetchImpl: net, body: { confirm: true } })).body.source.activeJob;
  const job = await finish(env, net, restarted);
  assert.equal(job.outcome, "complete");
  assert.equal(env.DB.sqlite.prepare(`SELECT status FROM sync_jobs WHERE id = ${first.id}`).get().status, "cancelled");
  assert.equal((await list(env, "movie")).length, 4);
});

// ---------- 3. episodios ausentes ----------

function episodesApi(state) {
  return fakeNet({
    [`${BASE}/shows/1/episodes`]: () => (state.fail ? { __status: 404, body: { e: 1 } } : { items: state.eps.map(n => ({ id: `e${n}`, s: 1, n, name: `Episodio ${n}` })) }),
    [`${BASE}/shows`]: () => ({ items: [{ id: "1", name: "Serie Uno", tmdb: 7001 }] })
  });
}
const showForm = over => formE({ "cat.series": true, "cat.episodes": true, "ep.series.path": "/shows", "ep.series.items": "items", "map.tmdb": "tmdb",
  "ep.episodes.path": "/shows/{id}/episodes", "ep.episodes.items": "items", "epmap.id": "id", "epmap.season": "s", "epmap.number": "n", "epmap.title": "name", ...over });

test("una importación PARCIAL no marca episodios como ausentes", async () => {
  const st = { eps: [1, 2, 3, 4, 5] };
  const net = episodesApi(st);
  const env = makeEnv();
  await configure(env, net, "a", showForm());
  await finish(env, net, await startImport(env, net));
  st.fail = true; // los episodios de la serie no se pueden consultar
  const job = await finish(env, net, await startImport(env, net));
  assert.equal(job.outcome, "partial");
  assert.match(job.outcomeDetail, /episodios/);
  const s = (await list(env, "series"))[0];
  assert.equal((await detail(env, s.id)).seasons[0].episodes.length, 5);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM episode_sources WHERE removed = 1").get().n, 0);
});

test("una importación COMPLETA detecta episodios ausentes; si otra fuente los tiene, siguen visibles", async () => {
  const st = { eps: [1, 2, 3, 4, 5] };
  const netE = episodesApi(st);
  const netF = fakeNet({
    [`${BASE_F}/series/x/eps`]: () => ({ list: [{ code: "f5", season: 1, ep: 5, t: "Episodio cinco (F)" }] }),
    [`${BASE_F}/series`]: () => ({ list: [{ code: "x", label: "Serie Uno (F)", tmdb: 7001 }] })
  });
  const net = (url, init) => (String(url).startsWith(BASE_F) ? netF(url, init) : netE(url, init));
  const env = makeEnv();
  await configure(env, net, "a", showForm({ "safety.removalPercent": "50", "safety.removalMin": "0" }));
  await configure(env, net, "b", { ...emptyForm(), displayName: "Opción F", baseUrl: BASE_F, authType: "none", "cat.series": true, "cat.episodes": true,
    "ep.series.path": "/series", "ep.series.items": "list", "map.id": "code", "map.title": "label", "map.tmdb": "tmdb",
    "ep.episodes.path": "/series/{id}/eps", "ep.episodes.items": "list", "epmap.id": "code", "epmap.season": "season", "epmap.number": "ep", "epmap.title": "t" }, {});
  await finish(env, net, await startImport(env, net, "a"));
  await finish(env, net, await startImport(env, net, "b"));
  st.eps = [1, 2, 3]; // la fuente A ya no ofrece los episodios 4 y 5
  const job = await finish(env, net, await startImport(env, net, "a"));
  assert.equal(job.outcome, "complete", job.outcomeDetail);
  assert.match(job.outcomeDetail, /2 episodio\(s\) marcados/);
  const s = (await list(env, "series"))[0];
  assert.deepEqual((await detail(env, s.id)).seasons[0].episodes.map(e => e.number), [1, 2, 3, 5], "el 4 ya no está en ninguna; el 5 sigue por la otra fuente");
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM episodes").get().n, 5, "nada se borró físicamente");
});

test("respuestas vacías anormales: una serie que de golpe devuelve cero episodios no da de baja nada; el umbral se configura", async () => {
  const st = { eps: Array.from({ length: 30 }, (_, i) => i + 1) };
  const net = episodesApi(st);
  const env = makeEnv();
  await configure(env, net, "a", showForm());
  await finish(env, net, await startImport(env, net));
  st.eps = [];
  await finish(env, net, await startImport(env, net));
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM episode_sources WHERE removed = 1").get().n, 0);
  st.eps = Array.from({ length: 5 }, (_, i) => i + 1); // faltarían 25 de 30 (83%): por encima del umbral (10%)
  const job = await finish(env, net, await startImport(env, net));
  assert.equal(job.outcome, "partial");
  assert.match(job.outcomeDetail, /ausencias anormales/);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM episode_sources WHERE removed = 1").get().n, 0);
  // Con el umbral subido a 90% (y si las bajas son reales), se marcan.
  await api(env, "PUT", "/api/admin/sources/a", { ...OWNER, fetchImpl: net, body: { form: showForm({ "safety.removalPercent": "90" }) } });
  assert.equal((await finish(env, net, await startImport(env, net))).outcome, "complete");
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM episode_sources WHERE removed = 1").get().n, 25);
});

// ---------- 4. prioridades entre fuentes ----------

function twoSourcesSameTitle(n = 1) {
  const items = (prefix, desc, poster) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: `Título ${i}`, tmdb: 5000 + i, desc: desc(i), poster: poster(i) }));
  const netE = fakeNet({ [`${BASE}/movies`]: () => ({ items: items("e", i => `Sinopsis de E ${i}`, () => "") }) });
  const netF = fakeNet({ [`${BASE_F}/films`]: () => ({ list: items("f", i => `Sinopsis de F ${i}`, i => `https://img.f.ejemplo/${i}.jpg`).map(x => ({ ...x, name: `Título F ${x.id}` })) }) });
  return (url, init) => (String(url).startsWith(BASE_F) ? netF(url, init) : netE(url, init));
}
async function setupTwo(n = 1) {
  const net = twoSourcesSameTitle(n);
  const env = makeEnv({ SYNC_PAGES_PER_RUN: "5" });
  const mapped = { "cat.movie": true, "map.tmdb": "tmdb", "map.description": "desc", "map.poster": "poster" };
  await configure(env, net, "a", formE({ ...mapped, "ep.movie.path": "/movies", "ep.movie.items": "items" }));
  await configure(env, net, "b", { ...emptyForm(), displayName: "Opción F", baseUrl: BASE_F, authType: "none", "map.id": "id", "map.title": "name", ...mapped, "ep.movie.path": "/films", "ep.movie.items": "list" }, {});
  await finish(env, net, await startImport(env, net, "b")); // B importa PRIMERO
  await finish(env, net, await startImport(env, net, "a"));
  return { env, net };
}

test("dos fuentes con datos distintos para el mismo título: manda la prioridad (A por defecto), no la primera que importó; un campo vacío no borra", async () => {
  const { env } = await setupTwo();
  const [t] = await list(env, "movie");
  assert.equal(t.title, "Título 0", "título de A (prioridad), aunque B importó primero");
  assert.equal(t.description, "Sinopsis de E 0");
  assert.equal(t.poster, "https://img.f.ejemplo/0.jpg", "A no tiene póster: se usa el de B");
});

test("cambio de prioridades: guardar no cambia datos; vista previa; aplicar exige confirmación y queda auditado", async () => {
  const { env, net } = await setupTwo(3);
  const before = (await list(env, "movie")).map(t => t.description).sort();
  const prio = { description: ["fuente-b", "fuente-a"], title: ["fuente-b", "fuente-a"] };
  assert.equal((await api(env, "PUT", "/api/admin/priorities", { ...OWNER, body: { priorities: prio } })).status, 200);
  assert.deepEqual((await list(env, "movie")).map(t => t.description).sort(), before, "guardar NO cambió datos");
  const preview = (await api(env, "POST", "/api/admin/priorities/preview", { ...OWNER, body: {} })).body;
  assert.equal(preview.changedTitles, 3);
  assert.deepEqual(preview.fieldCounts, { title: 3, description: 3 });
  assert.match(preview.examples[0].changes.description[1], /Sinopsis de F/);
  assert.deepEqual((await list(env, "movie")).map(t => t.description).sort(), before, "la vista previa NO cambió datos");
  assert.equal((await api(env, "POST", "/api/admin/priorities/apply", { ...OWNER, body: {} })).status, 400, "sin confirmación no aplica");
  const applied = (await api(env, "POST", "/api/admin/priorities/apply", { ...OWNER, body: { confirm: true } })).body.job;
  let job = applied;
  for (let i = 0; i < 10 && job.status === "running"; i++) job = (await api(env, "POST", "/api/admin/priorities/continue", OWNER)).body.job;
  assert.equal(job.status, "done");
  assert.ok((await list(env, "movie")).every(t => /Sinopsis de F/.test(t.description) && /Título F/.test(t.title)));
  const actions = (await api(env, "GET", "/api/admin/audit", OWNER)).body.audit.map(a => a.action);
  for (const a of ["priority-save", "priority-apply", "priority-applied"]) assert.ok(actions.includes(a), a);
  // Las importaciones siguientes usan la prioridad nueva.
  await finish(env, net, await startImport(env, net, "a"));
  assert.ok((await list(env, "movie")).every(t => /Sinopsis de F/.test(t.description)));
});

test("interrupción y reanudación de una actualización masiva de prioridades", async () => {
  const { env } = await setupTwo(200); // más de una tanda (150)
  await api(env, "PUT", "/api/admin/priorities", { ...OWNER, body: { priorities: { description: ["fuente-b", "fuente-a"] } } });
  const first = (await api(env, "POST", "/api/admin/priorities/apply", { ...OWNER, body: { confirm: true } })).body.job;
  assert.equal(first.status, "running");
  assert.equal(first.processed, 150);
  // Simula una ejecución que se cortó con el candado tomado: al vencer, se reanuda donde quedó.
  env.DB.sqlite.exec(`UPDATE maint_jobs SET locked_until = ${Date.now() + 60000}`);
  assert.equal((await api(env, "POST", "/api/admin/priorities/continue", OWNER)).body.job.processed, 150, "con el candado tomado no avanza");
  env.DB.sqlite.exec("UPDATE maint_jobs SET locked_until = 0");
  let job = first;
  for (let i = 0; i < 10 && job.status === "running"; i++) job = (await api(env, "POST", "/api/admin/priorities/continue", OWNER)).body.job;
  assert.equal(job.status, "done");
  assert.equal(job.processed, 200);
  assert.ok((await list(env, "movie")).every(t => /Sinopsis de F/.test(t.description)));
});

// ---------- 6. autenticación con inicio de sesión ----------

function loginApi(state) {
  return fakeNet({
    [`${BASE}/auth/login`]: (u, init) => {
      state.logins++;
      const body = JSON.parse(init.body);
      if (body.user !== "usuario-de-prueba" || body.pass !== "contraseña-de-prueba") return { __status: 401, body: { error: "bad" } };
      state.token = `token-${state.logins}`;
      return { session: { token: state.token, expires_in: state.ttl ?? 3600 } };
    },
    [`${BASE}/movies`]: (u, init) => (init.headers.Authorization === `Bearer ${state.token}` && !state.revoked ? { items: [{ id: "m1", name: "Uno" }] } : (state.revoked = false, { __status: 401, body: { e: "token" } })),
    [`${BASE}/play/`]: (u, init) => (init.headers.Authorization === `Bearer ${state.token}` ? { url: "https://cdn.e.ejemplo/m1.mp4" } : { __status: 401, body: {} })
  });
}
const loginForm = over => formE({ authType: "login", "login.path": "/auth/login", "login.userField": "user", "login.passField": "pass", "login.tokenPath": "session.token", "login.expiresPath": "session.expires_in",
  "cat.movie": true, "ep.movie.path": "/movies", "ep.movie.items": "items", ...over });

test("errores de autenticación: un inicio de sesión rechazado falla con un mensaje claro y sin mostrar credenciales", async () => {
  const st = { logins: 0 };
  const net = loginApi(st);
  const env = makeEnv();
  await configure(env, net, "a", loginForm(), { username: "usuario-de-prueba", password: "contraseña-mala" });
  const r = (await api(env, "POST", "/api/admin/sources/a/test-connection", { ...OWNER, fetchImpl: net })).body;
  assert.equal(r.ok, false);
  assert.match(r.message, /inicio de sesión fue rechazado/);
  assert.ok(!JSON.stringify(r).includes("contraseña-mala"));
  assert.equal(env.DB.sqlite.prepare("SELECT token_enc FROM provider_state").get()?.token_enc || "", "");
});

test("renovación de tokens: el token se guarda cifrado, se reutiliza y se renueva ante un 401", async () => {
  const st = { logins: 0 };
  const net = loginApi(st);
  const env = makeEnv();
  await configure(env, net, "a", loginForm({ "play.mode": "api", "play.apiPath": "/play/{id}", "play.urlPath": "url" }), { username: "usuario-de-prueba", password: "contraseña-de-prueba" });
  assert.equal((await api(env, "POST", "/api/admin/sources/a/test-connection", { ...OWNER, fetchImpl: net })).body.ok, true);
  assert.equal(st.logins, 1);
  const row = env.DB.sqlite.prepare("SELECT token_enc, token_expires_at FROM provider_state").get();
  assert.match(row.token_enc, /^v1:/);
  assert.ok(!row.token_enc.includes("token-1"), "token cifrado");
  assert.ok(row.token_expires_at > Date.now() + 3500e3);
  // Se reutiliza (no vuelve a iniciar sesión).
  await finish(env, net, await startImport(env, net));
  assert.equal(st.logins, 1);
  // La fuente invalida el token: 401 → nuevo inicio de sesión y reintento.
  st.revoked = true;
  const job = await finish(env, net, await startImport(env, net));
  assert.equal(job.status, "done", job.lastError);
  assert.equal(st.logins, 2);
  // Reproducción con el token de sesión; el token nunca llega al navegador ni a los registros.
  const [m] = await list(env, "movie");
  const play = (await api(env, "GET", `/api/catalog/titles/${m.id}/play`, { uid: "ana", fetchImpl: net })).body;
  assert.equal(play.url, "https://cdn.e.ejemplo/m1.mp4");
  const dump = ["logs", "audit", "sync_jobs", "providers"].map(t => JSON.stringify(env.DB.sqlite.prepare(`SELECT * FROM ${t}`).all())).join("")
    + JSON.stringify((await api(env, "GET", "/api/admin/sources", OWNER)).body);
  assert.ok(!/token-\d/.test(dump), "el token no aparece en respuestas ni registros");
});

// ---------- 7. reproducción y seguridad ----------

test("reproducción con credenciales: encabezados o cookies exigidos por el servidor de video = NO compatible", async () => {
  const net = fakeNet({ [`${BASE}/movies`]: () => ({ items: [{ id: "m1", name: "Uno", stream: "https://cdn.e.ejemplo/m1.m3u8" }] }) });
  const env = makeEnv();
  await configure(env, net, "a", formE({ "cat.movie": true, "ep.movie.path": "/movies", "ep.movie.items": "items", "play.mode": "direct", "map.playbackUrl": "stream", "play.requiresCookies": true }));
  const caps = Object.fromEntries((await api(env, "GET", "/api/admin/sources", OWNER)).body.sources.a.capabilities.map(c => [c.id, c.supported]));
  assert.equal(caps.directPlayback, false);
  assert.equal(caps.playMovie, false);
  const r = (await api(env, "POST", "/api/admin/sources/a/test-playback", { ...OWNER, fetchImpl: net, body: { kind: "movie" } })).body;
  assert.equal(r.ok, false);
  assert.match(r.message, /NO COMPATIBLE.*cookies/);
});

// ---------- 8. subtítulos ----------

test("subtítulos: SRT → WebVTT", () => {
  const srt = "1\r\n00:00:01,000 --> 00:00:02,500\r\nHola\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nChau\r\n";
  assert.equal(srtToVtt(srt), "WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHola\n\n00:00:03.000 --> 00:00:04.000\nChau\n");
  assert.equal(isSrt({ url: "https://x.ejemplo/a.srt?v=1" }), true);
  assert.equal(isSrt({ url: "https://x.ejemplo/a.vtt" }), false);
});

test("subtítulos: por plantilla (película y episodio, varios idiomas), desde el catálogo, y nunca con credenciales", async () => {
  const net = fakeNet({
    [`${BASE}/movies`]: () => ({ items: [{ id: "m1", name: "Uno", stream: "https://cdn.e.ejemplo/m1.mp4", sub: "https://subs.e.ejemplo/m1.srt" }] }),
    [`${BASE}/shows/1/episodes`]: () => ({ items: [{ id: "e1", s: 2, n: 3, name: "Ep", stream: "https://cdn.e.ejemplo/e1.m3u8" }] }),
    [`${BASE}/shows`]: () => ({ items: [{ id: "1", name: "Serie" }] })
  });
  const env = makeEnv();
  await configure(env, net, "a", formE({ "cat.movie": true, "cat.series": true, "cat.episodes": true,
    "ep.movie.path": "/movies", "ep.movie.items": "items", "ep.series.path": "/shows", "ep.series.items": "items",
    "ep.episodes.path": "/shows/{id}/episodes", "ep.episodes.items": "items", "epmap.id": "id", "epmap.season": "s", "epmap.number": "n", "epmap.title": "name",
    "play.mode": "direct", "map.playbackUrl": "stream", "epmap.playbackUrl": "stream", "map.subtitleUrl": "sub", "play.subtitleDefaultLang": "es",
    "play.subtitleMovieTemplate": "https://subs.e.ejemplo/movie/{id}/{lang}.vtt", "play.subtitleEpisodeTemplate": "https://subs.e.ejemplo/show/{seriesId}/{season}/{episode}/{lang}.vtt",
    "play.subtitleLangs": "es=Español\nen=English" }));
  await finish(env, net, await startImport(env, net));
  const [m] = await list(env, "movie");
  const pm = (await api(env, "GET", `/api/catalog/titles/${m.id}/play`, { uid: "ana", fetchImpl: net })).body;
  assert.deepEqual(pm.subtitles.map(s => [s.url, s.lang, s.format]), [
    ["https://subs.e.ejemplo/movie/m1/es.vtt", "es", "vtt"], ["https://subs.e.ejemplo/movie/m1/en.vtt", "en", "vtt"], ["https://subs.e.ejemplo/m1.srt", "es", "srt"]]);
  const [s] = await list(env, "series");
  const ep = (await detail(env, s.id)).seasons[0].episodes[0];
  const pe = (await api(env, "GET", `/api/catalog/titles/${s.id}/play?episode=${ep.id}`, { uid: "ana", fetchImpl: net })).body;
  assert.deepEqual(pe.subtitles.map(x => x.url), ["https://subs.e.ejemplo/show/1/2/3/es.vtt", "https://subs.e.ejemplo/show/1/2/3/en.vtt"]);
  // Una plantilla de subtítulos con una credencial: la fuente queda NO compatible.
  await api(env, "PUT", "/api/admin/sources/a", { ...OWNER, fetchImpl: net, body: { form: formE({ "cat.movie": true, "ep.movie.path": "/movies", "ep.movie.items": "items", "play.mode": "direct", "map.playbackUrl": "stream",
    "play.subtitleMovieTemplate": "https://subs.e.ejemplo/{id}.vtt?k={apiKey}", "play.subtitleLangs": "es=Español" }) } });
  const r = (await api(env, "POST", "/api/admin/sources/a/test-playback", { ...OWNER, fetchImpl: net, body: { kind: "movie" } })).body;
  assert.match(r.message, /NO COMPATIBLE/);
});
