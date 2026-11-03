// Autenticación: verifica el token de Firebase Auth que manda el navegador
// ("Authorization: Bearer <idToken>") y arma el usuario con su rol.
//
//  - La firma se verifica con las claves públicas de Google (RS256). No se confía en nada
//    que el navegador diga sobre sí mismo: uid, correo y verificación salen del token firmado.
//  - El rol sale de la base del servidor. Los dueños iniciales vienen de OWNER_UIDS
//    (configuración del Worker); nadie puede darse un rol a sí mismo.
//  - Se respetan la suspensión y "cerrar todas las sesiones" del módulo de cuentas, leyendo
//    el perfil de Firestore con el mismo token (como mucho una vez cada 5 minutos por usuario).
import { fail } from "./http.js";

const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const SESSION_MAX_S = 30 * 24 * 3600;   // igual que firestore.rules
const PROFILE_CHECK_MS = 5 * 60 * 1000;
const CLOCK_SKEW_S = 300;

let jwksCache = { keys: null, until: 0 };

const b64urlBytes = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const b64urlJson = s => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

export function decodeJwt(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  try { return { header: b64urlJson(parts[0]), payload: b64urlJson(parts[1]), parts }; }
  catch { return null; }
}

async function googleKeys(fetchImpl) {
  if (jwksCache.keys && Date.now() < jwksCache.until) return jwksCache.keys;
  const res = await fetchImpl(JWKS_URL);
  if (!res.ok) fail(503, "No se pudieron obtener las claves de verificación de Google.");
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("Cache-Control") || "")?.[1]) || 3600;
  const { keys } = await res.json();
  jwksCache = { keys: keys || [], until: Date.now() + Math.min(maxAge, 6 * 3600) * 1000 };
  return jwksCache.keys;
}

// Solo para pruebas: reemplaza las claves públicas.
export function setTestKeys(keys) { jwksCache = { keys, until: keys ? Date.now() + 3600e3 : 0 }; }

function isLocal(request) {
  const host = new URL(request.url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

// Verifica el token y devuelve sus datos (claims). Lanza 401 si no es válido.
export async function verifyFirebaseToken(token, env, request, fetchImpl = fetch) {
  const jwt = decodeJwt(token);
  if (!jwt) fail(401, "Sesión inválida. Volvé a iniciar sesión.", "auth");
  const { header, payload, parts } = jwt;
  const projectId = env.FIREBASE_PROJECT_ID;
  const emulator = env.AUTH_EMULATOR === "true" && isLocal(request);

  if (header.alg === "none") {
    // Los tokens del emulador de Firebase no van firmados: se aceptan SOLO con la API en localhost.
    if (!emulator) fail(401, "Sesión inválida.", "auth");
  } else {
    if (header.alg !== "RS256" || !header.kid) fail(401, "Sesión inválida.", "auth");
    const jwk = (await googleKeys(fetchImpl)).find(k => k.kid === header.kid);
    if (!jwk) fail(401, "Sesión inválida o vencida. Volvé a iniciar sesión.", "auth");
    const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) fail(401, "Sesión inválida.", "auth");
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}`) fail(401, "Sesión de otro proyecto.", "auth");
  if (!(payload.exp > now)) fail(401, "La sesión venció. Volvé a iniciar sesión.", "auth");
  if (!(payload.iat <= now + CLOCK_SKEW_S) || !(payload.auth_time <= now + CLOCK_SKEW_S)) fail(401, "Sesión inválida.", "auth");
  if (typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 128) fail(401, "Sesión inválida.", "auth");
  if (payload.auth_time < now - SESSION_MAX_S) fail(401, "Pasaron 30 días desde que iniciaste sesión. Volvé a entrar.", "auth");
  return payload;
}

const ownerSet = env => new Set(String(env.OWNER_UIDS || "").split(",").map(s => s.trim()).filter(Boolean));
export const isInitialOwner = (env, uid) => ownerSet(env).has(uid);

// Lee el perfil de Firestore del propio usuario (suspensión y "cerrar todas las sesiones").
async function readProfile(env, uid, token, fetchImpl) {
  if (env.FIRESTORE_CHECK === "off") return null;
  const base = env.AUTH_EMULATOR === "true" && env.FIRESTORE_EMULATOR ? env.FIRESTORE_EMULATOR : "https://firestore.googleapis.com";
  const url = `${base}/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${encodeURIComponent(uid)}`;
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return { suspended: false, revokedAt: 0 };
  if (!res.ok) throw new Error(`Firestore respondió ${res.status}`);
  const doc = await res.json();
  const f = doc.fields || {};
  const revoked = f.revokedAt?.timestampValue ? Math.floor(Date.parse(f.revokedAt.timestampValue) / 1000) : 0;
  return { suspended: f.suspended?.booleanValue === true, revokedAt: Number.isFinite(revoked) ? revoked : 0 };
}

// Autentica el pedido. Devuelve { uid, email, emailVerified, role, blocked, suspended }.
export async function authenticate(request, env, fetchImpl = fetch) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) fail(401, "Iniciá sesión para usar el catálogo central.", "auth");
  const claims = await verifyFirebaseToken(token, env, request, fetchImpl);
  const uid = claims.sub;
  const now = Date.now();

  let row = await env.DB.prepare("SELECT * FROM users WHERE uid = ?").bind(uid).first();
  if (!row) {
    const role = isInitialOwner(env, uid) ? "owner" : "user";
    await env.DB.prepare("INSERT OR IGNORE INTO users (uid, email, role, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)")
      .bind(uid, String(claims.email || "").slice(0, 200), role, now, now).run();
    row = await env.DB.prepare("SELECT * FROM users WHERE uid = ?").bind(uid).first();
  }

  // Perfil de cuentas: suspensión y sesiones revocadas.
  if (now - row.checked_at > PROFILE_CHECK_MS) {
    try {
      const profile = await readProfile(env, uid, token, fetchImpl);
      if (profile) {
        row.suspended = profile.suspended ? 1 : 0;
        row.revoked_at = profile.revokedAt;
        row.checked_at = now;
      }
    } catch {
      // Si Firestore no responde se usa el último dato conocido.
    }
  }
  const updates = env.DB.prepare("UPDATE users SET email = ?, suspended = ?, revoked_at = ?, checked_at = ?, last_seen_at = ? WHERE uid = ?")
    .bind(String(claims.email || row.email).slice(0, 200), row.suspended, row.revoked_at, row.checked_at, now, uid);
  if (now - row.last_seen_at > 60000 || row.checked_at === now) await updates.run();

  if (row.revoked_at && claims.auth_time <= row.revoked_at) fail(401, "Cerraste todas las sesiones. Volvé a iniciar sesión.", "auth");

  return {
    uid,
    email: String(claims.email || ""),
    emailVerified: claims.email_verified === true,
    role: isInitialOwner(env, uid) ? "owner" : row.role,
    blocked: Boolean(row.blocked),
    suspended: Boolean(row.suspended)
  };
}

// Usuario habilitado para el catálogo: correo verificado, sin suspensión ni bloqueo.
export function requireUser(user) {
  if (!user.emailVerified) fail(403, "Verificá tu correo para usar el catálogo central.", "verify");
  if (user.suspended) fail(403, "Tu cuenta está suspendida.", "suspended");
  if (user.blocked && user.role !== "owner") fail(403, "Tu acceso al catálogo central está bloqueado.", "blocked");
  return user;
}

export function requireOwner(user) {
  requireUser(user);
  if (user.role !== "owner") fail(403, "Esta acción es solo para el propietario.", "owner");
  return user;
}
