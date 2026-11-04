// API del catálogo central: autenticación, roles y permisos (sin red: D1 y Google simulados).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, api, token, PROJECT } from "./helpers/api.js";
import { verifyFirebaseToken } from "../worker/src/auth.js";
import { handle } from "../worker/src/index.js";

const req = (host = "https://api.ejemplo") => new Request(host + "/api/me");

test("token válido: se acepta y devuelve el uid", async () => {
  const claims = await verifyFirebaseToken(await token("ana"), { FIREBASE_PROJECT_ID: PROJECT }, req());
  assert.equal(claims.sub, "ana");
});

test("tokens inválidos se rechazan: firma alterada, otro proyecto, vencido, sesión de más de 30 días", async () => {
  const env = { FIREBASE_PROJECT_ID: PROJECT };
  const good = await token("ana");
  const tampered = good.split(".").map((p, i) => (i === 1 ? Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url")), sub: "dueno" })).toString("base64url") : p)).join(".");
  const now = Math.floor(Date.now() / 1000);
  for (const t of [
    tampered,
    await token("ana", { claims: { aud: "otro" } }),
    await token("ana", { claims: { iss: "https://securetoken.google.com/otro" } }),
    await token("ana", { claims: { exp: now - 10 } }),
    await token("ana", { claims: { auth_time: now - 31 * 24 * 3600 } }),
    await token("ana", { header: { kid: "desconocida" } }),
    await token("ana", { header: { alg: "HS256" } }),
    "basura", ""
  ]) {
    await assert.rejects(verifyFirebaseToken(t, env, req()), err => err.status === 401);
  }
});

test("tokens sin firma (emulador): solo con AUTH_EMULATOR y la API en localhost", async () => {
  const unsigned = await token("ana", { header: { alg: "none" }, sign: false });
  await assert.rejects(verifyFirebaseToken(unsigned, { FIREBASE_PROJECT_ID: PROJECT }, req()), err => err.status === 401);
  await assert.rejects(verifyFirebaseToken(unsigned, { FIREBASE_PROJECT_ID: PROJECT, AUTH_EMULATOR: "true" }, req("https://supat-api.workers.dev")), err => err.status === 401);
  const ok = await verifyFirebaseToken(unsigned, { FIREBASE_PROJECT_ID: PROJECT, AUTH_EMULATOR: "true" }, req("http://127.0.0.1:8787"));
  assert.equal(ok.sub, "ana");
});

test("sin sesión: todas las rutas (menos /api/health) piden iniciar sesión", async () => {
  const env = makeEnv();
  assert.equal((await api(env, "GET", "/api/health")).status, 200);
  for (const [m, p] of [["GET", "/api/me"], ["GET", "/api/catalog/titles"], ["GET", "/api/catalog/search?q=a"], ["GET", "/api/catalog/titles/1"], ["GET", "/api/catalog/titles/1/play"],
    ["GET", "/api/admin/providers"], ["PUT", "/api/admin/source"], ["POST", "/api/admin/source/test"], ["GET", "/api/admin/users"], ["PATCH", "/api/admin/users/x"], ["GET", "/api/admin/logs"]]) {
    const r = await api(env, m, p);
    assert.equal(r.status, 401, `${m} ${p}`);
  }
});

test("roles: el dueño sale de OWNER_UIDS; los demás son 'user' y no entran al panel", async () => {
  const env = makeEnv();
  assert.equal((await api(env, "GET", "/api/me", { uid: "dueno" })).body.role, "owner");
  assert.equal((await api(env, "GET", "/api/me", { uid: "ana" })).body.role, "user");
  for (const [m, p] of [["GET", "/api/admin/providers"], ["PUT", "/api/admin/source"], ["POST", "/api/admin/source/test"], ["GET", "/api/admin/users"], ["PATCH", "/api/admin/users/ana"], ["GET", "/api/admin/logs"], ["POST", "/api/admin/catalog/reindex"]]) {
    const r = await api(env, m, p, { uid: "ana", body: m === "GET" ? null : { role: "owner" } });
    assert.equal(r.status, 403, `${m} ${p}`);
  }
  assert.equal((await api(env, "GET", "/api/admin/providers", { uid: "dueno" })).status, 200);
});

test("nadie puede darse privilegios: ni por el token, ni por la API, ni cambiándose el rol", async () => {
  const env = makeEnv();
  // Datos inventados en el token (rol, admin) no cuentan.
  const forged = await token("ana", { claims: { role: "owner", admin: true, owner: true } });
  assert.equal((await api(env, "GET", "/api/me", { tok: forged })).body.role, "user");
  assert.equal((await api(env, "PATCH", "/api/admin/users/ana", { uid: "ana", body: { role: "owner" } })).status, 403);
  // El dueño no se cambia el rol a sí mismo (no se queda el sistema sin dueño).
  assert.equal((await api(env, "PATCH", "/api/admin/users/dueno", { uid: "dueno", body: { role: "user" } })).status, 403);
  assert.equal((await api(env, "GET", "/api/me", { uid: "ana" })).body.role, "user");
});

test("el dueño promueve, bloquea y queda auditado; un dueño de OWNER_UIDS no se puede quitar", async () => {
  const env = makeEnv({ OWNER_UIDS: "dueno,socio" });
  await api(env, "GET", "/api/me", { uid: "ana" });
  await api(env, "GET", "/api/me", { uid: "socio" });
  assert.equal((await api(env, "PATCH", "/api/admin/users/ana", { uid: "dueno", body: { role: "owner" } })).status, 200);
  assert.equal((await api(env, "GET", "/api/admin/providers", { uid: "ana" })).status, 200);
  assert.equal((await api(env, "PATCH", "/api/admin/users/ana", { uid: "dueno", body: { role: "user", blocked: true } })).status, 200);
  assert.equal((await api(env, "GET", "/api/catalog/titles", { uid: "ana" })).status, 403);
  assert.equal((await api(env, "PATCH", "/api/admin/users/socio", { uid: "dueno", body: { role: "user" } })).status, 403);
  const audit = (await api(env, "GET", "/api/admin/audit", { uid: "dueno" })).body.audit;
  assert.deepEqual(audit.map(a => a.action).slice(0, 2), ["user-update", "user-update"]);
  assert.match(audit[0].detail, /bloqueado/);
});

test("correo sin verificar: /api/me responde, el catálogo no", async () => {
  const env = makeEnv();
  const t = await token("ana", { verified: false });
  assert.equal((await api(env, "GET", "/api/me", { tok: t })).status, 200);
  const r = await api(env, "GET", "/api/catalog/titles", { tok: t });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, "verify");
});

test("suspensión y 'cerrar todas las sesiones' del módulo de cuentas se respetan (perfil de Firestore)", async () => {
  const env = makeEnv({ FIRESTORE_CHECK: "on" });
  let profile = { fields: { suspended: { booleanValue: false }, revokedAt: { timestampValue: "1970-01-01T00:00:00Z" } } };
  const fetchImpl = async url => {
    if (String(url).endsWith("/documents/admins/ana")) return new Response("{}", { status: 404 });
    assert.match(String(url), /firestore\.googleapis\.com\/v1\/projects\/proyecto-prueba\/databases\/\(default\)\/documents\/users\/ana$/);
    return new Response(JSON.stringify(profile), { status: 200 });
  };
  const call = async tok => handle(new Request("https://api.ejemplo/api/catalog/titles", { headers: { Authorization: `Bearer ${tok}` } }), env, { fetchImpl })
    .then(r => r.status, e => e.status);
  assert.equal(await call(await token("ana")), 200);
  // Suspendida: se ve en la siguiente consulta del perfil (cada 5 minutos).
  profile = { fields: { suspended: { booleanValue: true } } };
  env.DB.sqlite.exec("UPDATE users SET checked_at = 0");
  assert.equal(await call(await token("ana")), 403);
  // Cerró todas las sesiones después de iniciar esta: el token viejo no sirve.
  profile = { fields: { suspended: { booleanValue: false }, revokedAt: { timestampValue: new Date().toISOString() } } };
  env.DB.sqlite.exec("UPDATE users SET checked_at = 0");
  assert.equal(await call(await token("ana", { claims: { auth_time: Math.floor(Date.now() / 1000) - 120 } })), 401);
});

test("CORS: solo los sitios permitidos; los cambios desde otro origen se rechazan", async () => {
  const env = makeEnv();
  const worker = (await import("../worker/src/index.js")).default;
  const pre = await worker.fetch(new Request("https://api.ejemplo/api/me", { method: "OPTIONS", headers: { Origin: "https://supat.ejemplo" } }), env);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("Access-Control-Allow-Origin"), "https://supat.ejemplo");
  const bad = await worker.fetch(new Request("https://api.ejemplo/api/me", { method: "OPTIONS", headers: { Origin: "https://malo.ejemplo" } }), env);
  assert.equal(bad.status, 403);
  const r = await api(env, "PATCH", "/api/admin/users/ana", { uid: "dueno", origin: "https://malo.ejemplo", body: { role: "owner" } });
  assert.equal(r.status, 403);
});

test("los administradores de Firebase (admins/{uid}) son propietarios fijos", async () => {
  const env = makeEnv({ FIRESTORE_CHECK: "on", OWNER_UIDS: "" });
  const admins = new Set(["jefa"]);
  const fetchImpl = async url => {
    const m = /\/documents\/(users|admins)\/([^/]+)$/.exec(String(url));
    if (m[1] === "admins") return new Response("{}", { status: admins.has(m[2]) ? 200 : 404 });
    return new Response("{}", { status: 404 });
  };
  const me = async uid => (await handle(new Request("https://api.ejemplo/api/me", { headers: { Authorization: `Bearer ${await token(uid)}` } }), env, { fetchImpl })).json();
  assert.equal((await me("jefa")).role, "owner");
  assert.equal((await me("ana")).role, "user");
  const r = await api(env, "PATCH", "/api/admin/users/jefa", { uid: "jefa", body: { role: "user" } });
  assert.equal(r.status, 403); // ni a sí misma
  env.DB.sqlite.exec("UPDATE users SET role = 'owner' WHERE uid = 'ana'"); // otra propietaria (promovida desde el panel)
  const r2 = await api(env, "PATCH", "/api/admin/users/jefa", { uid: "ana", body: { role: "user" } });
  assert.equal(r2.status, 403);
  // Si la quitan de admins/ en la consola, deja de ser propietaria en la próxima revisión.
  admins.delete("jefa");
  env.DB.sqlite.exec("UPDATE users SET checked_at = 0");
  assert.equal((await me("jefa")).role, "user");
});
