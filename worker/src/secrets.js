// Secretos de los proveedores (claves de API, tokens, contraseñas).
//  - Se guardan cifrados con AES-GCM. La clave de cifrado (SECRETS_KEY, 32 bytes en base64)
//    vive solo como secreto del Worker ("wrangler secret put SECRETS_KEY").
//  - Nunca se devuelven al navegador: las respuestas solo dicen qué campos están cargados.
//  - redact() los tapa en cualquier texto antes de guardarlo en registros o mostrarlo.

const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = bytes => btoa(String.fromCharCode(...bytes));
const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

async function keyFrom(env) {
  const raw = String(env.SECRETS_KEY || "");
  let bytes;
  try { bytes = unb64(raw); } catch { bytes = new Uint8Array(); }
  if (bytes.length !== 32) {
    const err = new Error("El servidor no tiene configurada la clave de cifrado (SECRETS_KEY), así que no puede guardar credenciales.");
    err.status = 503;
    throw err;
  }
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecrets(env, obj) {
  const clean = Object.fromEntries(Object.entries(obj || {}).filter(([, v]) => typeof v === "string" && v !== ""));
  if (!Object.keys(clean).length) return "";
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFrom(env), enc.encode(JSON.stringify(clean)));
  return `v1:${b64(iv)}:${b64(new Uint8Array(data))}`;
}

export async function decryptSecrets(env, text) {
  if (!text) return {};
  const [version, iv, data] = String(text).split(":");
  if (version !== "v1" || !iv || !data) throw new Error("Credenciales guardadas con un formato desconocido.");
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await keyFrom(env), unb64(data));
    return JSON.parse(dec.decode(plain));
  } catch (err) {
    if (err.status) throw err;
    throw new Error("No se pudieron descifrar las credenciales guardadas (¿cambió SECRETS_KEY?). Volvé a cargarlas.");
  }
}

// Tapa los valores secretos (y sus versiones codificadas para URL) dentro de un texto.
export function redact(text, secrets = {}) {
  let out = String(text ?? "");
  for (const value of Object.values(secrets || {})) {
    const v = String(value ?? "");
    if (v.length < 4) continue;
    for (const form of new Set([v, encodeURIComponent(v), b64safe(v)])) if (form) out = out.split(form).join("••••");
  }
  return out;
}

function b64safe(v) {
  try { return btoa(v); } catch { return ""; }
}

// ¿Aparece algún secreto dentro del texto? (para no entregar al navegador una dirección con la clave)
export function containsSecret(text, secrets = {}) {
  return redact(text, secrets) !== String(text ?? "");
}
