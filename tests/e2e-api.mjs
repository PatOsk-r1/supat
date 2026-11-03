// Prueba de punta a punta de la API del catálogo central, con todo corriendo en local:
//   - emuladores de Firebase (npm run emuladores): cuentas reales del emulador
//   - API en wrangler (npm run api:dev): workerd + D1 local, con OWNER_UIDS=e2e-dueno en worker/.dev.vars
//   - proveedor inventado (node tests/helpers/servidor-proveedor.mjs)
// Uso: node tests/e2e-api.mjs
import assert from "node:assert/strict";
import { SPEC, KEY } from "./helpers/proveedor-simulado.js";

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

const created = await call("POST", "/api/admin/providers", owner, { adapter: "http-json", label: "Proveedor de prueba local", config: { baseUrl: PROV, spec: JSON.stringify(SPEC), apiKey: KEY } });
assert.equal(created.status, 200, JSON.stringify(created.body));
const id = created.body.provider.id;
assert.ok(!JSON.stringify(created.body).includes(KEY));
assert.equal((await call("PATCH", `/api/admin/providers/${id}`, owner, { enabled: true })).status, 200);
step("proveedor creado (credencial cifrada, no aparece en la respuesta) y activado");

const test = await call("POST", `/api/admin/providers/${id}/test`, owner);
assert.equal(test.body.ok, true, test.body.message);
step(`prueba de conexión: ${test.body.message}`);

let job = (await call("POST", `/api/admin/providers/${id}/sync`, owner, { mode: "full" })).body.job;
for (let i = 0; i < 20 && ["queued", "running"].includes(job.status); i++) job = (await call("POST", `/api/admin/jobs/${job.id}/continue`, owner)).body.job;
assert.equal(job.status, "done", job.lastError);
step(`importación completa en D1 local: ${job.pages} páginas, ${job.created} títulos nuevos, ${job.episodes} episodios`);

// La base local puede tener títulos de corridas anteriores u otros proveedores: se buscan los de este.
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
step("reproducción resuelta en el servidor; la dirección con la clave no se entrega");

const series = (await call("GET", "/api/catalog/titles?kind=series", user)).body.items;
const detail = (await call("GET", `/api/catalog/titles/${series.find(s => s.title === "Serie A").id}`, user)).body;
assert.deepEqual(detail.seasons.map(s => s.episodes.length), [2, 1]);
step("temporadas y episodios asociados");

const logs = (await call("GET", "/api/admin/logs", owner)).body.logs;
const audit = (await call("GET", "/api/admin/audit", owner)).body.audit;
assert.ok(!JSON.stringify([logs, audit]).includes(KEY));
step(`registros (${logs.length}) y auditoría (${audit.length}) sin la credencial`);
console.log("\nTodo bien.");
