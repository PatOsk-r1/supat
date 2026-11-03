// Registro de proveedores.
//  - "Tipos": las clases de proveedor que la app sabe usar (demo, Internet Archive, lista M3U, Jellyfin…).
//  - "Instancias": los proveedores que el usuario tiene configurados. Puede haber varias del
//    mismo tipo (por ejemplo, dos listas M3U), cada una con su propia configuración.
// Las instancias se guardan en los ajustes del navegador.
import { settings } from "../app/settings.js";
import demo from "./demo.js";

// Para sumar un tipo nuevo: crear su archivo en esta carpeta e importarlo acá.
export const PROVIDER_TYPES = Object.fromEntries([demo].map(def => [def.type, def]));

const DEFAULT_INSTANCES = [
  { id: "demo", type: "demo", enabled: true }
];

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

export function getInstances() {
  const saved = settings.get("providers");
  const list = Array.isArray(saved) ? saved : defaultInstances();
  return list.filter(i => PROVIDER_TYPES[i.type]).map(complete);
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
  return (def.fields || [])
    .filter(f => f.required && !String(instance.config[f.key] ?? "").trim())
    .map(f => `Falta completar "${f.label}".`);
}
