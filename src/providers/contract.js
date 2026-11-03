// Contrato común de los proveedores (adaptadores). Ver PROVEEDORES.md.
//
// Un adaptador es un objeto con:
//   type, name, description, origin           textos para identificarlo
//   kinds: ["live" | "movie" | "series" | "anime"]   qué tipos de contenido puede entregar
//   fields: [{ key, label, type, required, secret, help, options }]   su configuración
//   defaults, ttl (ms de caché), multiple (varias instancias), validate(config)
// y una o más de estas capacidades (cada una opcional):
//   load(config, ctx)                          → { items, epg?, warning? }     catálogo
//   loadSeasons(item, config, ctx)             → [{ number, episodes }]         temporadas
//   resolveSource(item, episode, config, ctx)  → { url, type }                  fuente de un título propio
//   findSources(query, config, ctx)            → [{ url, type, label }]         fuentes para títulos de otros
//   embedOrigins: ["https://…"]                orígenes permitidos para reproductores por iframe
// ctx = { instanceId, signal } (signal corta la consulta si tarda demasiado).

export const KIND_LIST = ["live", "movie", "series", "anime"];

export const CAPABILITY_LABELS = {
  catalog: "Catálogo",
  seasons: "Temporadas y episodios",
  sources: "Fuentes de reproducción",
  embed: "Reproductor externo"
};

// Límites que protegen a la app (y a los demás proveedores) de un proveedor lento o roto.
export const LIMITS = {
  timeoutMs: 20000,     // tiempo máximo de cada consulta
  maxItems: 20000,      // títulos máximos que se aceptan de un proveedor
  minRefreshMs: 30000,  // espera mínima entre dos actualizaciones forzadas del mismo proveedor
  maxSources: 20        // fuentes máximas que un proveedor puede proponer para un título
};

export function capabilitiesOf(def) {
  const caps = [];
  if (typeof def.load === "function") caps.push("catalog");
  if (typeof def.loadSeasons === "function") caps.push("seasons");
  if (typeof def.resolveSource === "function" || typeof def.findSources === "function") caps.push("sources");
  if (Array.isArray(def.embedOrigins) && def.embedOrigins.length) caps.push("embed");
  return caps;
}

// Revisa que un adaptador cumpla el contrato. Devuelve la lista de problemas (vacía = válido).
export function validateProviderDef(def) {
  const problems = [];
  if (!def || typeof def !== "object") return ["El adaptador no es un objeto."];
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(def.type || "")) problems.push("\"type\" debe ser un identificador corto en minúsculas.");
  if (!def.name) problems.push("Falta \"name\".");
  if (!Array.isArray(def.kinds) || !def.kinds.length || def.kinds.some(k => !KIND_LIST.includes(k))) problems.push(`"kinds" debe ser una lista con valores de: ${KIND_LIST.join(", ")}.`);
  if (!Array.isArray(def.fields)) problems.push("\"fields\" debe ser una lista (puede estar vacía).");
  else for (const f of def.fields) if (!f.key || !f.label) problems.push("Cada campo necesita \"key\" y \"label\".");
  const caps = capabilitiesOf(def);
  if (!caps.includes("catalog") && typeof def.findSources !== "function") problems.push("Necesita al menos \"load\" (catálogo) o \"findSources\" (fuentes).");
  for (const origin of def.embedOrigins || []) {
    try {
      const u = new URL(origin);
      if (u.protocol !== "https:" || u.origin !== origin) problems.push(`Origen de iframe inválido: ${origin} (usar solo "https://dominio").`);
    } catch { problems.push(`Origen de iframe inválido: ${origin}.`); }
  }
  return problems;
}

// Campos secretos (claves, contraseñas, tokens): nunca se muestran ni se registran.
export function secretKeys(def) {
  return (def.fields || []).filter(f => f.secret || f.type === "password").map(f => f.key);
}

// Reemplaza los valores secretos de la configuración en un texto (por ejemplo, un mensaje de error).
export function redact(text, def, config) {
  let out = String(text ?? "");
  for (const key of secretKeys(def)) {
    const value = String(config?.[key] ?? "");
    if (value.length >= 4) out = out.split(value).join("••••");
  }
  return out;
}

// Ejecuta una consulta con tiempo máximo. La función recibe una señal para cortar descargas.
export async function withTimeout(fn, ms = LIMITS.timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`El proveedor no respondió en ${Math.round(ms / 1000)} segundos.`));
    }, ms);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => fn(controller.signal)), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
