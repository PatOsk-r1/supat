// Ayudas para probar la API: entorno con D1 de prueba, tokens firmados con una clave propia
// (en lugar de las de Google) y un "internet" simulado para los proveedores.
import { createD1 } from "./d1.js";
import { setTestKeys } from "../../worker/src/auth.js";
import { handle } from "../../worker/src/index.js";

export const PROJECT = "proyecto-prueba";
export const SECRETS_KEY = Buffer.alloc(32, 7).toString("base64");

let signingKey = null;
export async function setupKeys() {
  if (signingKey) return;
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  setTestKeys([{ ...jwk, kid: "clave-prueba", alg: "RS256", use: "sig" }]);
  signingKey = pair.privateKey;
}

const b64url = data => Buffer.from(typeof data === "string" ? data : JSON.stringify(data)).toString("base64url");

export async function token(uid, { verified = true, email = `${uid}@ejemplo.com`, claims = {}, header = {}, sign = true } = {}) {
  await setupKeys();
  const now = Math.floor(Date.now() / 1000);
  const h = { alg: "RS256", kid: "clave-prueba", typ: "JWT", ...header };
  const p = { iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: uid, iat: now, exp: now + 3600, auth_time: now - 60, email, email_verified: verified, ...claims };
  const body = `${b64url(h)}.${b64url(p)}`;
  if (!sign) return `${body}.`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signingKey, Buffer.from(body));
  return `${body}.${Buffer.from(sig).toString("base64url")}`;
}

export function makeEnv(extra = {}) {
  return {
    DB: createD1(),
    FIREBASE_PROJECT_ID: PROJECT,
    ALLOWED_ORIGINS: "https://supat.ejemplo",
    OWNER_UIDS: "dueno",
    SECRETS_KEY,
    FIRESTORE_CHECK: "off",
    SYNC_PAGES_PER_RUN: "3",
    ...extra
  };
}

// Internet simulado: rutas → función que devuelve { status, body } o un objeto (JSON 200).
export function fakeNet(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ url: u.toString(), init });
    for (const [pattern, fn] of Object.entries(routes)) {
      if ((u.origin + u.pathname) === pattern || u.toString().startsWith(pattern)) {
        const out = await fn(u, init);
        if (out instanceof Error) throw out;
        const status = out?.__status || 200;
        const body = out?.__status ? out.body : out;
        return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      }
    }
    return new Response("no encontrado", { status: 404 });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

// Llama a la API como lo haría el navegador. Devuelve { status, body }.
export async function api(env, method, path, { uid = null, tok = null, body = null, origin = "https://supat.ejemplo", host = "https://api.ejemplo", fetchImpl } = {}) {
  const headers = {};
  if (uid) headers.Authorization = `Bearer ${await token(uid)}`;
  if (tok) headers.Authorization = `Bearer ${tok}`;
  if (origin) headers.Origin = origin;
  if (body) headers["Content-Type"] = "application/json";
  const request = new Request(host + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  try {
    const res = await handle(request, env, { fetchImpl: fetchImpl || fakeNet({}) });
    return { status: res.status, body: await res.json() };
  } catch (err) {
    return { status: err.status || 500, body: { error: err.message, code: err.code } };
  }
}
