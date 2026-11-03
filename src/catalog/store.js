// Almacén del catálogo: junta lo que entregan los proveedores activos, lo guarda en caché
// y avisa a la interfaz cuando cambia. La interfaz solo habla con este archivo.
import { cacheGet, cacheSet, cacheDelete } from "../app/cache.js";
import { getInstances, getInstance, providerOf, validateConfig } from "../providers/registry.js";
import { normalizeItem, normalizeSeasons } from "./model.js";

let items = [];
let byId = new Map();
const status = new Map();   // id de proveedor → { state, count, updatedAt, error, fromCache }
const listeners = new Set();
const seasonsCache = new Map();

function emit() { listeners.forEach(fn => fn()); }

function rebuild(perProvider) {
  items = perProvider.flat();
  byId = new Map(items.map(x => [x.id, x]));
}

const loaded = new Map(); // id de proveedor → elementos normalizados

async function loadInstance(instance, force) {
  const provider = providerOf(instance);
  const key = `catalogo:${instance.id}`;
  const errors = validateConfig(instance);
  if (errors.length) {
    status.set(instance.id, { state: "error", count: 0, error: errors.join(" ") });
    return [];
  }

  const cached = provider.ttl ? await cacheGet(key) : null;
  const fresh = cached && cached.configHash === JSON.stringify(instance.config) && Date.now() - cached.updatedAt < provider.ttl;
  if (cached && fresh && !force) {
    status.set(instance.id, { state: "ok", count: cached.items.length, updatedAt: cached.updatedAt, fromCache: true });
    return cached.items;
  }

  status.set(instance.id, { ...(status.get(instance.id) || {}), state: "loading" });
  emit();
  try {
    const result = await provider.load(instance.config);
    const list = (result.items || []).map(raw => normalizeItem(raw, instance, provider)).filter(Boolean);
    const updatedAt = Date.now();
    if (provider.ttl) await cacheSet(key, { items: list, updatedAt, configHash: JSON.stringify(instance.config) });
    status.set(instance.id, { state: "ok", count: list.length, updatedAt, warning: result.warning || "" });
    return list;
  } catch (err) {
    const message = err?.message || "Error desconocido.";
    if (cached) {
      status.set(instance.id, { state: "error", count: cached.items.length, updatedAt: cached.updatedAt, fromCache: true, error: `${message} Se muestra la última copia guardada.` });
      return cached.items;
    }
    status.set(instance.id, { state: "error", count: 0, error: message });
    return [];
  }
}

export const catalog = {
  // Carga todos los proveedores activos (desde la caché si está vigente).
  // `only`: id de un proveedor para actualizar solo ese.
  loading: false,
  async load({ force = false, only = null } = {}) {
    catalog.loading = true;
    const instances = getInstances();
    for (const id of [...loaded.keys()]) if (!instances.some(i => i.id === id && i.enabled)) loaded.delete(id);
    for (const i of instances) if (!i.enabled) status.set(i.id, { state: "disabled", count: 0 });
    const targets = instances.filter(i => i.enabled && (!only || i.id === only));
    await Promise.all(targets.map(async i => {
      loaded.set(i.id, await loadInstance(i, force || i.id === only));
      rebuild([...loaded.values()]);
      emit();
    }));
    rebuild([...loaded.values()]);
    catalog.loading = false;
    emit();
  },
  all: () => items,
  get: id => byId.get(id) || null,
  status: id => status.get(id) || { state: "disabled", count: 0 },
  // Categorías presentes para un tipo de contenido, ordenadas por cantidad de títulos.
  categories(kind) {
    const count = new Map();
    for (const x of items) if (x.kind === kind) for (const c of x.categories) count.set(c, (count.get(c) || 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es")).map(([c]) => c);
  },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  async clearCache(id) {
    await cacheDelete(`catalogo:${id}`);
  },

  // Devuelve la fuente reproducible de un elemento (o de un episodio), pidiéndosela al
  // proveedor si hace falta. Devuelve null si no hay fuente.
  async resolveSource(item, episode = null) {
    const target = episode || item;
    if (!target.source) return null;
    if (!target.source.lazy) return target.source;
    const instance = getInstance(item.providerId);
    const provider = instance && providerOf(instance);
    if (!provider?.resolveSource) return null;
    return provider.resolveSource(item, episode, instance.config);
  },

  // Temporadas de una serie: las que vienen en el elemento o las que carga el proveedor.
  async seasons(item) {
    if (item.seasons) return item.seasons;
    if (!item.lazySeasons) return [];
    if (seasonsCache.has(item.id)) return seasonsCache.get(item.id);
    const instance = getInstance(item.providerId);
    const provider = instance && providerOf(instance);
    const raw = provider?.loadSeasons ? await provider.loadSeasons(item, instance.config) : [];
    const seasons = normalizeSeasons(raw, item.id) || [];
    item.seasons = seasons;
    seasonsCache.set(item.id, seasons);
    return seasons;
  }
};
