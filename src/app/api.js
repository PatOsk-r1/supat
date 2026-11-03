// Conexión con la API del catálogo central (Cloudflare Worker, ver worker/README.md).
// Cada pedido lleva el token de la sesión de Firebase; el servidor lo verifica y decide
// los permisos. Acá no hay ni se guarda ninguna credencial de proveedores.
import { getFirebase } from "./firebase.js";

// Dirección de la API: VITE_SUPAT_API al compilar (archivo .env.production o .env.local).
// En "npm run dev:emu" usa la API local de "npm run api:dev". Vacía = catálogo central apagado.
const MODE = import.meta.env?.MODE;
export const API_BASE = String(import.meta.env?.VITE_SUPAT_API || (MODE === "emulador" ? "http://127.0.0.1:8788" : "")).replace(/\/$/, "");
export const apiAvailable = () => Boolean(API_BASE) && MODE !== "page";

export class ApiError extends Error {
  constructor(message, status = 0, code = "") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function idToken() {
  const { auth } = await getFirebase();
  const user = auth.currentUser;
  if (!user) throw new ApiError("Iniciá sesión para usar el catálogo central.", 401, "auth");
  return user.getIdToken();
}

export async function apiRequest(method, path, body = null, { signal } = {}) {
  if (!apiAvailable()) throw new ApiError("El catálogo central no está configurado en esta versión.", 0, "off");
  const headers = { Authorization: `Bearer ${await idToken()}` };
  if (body) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(API_BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw new ApiError("No se pudo conectar con el catálogo central. Revisá tu conexión.", 0, "network");
  }
  let data = null;
  try { data = await res.json(); } catch { /* sin cuerpo */ }
  if (!res.ok) throw new ApiError(data?.error || `El catálogo central respondió ${res.status}.`, res.status, data?.code || "");
  return data;
}

export const api = {
  get: (path, opts) => apiRequest("GET", path, null, opts),
  post: (path, body = {}, opts) => apiRequest("POST", path, body, opts),
  patch: (path, body = {}, opts) => apiRequest("PATCH", path, body, opts)
};
