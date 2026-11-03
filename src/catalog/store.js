// Almacén del catálogo: junta lo que entregan los proveedores activos, lo guarda en caché
// y avisa a la interfaz cuando cambia. La interfaz solo habla con este archivo.
import { cacheGet, cacheSet, cacheDelete } from "../app/cache.js";
import { getInstances, getInstance, providerOf, validateConfig } from "../providers/registry.js";
import { LIMITS, redact, withTimeout } from "../providers/contract.js";
import { validateEmbedUrl } from "../player/embed.js";
import { normalizeItem, normalizeSeasons } from "./model.js";

let items = [];
let byId = new Map();
const status = new Map();   // id de proveedor → { state, count, updatedAt, error, fromCache }
const listeners = new Set();
const seasonsCache = new Map();
const epg = new Map();      // id de proveedor → { idDeCanal: [{ start, stop, title, description }] }

function emit() { listeners.forEach(fn => fn()); }

function rebuild(perProvider) {
  items = perProvider.flat();
  byId = new Map(items.map(x => [x.id, x]));
}

const loaded = new Map(); // id de proveedor → elementos normalizados
const lastNetworkLoad = new Map(); // id de proveedor → momento de la última consulta real

// Mensaje de error de un proveedor, sin claves ni contraseñas.
function errorText(err, provider, config) {
  return redact(err?.message || "Error desconocido.", provider, config);
}

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
  // Evita consultar el mismo proveedor muchas veces seguidas (por ejemplo, tocando "Actualizar").
  const recently = Date.now() - (lastNetworkLoad.get(instance.id) || 0) < LIMITS.minRefreshMs;
  if (force && recently && loaded.has(instance.id)) return loaded.get(instance.id);
  if (cached && fresh && !force) {
    status.set(instance.id, { state: "ok", count: cached.items.length, updatedAt: cached.updatedAt, fromCache: true });
    if (cached.epg) epg.set(instance.id, cached.epg);
    return cached.items;
  }

  status.set(instance.id, { ...(status.get(instance.id) || {}), state: "loading" });
  emit();
  try {
    lastNetworkLoad.set(instance.id, Date.now());
    const result = await withTimeout(signal => provider.load(instance.config, { instanceId: instance.id, signal }));
    if (!result || !Array.isArray(result.items)) throw new Error("El proveedor devolvió una respuesta con formato inválido.");
    // Solo se aceptan los tipos de contenido que el proveedor declara, y hasta un máximo.
    const list = result.items.slice(0, LIMITS.maxItems)
      .map(raw => (raw && provider.kinds.includes(raw.kind) ? normalizeItem(raw, instance, provider) : null))
      .filter(Boolean);
    const discarded = Math.min(result.items.length, LIMITS.maxItems) - list.length;
    const notes = [result.warning, discarded ? `Se descartaron ${discarded} elemento(s) incompletos o de un tipo no declarado.` : "",
      result.items.length > LIMITS.maxItems ? `Se usaron los primeros ${LIMITS.maxItems} títulos.` : ""].filter(Boolean);
    const updatedAt = Date.now();
    if (result.epg) epg.set(instance.id, result.epg); else epg.delete(instance.id);
    if (provider.ttl) await cacheSet(key, { items: list, epg: result.epg || null, updatedAt, configHash: JSON.stringify(instance.config) });
    status.set(instance.id, { state: "ok", count: list.length, updatedAt, warning: redact(notes.join(" "), provider, instance.config) });
    return list;
  } catch (err) {
    const message = errorText(err, provider, instance.config);
    if (cached) {
      if (cached.epg) epg.set(instance.id, cached.epg);
      status.set(instance.id, { state: "error", count: cached.items.length, updatedAt: cached.updatedAt, fromCache: true, error: `${message} Se muestra la última copia guardada.` });
      return cached.items;
    }
    status.set(instance.id, { state: "error", count: 0, error: message });
    return [];
  }
}

// Valida una fuente que entrega un proveedor. Los reproductores por iframe solo se aceptan
// desde los orígenes que el proveedor declaró. Devuelve null si la fuente no es válida.
export function checkSource(source, provider) {
  if (!source || typeof source.url !== "string") return null;
  if (source.type === "embed") {
    const check = validateEmbedUrl(source.url, provider?.embedOrigins || []);
    return check.ok ? { url: check.url, type: "embed" } : null;
  }
  try {
    const u = new URL(source.url);
    if (!["http:", "https:"].includes(u.protocol)) return null;
  } catch { return null; }
  return { url: source.url, type: typeof source.type === "string" ? source.type : "" };
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
  // Programa actual y siguiente de un canal, según la guía (XMLTV) de su proveedor.
  nowNext(item, now = Date.now()) {
    const list = epg.get(item.providerId)?.[item.tvgId || item.rawId];
    if (!list?.length) return { now: null, next: null };
    const i = list.findIndex(p => p.start <= now && now < p.stop);
    if (i >= 0) return { now: list[i], next: list[i + 1] || null };
    return { now: null, next: list.find(p => p.start > now) || null };
  },
  schedule(item) {
    return epg.get(item.providerId)?.[item.tvgId || item.rawId] || [];
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
    const instance = getInstance(item.providerId);
    const provider = instance && providerOf(instance);
    if (!target.source.lazy) return checkSource(target.source, provider);
    if (!provider?.resolveSource) return null;
    try {
      const source = await withTimeout(signal => provider.resolveSource(item, episode, instance.config, { instanceId: instance.id, signal }));
      return checkSource(source, provider);
    } catch (err) {
      throw new Error(errorText(err, provider, instance.config));
    }
  },

  // Todas las fuentes disponibles para un título: la de su propio proveedor y las que
  // ofrezcan otros proveedores activos con la capacidad "findSources" (buscan por
  // identificadores externos). Si un proveedor falla, los demás siguen funcionando.
  async sourcesFor(item, episode = null) {
    const options = [];
    if ((episode || item).source) {
      const own = providerOf(getInstance(item.providerId) || { type: "" });
      options.push({ providerId: item.providerId, providerName: item.providerName, label: item.providerName, embedOrigins: own?.embedOrigins || [], resolve: () => catalog.resolveSource(item, episode) });
    }
    const season = episode ? (item.seasons || []).find(s => s.episodes.includes(episode))?.number ?? null : null;
    const query = { kind: item.kind, title: item.title, year: item.year, externalIds: { ...item.externalIds }, season, episode: episode?.number ?? null };
    const others = getInstances().filter(i => i.enabled && i.id !== item.providerId)
      .map(i => ({ instance: i, provider: providerOf(i) }))
      .filter(({ provider }) => typeof provider?.findSources === "function" && provider.kinds.includes(item.kind));
    const results = await Promise.allSettled(others.map(({ instance, provider }) =>
      withTimeout(signal => provider.findSources(query, instance.config, { instanceId: instance.id, signal }))));
    results.forEach((r, n) => {
      const { instance, provider } = others[n];
      if (r.status !== "fulfilled" || !Array.isArray(r.value)) return;
      for (const raw of r.value.slice(0, LIMITS.maxSources)) {
        const source = checkSource(raw, provider);
        if (source) options.push({ providerId: instance.id, providerName: instance.label, label: raw.label ? `${instance.label} · ${String(raw.label).slice(0, 40)}` : instance.label, embedOrigins: provider.embedOrigins || [], resolve: async () => source });
      }
    });
    return options;
  },

  // Temporadas de una serie: las que vienen en el elemento o las que carga el proveedor.
  async seasons(item) {
    if (item.seasons) return item.seasons;
    if (!item.lazySeasons) return [];
    if (seasonsCache.has(item.id)) return seasonsCache.get(item.id);
    const instance = getInstance(item.providerId);
    const provider = instance && providerOf(instance);
    let raw = [];
    if (provider?.loadSeasons) {
      try {
        raw = await withTimeout(signal => provider.loadSeasons(item, instance.config, { instanceId: instance.id, signal }));
      } catch (err) {
        throw new Error(errorText(err, provider, instance.config));
      }
    }
    if (!Array.isArray(raw)) raw = [];
    const seasons = normalizeSeasons(raw, item.id) || [];
    item.seasons = seasons;
    seasonsCache.set(item.id, seasons);
    return seasons;
  }
};
