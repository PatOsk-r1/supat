// Registro de proveedores.
// Supat usa UNA sola fuente de contenido: el catálogo central del servidor, que el propietario
// configura en Ajustes → Fuentes de contenido (ver worker/README.md). No hay catálogos de
// ejemplo ni proveedores alternativos.
//  - "Tipos": las clases de proveedor que la app sabe usar (hoy, solo "central").
//  - "Instancias": cómo está configurado cada tipo en este navegador (activo o no).
// El registro sigue siendo genérico (contrato en contract.js), y las pruebas lo usan con
// adaptadores simulados.
import { settings } from "../app/settings.js";
import central from "./central.js";

import { validateProviderDef } from "./contract.js";

export const PROVIDER_TYPES = {};

export function registerProviderType(def) {
  const problems = validateProviderDef(def);
  if (problems.length) {
    console.warn(`Proveedor "${def?.type || "?"}" descartado: ${problems.join(" ")}`);
    return false;
  }
  PROVIDER_TYPES[def.type] = def;
  return true;
}

export function unregisterProviderType(type) {
  delete PROVIDER_TYPES[type];
}

// El catálogo central solo existe si esta versión tiene la dirección de la API (VITE_SUPAT_API).
if (central.available()) registerProviderType(central);

const DEFAULT_INSTANCES = [{ id: "central", type: "central", enabled: true }];

export function defaultInstances() {
  return DEFAULT_INSTANCES.filter(i => PROVIDER_TYPES[i.type]).map(i => complete(i));
}

function complete(instance) {
  const type = PROVIDER_TYPES[instance.type];
  return {
    id: instance.id,
    type: instance.type,
    label: instance.label || type.name,
    enabled: instance.enabled !== false,
    config: { ...type.defaults, ...(instance.config || {}) }
  };
}

// Proveedores guardados de versiones anteriores (Internet Archive, listas M3U, Jellyfin, demo)
// se ignoran: sus tipos ya no están registrados. La fuente central siempre está activa.
export function getInstances() {
  const saved = settings.get("providers");
  const list = (Array.isArray(saved) ? saved : defaultInstances()).filter(i => PROVIDER_TYPES[i.type]);
  if (PROVIDER_TYPES.central && !list.some(i => i.type === "central")) list.unshift(DEFAULT_INSTANCES[0]);
  return list.map(complete).map(i => (i.type === "central" ? { ...i, enabled: true } : i));
}

export function getInstance(id) {
  return getInstances().find(i => i.id === id) || null;
}

export function providerOf(instanceOrId) {
  const instance = typeof instanceOrId === "string" ? getInstance(instanceOrId) : instanceOrId;
  return instance ? PROVIDER_TYPES[instance.type] : null;
}

function save(list) {
  settings.set("providers", list.map(({ id, type, label, enabled, config }) => ({ id, type, label, enabled, config })));
}

export function addInstance(type, label) {
  const def = PROVIDER_TYPES[type];
  if (!def) throw new Error(`Tipo de proveedor desconocido: ${type}`);
  const list = getInstances();
  if (!def.multiple && list.some(i => i.type === type)) return list.find(i => i.type === type);
  const instance = complete({ id: `${type}-${Date.now().toString(36)}`, type, label: label || def.name, enabled: false });
  save([...list, instance]);
  return instance;
}

export function updateInstance(id, patch) {
  const list = getInstances().map(i => (i.id === id ? { ...i, ...patch, config: { ...i.config, ...(patch.config || {}) } } : i));
  save(list);
  return list.find(i => i.id === id);
}

export function removeInstance(id) {
  save(getInstances().filter(i => i.id !== id));
}

// Revisa que la configuración tenga los campos obligatorios. Devuelve una lista de errores.
export function validateConfig(instance) {
  const def = PROVIDER_TYPES[instance.type];
  const missing = (def.fields || [])
    .filter(f => f.required && !String(instance.config[f.key] ?? "").trim())
    .map(f => `Falta completar "${f.label}".`);
  return [...missing, ...(def.validate?.(instance.config) || [])];
}
