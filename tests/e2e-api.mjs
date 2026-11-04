// Prueba de punta a punta de la API del catálogo central, con todo corriendo en local:
//   - emuladores de Firebase (npm run emuladores): cuentas reales del emulador
//   - API en wrangler (npm run api:dev): workerd + D1 local, con OWNER_UIDS=e2e-dueno en worker/.dev.vars
//   - proveedor inventado (node tests/helpers/servidor-proveedor.mjs)
// Uso: node tests/e2e-api.mjs
import assert from "node:assert/strict";
import { KEY, PLAY_KEY } from "./helpers/proveedor-simulado.js";
import { FORM_A } from "./helpers/fuentes-simuladas.js";

const AUTH = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const API = "http://127.0.0.1:8788";
const ORIGIN = "http://localhost:5174";
const PROV = "http://127.0.0.1:8790/v1";

async function post(url, body, headers = {}) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(`${url}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

// Crea (o reutiliza) una cuenta del emulador con un uid fijo y el correo verificado.
async function account(localId, email) {
  const password = "clave-de-prueba-1234";
  await post(`${AUTH}/projects/demo-supat/accounts`, { localId, email, password }, { Authorization: "Bearer owner" }).catch(() => {});
  await post(`${AUTH}/projects/demo-supat/accounts:update`, { localId, emailVerified: true }, { Authorization: "Bearer owner" });
  const { idToken } = await post(`${AUTH}/accounts:signInWithPassword?key=fake`, { email, password, returnSecureToken: true });
  return idToken;
}

async function call(method, path, tok, body) {
  const res = await fetch(API + path, { method, headers: { Origin: ORIGIN, ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

const step = (name, ok = true) => console.log(`${ok ? "✔" : "✖"} ${name}`);

const owner = await account("e2e-dueno", "dueno@prueba.test");
const user = await account("e2e-usuario", "usuario@prueba.test");
step("cuentas del emulador creadas y verificadas");

assert.equal((await call("GET", "/api/me", owner)).body.role, "owner");
assert.equal((await call("GET", "/api/me", user)).body.role, "user");
step("roles: dueño por OWNER_UIDS, usuario común");

assert.equal((await call("GET", "/api/admin/providers", user)).status, 403);
assert.equal((await call("PATCH", "/api/admin/users/e2e-usuario", user, { role: "owner" })).status, 403);
step("el usuario común no entra al panel ni se da permisos");

// Fuente A configurada como desde Ajustes, apuntando al proveedor inventado local.
const form = { ...FORM_A(), baseUrl: PROV, "play.domains": "http://127.0.0.1:8790" };
const saved = await call("PUT", "/api/admin/sources/a", owner, { form, secrets: { apiKey: KEY, playbackKey: PLAY_KEY } });
assert.equal(saved.status, 200, JSON.stringify(saved.body));
assert.ok(!JSON.stringify(saved.body).includes(KEY) && !JSON.stringify(saved.body).includes(PLAY_KEY));
assert.equal((await call("POST", "/api/admin/sources/a/enable", owner, { enabled: true })).status, 200);
const conn = (await call("POST", "/api/admin/sources/a/test-connection", owner)).body;
assert.equal(conn.ok, true, conn.message);
step(`Fuente A guardada y activada desde "Ajustes" (credenciales cifradas, no aparecen en la respuesta): ${conn.message}`);
assert.equal((await call("PUT", "/api/admin/sources/a", user, { form })).status, 403);
step("el usuario común no puede configurar las fuentes");
const imp = (await call("POST", "/api/admin/sources/a/import", owner, { mode: "full" })).body;
saved.body.job = imp.job;
let job = saved.body.job;
for (let i = 0; i < 30 && job && ["queued", "running"].includes(job.status); i++) job = (await call("POST", `/api/admin/jobs/${job.id}/continue`, owner)).body.job;
if (job) {
  assert.equal(job.status, "done", job.lastError);
  step(`importación completa en D1 local: ${job.pages} páginas, ${job.created} títulos nuevos, ${job.merged} unidos, ${job.episodes} episodios`);
} else step("la fuente ya estaba importada (sin cambios estructurales)");
const status = (await call("GET", "/api/catalog/status", user)).body;
assert.equal(status.available, true);
step(`estado público: disponible, ${status.counts.movie} películas, ${status.counts.series} series, ${status.counts.episodes} episodios`);

const movies = (await call("GET", "/api/catalog/titles?kind=movie&pageSize=200", user)).body.items;
for (const t of ["La Película Uno", "Canción de Otoño", "Ñandú Veloz"]) assert.equal(movies.filter(m => m.title === t).length, 1, `${t} (sin duplicar)`);
const found = (await call("GET", "/api/catalog/search?q=nandu", user)).body.items;
assert.deepEqual(found.map(t => t.title), ["Ñandú Veloz"]);
step("catálogo y búsqueda FTS5 (sin acentos) en D1 local");

const m1 = movies.find(t => t.title === "La Película Uno");
const play = await call("GET", `/api/catalog/titles/${m1.id}/play`, user);
assert.equal(play.status, 200, JSON.stringify(play.body));
assert.equal(play.body.type, "application/x-mpegurl");
const m2 = movies.find(t => t.title === "Canción de Otoño");
assert.equal((await call("GET", `/api/catalog/titles/${m2.id}/play`, user)).status, 502);
step("reproducción resuelta en el servidor con la credencial de reproducción; el enlace que la contiene no se entrega");

const series = (await call("GET", "/api/catalog/titles?kind=series", user)).body.items;
const detail = (await call("GET", `/api/catalog/titles/${series.find(s => s.title === "Serie A").id}`, user)).body;
assert.deepEqual(detail.seasons.map(s => s.episodes.length), [2, 1]);
step("temporadas y episodios asociados");

const logs = (await call("GET", "/api/admin/logs", owner)).body.logs;
const audit = (await call("GET", "/api/admin/audit", owner)).body.audit;
assert.ok(!JSON.stringify([logs, audit]).includes(KEY) && !JSON.stringify([logs, audit]).includes(PLAY_KEY));
step(`registros (${logs.length}) y auditoría (${audit.length}) sin la credencial`);
console.log("\nTodo bien.");
