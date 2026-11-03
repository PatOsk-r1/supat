// Adaptadores disponibles en el servidor. Para sumar uno: crear su archivo en esta carpeta
// con el contrato de contract.js e incluirlo en la lista de abajo.
//
// Jellyfin y las listas M3U siguen funcionando en el navegador (Ajustes), como antes: sus
// direcciones de video llevan la clave o el usuario adentro, así que no se pueden compartir
// desde el servidor sin exponerla (haría falta un proxy de video, que no está implementado).
import { validateAdapter, secretFields, guardedFetch, KINDS } from "./contract.js";
import { decryptSecrets } from "../secrets.js";
import genericHttp from "./generic-http.js";
import archive from "./archive.js";

export const ADAPTERS = {};

export function registerAdapter(def) {
  const problems = validateAdapter(def);
  if (problems.length) throw new Error(`Adaptador "${def?.id || "?"}" inválido: ${problems.join(", ")}`);
  ADAPTERS[def.id] = def;
}

[genericHttp, archive].forEach(registerAdapter);

export const kindsOf = (def, config) => (def.kindsFor ? def.kindsFor(config) : def.kinds).filter(k => KINDS.includes(k));

// Descripción pública de los adaptadores para el panel (sin nada secreto).
export function describeAdapters() {
  return Object.values(ADAPTERS).map(d => ({
    id: d.id, name: d.name, description: d.description, kinds: d.kinds,
    fields: d.fields.map(({ key, label, type, required, secret, help, options }) => ({ key, label, type, required: Boolean(required), secret: Boolean(secret), help: help || "", options: options || null })),
    capabilities: ["catalog", d.listEpisodes && "episodes", d.resolve && "resolve"].filter(Boolean)
  }));
}

// Separa lo que manda el panel en configuración normal y credenciales.
export function splitConfig(def, input = {}) {
  const secretKeys = new Set(secretFields(def));
  const config = {}, secrets = {};
  for (const f of def.fields) {
    if (!(f.key in input)) continue;
    let v = input[f.key];
    if (f.type === "json" && typeof v === "string") v = v.trim();
    if (typeof v !== "string") v = v == null ? "" : String(v);
    if (v.length > 64 * 1024) v = v.slice(0, 64 * 1024);
    (secretKeys.has(f.key) ? secrets : config)[f.key] = v;
  }
  return { config, secrets };
}

// Contexto para usar un proveedor guardado: configuración, credenciales descifradas y fetch con límites.
export async function contextFor(env, row, { fetchImpl = fetch, budget } = {}) {
  const def = ADAPTERS[row.adapter];
  if (!def) throw new Error(`El adaptador "${row.adapter}" ya no existe en el servidor.`);
  const config = JSON.parse(row.config_json || "{}");
  const secrets = await decryptSecrets(env, row.secrets_enc);
  let minIntervalMs = 0;
  try { minIntervalMs = Math.min(10000, Math.max(0, Number(JSON.parse(config.spec || "{}").minIntervalMs) || 0)); } catch { /* sin especificación */ }
  return { def, ctx: { config, secrets, providerId: row.id, fetch: guardedFetch({ secrets, minIntervalMs, fetchImpl, budget }) } };
}
