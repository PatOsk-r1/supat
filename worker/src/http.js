// Respuestas JSON, errores con código y CORS.

export class HttpError extends Error {
  constructor(status, message, code = "") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const fail = (status, message, code) => { throw new HttpError(status, message, code); };

const SECURITY_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer"
};

export function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  const list = String(env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  return list.includes(origin) ? origin : "";
}

export function corsHeaders(request, env) {
  const origin = allowedOrigin(request, env);
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin"
  };
}

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...SECURITY_HEADERS, ...extra } });
}

export function errorResponse(err) {
  if (err instanceof HttpError) return json({ error: err.message, code: err.code || undefined }, err.status);
  // Los errores inesperados no se describen al cliente (pueden tener datos internos).
  return json({ error: "Error interno del servidor." }, 500);
}

// Lee el cuerpo JSON con un tamaño máximo.
export async function readJson(request, maxBytes = 64 * 1024) {
  const text = await request.text();
  if (text.length > maxBytes) fail(413, "El pedido es demasiado grande.");
  if (!text) return {};
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    fail(400, "El cuerpo del pedido no es JSON válido.");
  }
}

// Números enteros de la consulta, acotados.
export function intParam(url, name, def, min, max) {
  const n = parseInt(url.searchParams.get(name), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}
