// Validación en el motor REAL de Cloudflare local (workerd + D1 local) con datos SIMULADOS.
// Requiere:  npm run api:dev  (API en 127.0.0.1:8788, worker/.dev.vars con OWNER_UIDS="e2e-dueno")
//            node tests/helpers/servidor-validacion.mjs  (API simulada en 127.0.0.1:8791)
// No usa los emuladores de Firebase: genera tokens del mismo tipo que el emulador (sin firma),
// que la API local acepta SOLO en localhost con AUTH_EMULATOR (ver tests/api-auth.test.js).
// Uso: node tests/validacion-local.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { emptyForm } from "./helpers/fuentes-simuladas.js";

const API = "http://127.0.0.1:8788", SIM = "http://127.0.0.1:8791", KEY = "clave-de-validacion-local";
const now = Math.floor(Date.now() / 1000);
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const tok = uid => `${b64({ alg: "none", typ: "JWT" })}.${b64({ iss: "https://securetoken.google.com/demo-supat", aud: "demo-supat", sub: uid, iat: now, exp: now + 3600, auth_time: now - 10, email: `${uid}@prueba.test`, email_verified: true })}.`;
const call = async (m, p, uid = "e2e-dueno", body) => {
  const r = await fetch(API + p, { method: m, headers: { Origin: "http://localhost:5175", Authorization: `Bearer ${tok(uid)}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, b: await r.json() };
};
const sim = async body => (await fetch(`${SIM}/control`, body ? { method: "POST", body: JSON.stringify(body) } : {})).json();
// Wrangler se ejecuta directo con Node (sin terminal intermedia, para que la consulta llegue entera).
const d1 = sql => JSON.parse(execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "supat-catalogo", "--local", "--config", "worker/wrangler.toml", "--env", "local", "--json", "--command", sql],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, WRANGLER_SEND_METRICS: "false" } }))[0].results;
const ok = (name, detail = "") => console.log(`✔ ${name}${detail ? ` — ${detail}` : ""}`);
const run = async j => { for (let i = 0; i < 60 && j && ["queued", "running"].includes(j.status) && !j.paused; i++) j = (await call("POST", `/api/admin/jobs/${j.id}/continue`)).b.job; return j; };
// Reinicia la importación y la sigue hasta el final (si falla en la primera tanda, ya no está "activa":
// se toma el último trabajo).
const importJob = async (slot, extra = {}) => {
  const src = (await call("POST", `/api/admin/sources/${slot}/restart`, "e2e-dueno", { confirm: true, ...extra })).b.source;
  return run(src.activeJob || src.lastJob);
};

// ---------- 1. migraciones ----------
const tables = d1("SELECT name FROM sqlite_master WHERE type = 'table'").map(r => r.name);
for (const t of ["provider_state", "app_settings", "maint_jobs"]) assert.ok(tables.includes(t), `falta la tabla ${t}`);
const cols = d1("SELECT name FROM pragma_table_info('sync_jobs')").map(r => r.name);
for (const c of ["paused", "outcome", "outcome_detail", "stalls"]) assert.ok(cols.includes(c), `falta sync_jobs.${c}`);
assert.ok(d1("SELECT name FROM pragma_table_info('title_sources')").some(r => r.name === "meta_json"));
ok("migraciones 0001–0005 aplicadas en D1 local", "tablas y columnas nuevas presentes");

// ---------- configuración de la fuente A (como desde Ajustes) ----------
const formV = over => ({
  ...emptyForm(), displayName: "Validación A", baseUrl: `${SIM}/v1`, authType: "apiKeyHeader", apiKeyName: "X-Key",
  "cat.movie": true, "cat.series": true, "cat.episodes": true,
  "ep.movie.path": "/movies", "ep.movie.items": "data", "ep.movie.page.type": "page", "ep.movie.page.param": "p", "ep.movie.page.totalPagesPath": "meta.pages",
  "ep.series.path": "/shows", "ep.series.items": "results", "ep.series.page.type": "link", "ep.series.page.nextPath": "links.next",
  "ep.episodes.path": "/shows/{id}/episodes", "ep.episodes.items": "items", "ep.episodes.page.type": "none",
  "map.id": "id", "map.title": "name", "map.tmdb": "tmdb", "map.description": "desc", "map.poster": "img", "img.posterPrefix": "https://img.validacion.ejemplo",
  "epmap.id": "id", "epmap.season": "season", "epmap.number": "number", "epmap.title": "title",
  "rate.honorRetryAfter": true, "rate.on429": "wait", "safety.removalPercent": "60", "safety.removalMin": "0", ...over
});
await sim({ limited: false, episodes: [1, 2, 3, 4] });
d1("UPDATE provider_state SET next_at = 0, window_count = 0");
assert.equal((await call("PUT", "/api/admin/sources/a", "e2e-dueno", { form: formV(), secrets: { apiKey: KEY } })).s, 200);
assert.equal((await call("POST", "/api/admin/sources/a/enable", "e2e-dueno", { enabled: true })).s, 200);
await call("POST", "/api/admin/sources/b/enable", "e2e-dueno", { enabled: false });

// ---------- 2. estados de importación + paginación mezclada ----------
let job = await importJob("a", { allowRemovals: true });
assert.equal(job.outcome, "complete", job.outcomeDetail);
const movies = async () => (await call("GET", "/api/catalog/titles?kind=movie&pageSize=100", "e2e-usuario")).b.items.filter(t => /^Validación/.test(t.title) || /^Sinopsis/.test(t.description));
const series = async () => (await call("GET", "/api/catalog/titles?kind=series&pageSize=100", "e2e-usuario")).b.items.filter(t => /validación/.test(t.title));
assert.equal((await movies()).length, 7);
assert.equal((await series()).length, 2);
ok("importación completa con paginación por página (películas) y por enlace (series)", `${job.outcome}: ${job.outcomeDetail}`);

await call("PUT", "/api/admin/sources/a", "e2e-dueno", { form: formV({ "ep.movie.page.maxPages": "1" }) });
job = await importJob("a");
assert.equal(job.outcome, "partial");
assert.match(job.outcomeDetail, /máximo de páginas/);
assert.equal((await movies()).length, 7, "una importación parcial no oculta títulos");
assert.equal((await call("GET", "/api/admin/sources")).b.sources.a.lastStatus, "partial");
ok("estado PARCIAL al alcanzar un límite", "no se ocultó ningún título y la fuente queda 'partial'");
await call("PUT", "/api/admin/sources/a", "e2e-dueno", { form: formV() });

// ---------- 3. bajas de episodios ----------
const epCount = async () => {
  let n = 0;
  for (const s of await series()) n += (await call("GET", `/api/catalog/titles/${s.id}`, "e2e-usuario")).b.seasons.reduce((a, x) => a + x.episodes.length, 0);
  return n;
};
assert.equal(await epCount(), 8);
await sim({ episodes: [1, 2, 3] });
await call("PUT", "/api/admin/sources/a", "e2e-dueno", { form: formV({ "ep.movie.page.maxPages": "1" }) });
job = await importJob("a");
assert.equal(job.outcome, "partial");
assert.equal(await epCount(), 8, "parcial: no se marcan episodios ausentes");
ok("importación PARCIAL no marca episodios ausentes", "8 de 8 siguen visibles");
await call("PUT", "/api/admin/sources/a", "e2e-dueno", { form: formV() });
job = await importJob("a");
assert.equal(job.outcome, "complete", job.outcomeDetail);
assert.match(job.outcomeDetail, /2 episodio\(s\) marcados/);
assert.equal(await epCount(), 6);
const removed = d1("SELECT COUNT(*) AS n FROM episode_sources WHERE removed = 1 AND provider_id = 'fuente-a' AND external_id LIKE '%-e4'")[0].n;
assert.equal(removed, 2);
assert.ok(d1("SELECT COUNT(*) AS n FROM episodes e JOIN title_sources s ON s.title_id = e.title_id WHERE s.provider_id = 'fuente-a' AND e.number = 4")[0].n >= 2, "no se borró físicamente");
ok("importación COMPLETA marca episodios ausentes", job.outcomeDetail);

// ---------- 4. límites persistentes ----------
await sim({ limited: true });
const before = (await sim()).requests;
job = (await call("POST", "/api/admin/sources/a/import", "e2e-dueno", { mode: "incremental" })).b.job;
assert.equal(job.status, "running");
assert.equal(job.attempts, 0, "el 429 con 'esperar' no gasta reintentos");
assert.ok(job.nextRunAt > Date.now() + 60e3, "trabajo pospuesto por Retry-After");
const state = d1("SELECT next_at FROM provider_state WHERE provider_id = 'fuente-a'")[0];
assert.ok(state.next_at > Date.now() + 60e3, "espera guardada en D1");
const afterFirst = (await sim()).requests;
await sim({ limited: false });
job = (await call("POST", `/api/admin/jobs/${job.id}/continue`)).b.job;
assert.equal((await sim()).requests, afterFirst, "otra tanda antes de tiempo no consulta a la fuente");
const rateLogs = (await call("GET", "/api/admin/logs?level=info")).b.logs.filter(l => l.scope === "rate");
assert.ok(rateLogs.length > 0);
ok("límite de frecuencia persistente (429 + Retry-After)", `${afterFirst - before} solicitud(es) antes del 429; 0 durante la espera; registro: "${rateLogs[0].message.slice(0, 70)}…"`);
await call("POST", `/api/admin/jobs/${job.id}/cancel`);
d1("UPDATE provider_state SET next_at = 0, window_count = 0 WHERE provider_id = 'fuente-a'");

// ---------- 5. prioridades por campo ----------
const formB = formV({ displayName: "Validación B", "map.description": "name", "map.poster": "" });
assert.equal((await call("PUT", "/api/admin/sources/b", "e2e-dueno", { form: formB, secrets: { apiKey: KEY } })).s, 200);
assert.equal((await call("POST", "/api/admin/sources/b/enable", "e2e-dueno", { enabled: true })).s, 200);
await call("PUT", "/api/admin/priorities", "e2e-dueno", { priorities: {} });
await run((await call("POST", "/api/admin/priorities/apply", "e2e-dueno", { confirm: true })).b.job);
job = await importJob("b");
assert.equal(job.outcome, "complete", job.outcomeDetail);
const m0 = async () => (await movies()).find(t => t.externalIds?.tmdb === 9100);
assert.equal((await m0()).description, "Sinopsis 0", "prioridad A por defecto");
await call("PUT", "/api/admin/priorities", "e2e-dueno", { priorities: { description: ["fuente-b", "fuente-a"] } });
assert.equal((await m0()).description, "Sinopsis 0", "guardar no cambia datos");
const preview = (await call("POST", "/api/admin/priorities/preview", "e2e-dueno", {})).b;
assert.ok(preview.fieldCounts.description >= 7, JSON.stringify(preview.fieldCounts));
assert.equal((await call("POST", "/api/admin/priorities/apply", "e2e-dueno", {})).s, 400);
let mj = (await call("POST", "/api/admin/priorities/apply", "e2e-dueno", { confirm: true })).b.job;
for (let i = 0; i < 20 && mj.status === "running"; i++) mj = (await call("POST", "/api/admin/priorities/continue")).b.job;
assert.equal(mj.status, "done");
assert.equal((await m0()).description, "Validación 0", "ahora manda B");
assert.equal((await m0()).poster, "https://img.validacion.ejemplo/p/0.jpg", "B no tiene póster: se mantiene el de A");
ok("prioridades por campo", `vista previa: ${preview.changedTitles} títulos cambiarían; aplicada (${mj.processed} revisados, ${mj.changed} con cambios)`);
// Dejar todo como estaba: prioridad por defecto y la fuente B apagada.
await call("PUT", "/api/admin/priorities", "e2e-dueno", { priorities: {} });
await run((await call("POST", "/api/admin/priorities/apply", "e2e-dueno", { confirm: true })).b.job);
await call("POST", "/api/admin/sources/b/enable", "e2e-dueno", { enabled: false });

// ---------- 6. fallida ----------
await call("PUT", "/api/admin/sources/a", "e2e-dueno", { form: formV(), secrets: { apiKey: "clave-equivocada" } });
job = await importJob("a");
assert.equal(job.status, "failed");
assert.ok(!JSON.stringify(job).includes("clave-equivocada"));
await call("PUT", "/api/admin/sources/a", "e2e-dueno", { form: formV(), secrets: { apiKey: KEY } });
ok("estado FALLIDA ante un error no recuperable (401)", job.lastError.slice(0, 80));

const audit = (await call("GET", "/api/admin/audit?limit=200")).b.audit;
assert.ok(!JSON.stringify(audit).includes(KEY) && !JSON.stringify(audit).includes("clave-equivocada"));
ok("auditoría y registros sin credenciales");
console.log("\nValidación en Cloudflare local: todo bien.");
