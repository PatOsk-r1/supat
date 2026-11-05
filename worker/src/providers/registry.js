// Adaptadores disponibles en el servidor. Para sumar uno: crear su archivo en esta carpeta
// con el contrato de contract.js e incluirlo en la lista de abajo.
//
// Supat usa dos fuentes de contenido independientes (Fuente A y Fuente B, worker/src/sources.js),
// configuradas desde Ajustes con el adaptador "configurable". El genérico queda como motor y para
// especificaciones escritas a mano.
import { validateAdapter, secretFields, guardedFetch, KINDS } from "./contract.js";
import { decryptSecrets } from "../secrets.js";
import { loadState, saveState, makeGate, makeSession } from "../provider-state.js";
import genericHttp from "./generic-http.js";
import configurable from "./configurable.js";

export const ADAPTERS = {};

export function registerAdapter(def) {
  const problems = validateAdapter(def);
  if (problems.length) throw new Error(`Adaptador "${def?.id || "?"}" inválido: ${problems.join(", ")}`);
  ADAPTERS[def.id] = def;
}

[genericHttp, configurable].forEach(registerAdapter);

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
  // Las credenciales personalizadas ("Nombre=valor") se separan para poder ocultarlas una por una.
  const raw = await decryptSecrets(env, row.secrets_enc);
  const secrets = def.expandSecrets ? def.expandSecrets(raw) : raw;
  let minIntervalMs = 0;
  if (def.minIntervalMs) minIntervalMs = def.minIntervalMs(config);
  else try { minIntervalMs = Math.min(10000, Math.max(0, Number(JSON.parse(config.spec || "{}").minIntervalMs) || 0)); } catch { /* sin especificación */ }
  const timeoutMs = def.timeoutMs ? def.timeoutMs(config) : undefined;
  // Límite de frecuencia y sesión persistentes (si el adaptador los define).
  const rate = def.rateConfig ? def.rateConfig(config) : null;
  const state = rate || def.loginConfig?.(config) ? await loadState(env, row.id) : null;
  const gate = rate ? makeGate(state, rate) : null;
  const fetchFn = guardedFetch({ secrets, minIntervalMs, timeoutMs, fetchImpl, budget, gate });
  const login = def.loginConfig?.(config);
  const ctx = { config, secrets, providerId: row.id, fetch: fetchFn, state, saveState: () => (state ? saveState(env, state) : null) };
  if (login) ctx.session = makeSession(env, state, login, { fetch: fetchFn, secrets, baseUrl: config.form?.baseUrl || config.baseUrl });
  return { def, ctx };
}
