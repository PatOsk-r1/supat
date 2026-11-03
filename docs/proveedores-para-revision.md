# Supat: arquitectura de proveedores (para revisión)

Este documento reúne la guía para agregar proveedores y el código real que la implementa, para que se pueda revisar y proponer mejoras.

Contexto: app web (Vite + JavaScript, sin frameworks). Por ahora no hay backend: la configuración de cada proveedor se guarda en el navegador. Las cuentas de usuario van con Firebase (plan Spark).

---

## Cómo agregar un proveedor de contenido

La app no depende de ningún proveedor en particular. Cada proveedor es un **adaptador**: un archivo en `src/providers/` que cumple un contrato común (`src/providers/contract.js`). Fichas, catálogo, usuarios y reproductor solo hablan con el catálogo (`src/catalog/store.js`), nunca con un proveedor directamente.

```
proveedores (adaptadores) ──▶ catálogo (store.js) ──▶ interfaz (ui/)
                                   │                        │
                                   └── fuentes ──▶ reproductor (player/)
```

## Capas separadas

| Capa | Dónde | Qué contiene |
|---|---|---|
| Metadatos | `catalog/model.js` | Título, año, categorías, sinopsis, imágenes, temporadas. |
| Identificadores externos | `item.externalIds` | `{ tmdb, imdb }` validados. Los completa el proveedor o TMDb. |
| Disponibilidad | `catalog/tmdb.js` (`watch`) | "Dónde verla": plataformas por país (TMDb + JustWatch). |
| Fuentes | `catalog.sourcesFor()` | Las del proveedor del título y las de otros adaptadores con `findSources`. |
| Reproducción | `player/player.js`, `player/embed.js` | Video propio (MP4, WebM, HLS) o reproductor externo por iframe. |

## El contrato

```js
export default {
  type: "mi-proveedor",            // identificador único, minúsculas
  name: "Mi proveedor",
  description: "Qué ofrece.",
  origin: "De dónde viene el contenido",
  license: "Condiciones de uso (opcional)",
  kinds: ["movie", "series"],      // "live" | "movie" | "series" | "anime"
  multiple: false,                 // ¿se puede agregar más de una vez?
  ttl: 6 * 3600e3,                 // cuánto dura la copia guardada del catálogo (ms); 0 = sin caché
  defaults: { server: "", apiKey: "" },
  fields: [
    { key: "server", label: "Dirección", type: "url", required: true },
    { key: "apiKey", label: "Clave", type: "password", required: true }  // password = secreto
  ],
  validate(config) { return []; }, // errores extra de configuración (opcional)

  // Capacidades: implementar las que correspondan (al menos load o findSources).
  async load(config, { instanceId, signal }) { return { items: [...] }; },
  async loadSeasons(item, config, ctx) { return [{ number: 1, episodes: [...] }]; },
  async resolveSource(item, episode, config, ctx) { return { url, type }; },
  async findSources(query, config, ctx) { return [{ url, type, label }]; },
  embedOrigins: ["https://reproductor.ejemplo"]   // solo si entrega reproductores por iframe
};
```

- **`load`** devuelve títulos con la forma descrita en `catalog/model.js`: `id`, `kind`, `title`, más los opcionales (`year`, `categories`, `poster`, `backdrop`, `description`, `tmdbId`, `imdbId`, `seasons`, `lazySeasons`, `source`…). Usá `source: { lazy: true }` si la dirección se pide al reproducir.
- **`findSources(query)`** recibe `{ kind, title, year, externalIds, season, episode }` y devuelve fuentes para títulos de **otros** proveedores, por ejemplo buscando por `externalIds.tmdb`.
- Fuentes: `{ url, type }` con `type` `"video/mp4"`, `"application/x-mpegurl"`, `""` (se detecta) o `"embed"` (iframe).
- Usá siempre `signal` en tus `fetch(url, { signal })`, para que la app pueda cortar consultas lentas.

## Lo que hace la app por vos

- **Valida el adaptador** al registrarlo. Si no cumple el contrato, se descarta con un aviso sin afectar a los demás.
- **Aísla cada consulta:** tiempo máximo de 20 s, máximo 20.000 títulos y una espera de 30 s entre actualizaciones forzadas. Si un proveedor falla, los demás siguen.
- **Valida las respuestas:** descarta títulos incompletos, tipos que el adaptador no declaró y fuentes con esquemas inseguros (`javascript:`, etc.).
- **Reproductores externos:** solo `https` y solo de los `embedOrigins` declarados. El iframe usa `referrerpolicy="origin"` y `sandbox` (sin ventanas emergentes ni navegación de la página). La app no lee ni modifica su contenido.
- **Secretos:** los campos `password` (o `secret: true`) nunca aparecen en errores, avisos ni datos del catálogo.
- **Interfaz:** Ajustes muestra el adaptador con sus campos, tipos de contenido, capacidades, estado y errores, y permite activarlo, desactivarlo, actualizarlo y quitarlo.

## Registrar uno nuevo

1. Crear `src/providers/mi-proveedor.js` con el contrato.
2. En `src/providers/registry.js`, importarlo y sumarlo a la lista que se pasa a `registerProviderType`.
3. Aparece en Ajustes → "Agregar proveedor".

## Credenciales

La app todavía no tiene servidor, así que hoy la configuración de cada proveedor se guarda **en el navegador** de quien la carga. No uses claves que no deban quedar en ese equipo. Cuando exista el backend, los campos secretos pasarán a guardarse en el servidor (variables de entorno o base de datos), y el adaptador correrá ahí sin cambiar su contrato.

## Pruebas

Copiá el patrón de `tests/arquitectura.test.js`, que usa adaptadores **simulados**: registrar, configurar, activar, simular errores, respuestas incompletas y tiempos de espera. Después corré:

```bash
npm test
```

No incluyas proveedores reales con credenciales en las pruebas.

## Contenido y derechos

Agregar un adaptador es una decisión de quien opera la app. Usá solo proveedores que tengan derechos sobre lo que distribuyen y cuyas condiciones permitan este uso.

---

## Código: `src/providers/contract.js`

```js
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
```

---

## Código: `src/providers/registry.js`

```js
// Registro de proveedores.
//  - "Tipos": las clases de proveedor que la app sabe usar (demo, Internet Archive, lista M3U, Jellyfin…).
//  - "Instancias": los proveedores que el usuario tiene configurados. Puede haber varias del
//    mismo tipo (por ejemplo, dos listas M3U), cada una con su propia configuración.
// Las instancias se guardan en los ajustes del navegador.
import { settings } from "../app/settings.js";
import demo from "./demo.js";
import archive from "./internet-archive.js";
import m3u from "./m3u.js";
import jellyfin from "./jellyfin.js";

import { validateProviderDef } from "./contract.js";

// Tipos registrados. Para sumar uno: crear su adaptador en esta carpeta e incluirlo abajo
// (ver PROVEEDORES.md). Un adaptador que no cumple el contrato se descarta con un aviso,
// sin afectar a los demás.
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

[demo, archive, m3u, jellyfin].forEach(registerProviderType);

// En la vista previa publicada (npm run page) el visor bloquea las conexiones externas,
// así que ahí solo se activa la demostración.
export const PREVIEW = import.meta.env?.MODE === "page";

const DEFAULT_INSTANCES = [
  { id: "archive", type: "archive", enabled: !PREVIEW },
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
  const missing = (def.fields || [])
    .filter(f => f.required && !String(instance.config[f.key] ?? "").trim())
    .map(f => `Falta completar "${f.label}".`);
  return [...missing, ...(def.validate?.(instance.config) || [])];
}
```

---

## Código: `src/catalog/store.js`

```js
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
```

---

## Código: `src/player/embed.js`

```js
// Reproductor externo por iframe (el reproductor oficial de un servicio, embebido).
// Medidas de seguridad:
//  - Solo se aceptan direcciones https de los orígenes que declaró el proveedor.
//  - sandbox: el reproductor puede ejecutar su propio código, pero no abrir ventanas
//    emergentes ni cambiar la página de la app.
//  - referrerpolicy="origin": el servicio solo ve el dominio de la app, no la dirección completa.
// La app no lee ni modifica lo que pasa adentro del iframe (el navegador no lo permite).
import { escapeHtml } from "../app/util.js";

const LOAD_TIMEOUT_MS = 20000;

export function validateEmbedUrl(url, allowedOrigins) {
  let u;
  try { u = new URL(url); } catch { return { ok: false, reason: "La dirección del reproductor no es válida." }; }
  if (u.protocol !== "https:") return { ok: false, reason: "El reproductor externo debe usar https." };
  if (u.username || u.password) return { ok: false, reason: "La dirección del reproductor no puede incluir usuario o contraseña." };
  if (!allowedOrigins.includes(u.origin)) return { ok: false, reason: `El origen ${u.origin} no está permitido para este proveedor.` };
  return { ok: true, url: u.toString() };
}

export function createEmbed(container, { url, title, allowedOrigins = [] }) {
  const check = validateEmbedUrl(url, allowedOrigins);
  if (!check.ok) {
    container.innerHTML = `<div class="player-message" role="alert"><span class="player-icon" aria-hidden="true">▶</span>
      <strong>No se puede abrir este reproductor</strong><small>${escapeHtml(check.reason)}</small></div>`;
    return { destroy() {} };
  }
  container.innerHTML = `<div class="embed">
    <iframe src="${escapeHtml(check.url)}" title="Reproductor: ${escapeHtml(title)}"
      referrerpolicy="origin" loading="eager" allowfullscreen
      allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
      sandbox="allow-scripts allow-same-origin allow-presentation"></iframe>
    <div class="embed-status" role="status"><div class="xp-spinner"></div><small>Cargando el reproductor…</small></div>
  </div>`;
  const frame = container.querySelector("iframe");
  const status = container.querySelector(".embed-status");
  // El navegador no informa errores de un iframe de otro sitio: si no carga en un tiempo
  // razonable, se avisa sin ocultar el reproductor (podría terminar de cargar).
  const timer = setTimeout(() => {
    status.innerHTML = `<small>El reproductor está tardando. Si no aparece, el servicio puede no estar disponible o no permitir este dominio.</small>`;
    status.classList.add("is-slow");
  }, LOAD_TIMEOUT_MS);
  frame.addEventListener("load", () => { clearTimeout(timer); status.remove(); }, { once: true });
  return {
    root: frame,
    destroy() { clearTimeout(timer); frame.src = "about:blank"; }
  };
}
```

---

## Código: `src/providers/internet-archive.js`

```js
// Internet Archive (archive.org): películas de dominio público o con licencia abierta.
// API pública y gratuita, sin clave: https://archive.org/developers/
//  - Búsqueda: advancedsearch.php
//  - Archivos de cada título: /metadata/<identificador>
const SEARCH = "https://archive.org/advancedsearch.php";
const META = "https://archive.org/metadata/";

const DEFAULT_QUERY = 'collection:(feature_films) AND mediatype:(movies) AND format:(MPEG4 OR "h.264") AND NOT subject:(sex OR nudity OR exploitation)';

// Géneros en inglés de archive.org → categorías en español.
const GENRES = [
  [/comed/i, "Comedia"], [/drama|melodrama/i, "Drama"], [/horror|terror/i, "Terror"], [/western/i, "Western"],
  [/sci-?fi|science fiction/i, "Ciencia ficción"], [/crime|gangster|detective/i, "Policial"], [/noir/i, "Cine negro"],
  [/romance|romantic/i, "Romance"], [/adventure/i, "Aventura"], [/myster/i, "Misterio"], [/thriller|suspense/i, "Suspenso"],
  [/war\b|world war/i, "Bélica"], [/animat|cartoon/i, "Animación"], [/documentar/i, "Documental"], [/musical|music/i, "Musical"],
  [/silent/i, "Cine mudo"], [/action/i, "Acción"], [/fantasy/i, "Fantasía"], [/family|children/i, "Familiar"]
];

export function genresFrom(subjects) {
  const text = [].concat(subjects || []).join(" | ");
  const found = GENRES.filter(([re]) => re.test(text)).map(([, name]) => name);
  return found.length ? found.slice(0, 3) : ["Clásicos"];
}

export function stripHtml(s) {
  return String([].concat(s || "")[0] || "")
    .replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim().slice(0, 500);
}

// Elige el mejor archivo de video que un navegador puede reproducir.
const FORMAT_PRIORITY = ["h.264 HD", "h.264", "MPEG4", "512Kb MPEG4", "h.264 IA", "Ogg Video"];
export function pickVideoFile(files) {
  const candidates = (files || []).filter(f => FORMAT_PRIORITY.includes(f.format) || /\.mp4$/i.test(f.name));
  candidates.sort((a, b) => {
    const pa = FORMAT_PRIORITY.indexOf(a.format), pb = FORMAT_PRIORITY.indexOf(b.format);
    return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb);
  });
  return candidates[0] || null;
}

async function getJson(url, what) {
  let res;
  try { res = await fetch(url); } catch { throw new Error(`No se pudo conectar con Internet Archive (${what}).`); }
  if (!res.ok) throw new Error(`Internet Archive respondió con un error (${res.status}).`);
  return res.json();
}

export default {
  type: "archive",
  name: "Internet Archive",
  description: "Películas clásicas de dominio público o con licencia abierta, alojadas en archive.org. No necesita configuración.",
  origin: "archive.org (API pública)",
  license: "Dominio público o licencias abiertas; verificá cada título en archive.org",
  kinds: ["movie"],
  multiple: true,
  ttl: 24 * 3600e3,
  defaults: { query: DEFAULT_QUERY, rows: "150", sort: "downloads desc" },
  fields: [
    { key: "query", label: "Búsqueda en archive.org", type: "textarea", help: "Usa la sintaxis de búsqueda avanzada de archive.org. Por defecto: largometrajes con video MP4." },
    { key: "rows", label: "Cantidad máxima de títulos", type: "number", help: "Entre 20 y 500." },
    { key: "sort", label: "Orden", type: "select", options: [["downloads desc", "Más vistos"], ["year asc", "Más antiguos"], ["year desc", "Más recientes"], ["titleSorter asc", "Título A-Z"]] }
  ],
  async load(config) {
    const rows = Math.min(500, Math.max(20, parseInt(config.rows, 10) || 150));
    const url = new URL(SEARCH);
    url.searchParams.set("q", config.query || DEFAULT_QUERY);
    for (const f of ["identifier", "title", "year", "description", "subject"]) url.searchParams.append("fl[]", f);
    url.searchParams.set("rows", rows);
    url.searchParams.set("sort[]", config.sort || "downloads desc");
    url.searchParams.set("output", "json");
    const data = await getJson(url, "búsqueda");
    const docs = data?.response?.docs || [];
    return {
      items: docs.map(d => ({
        id: d.identifier,
        kind: "movie",
        title: [].concat(d.title || d.identifier)[0],
        year: d.year,
        description: stripHtml(d.description),
        categories: genresFrom(d.subject),
        poster: `https://archive.org/services/img/${encodeURIComponent(d.identifier)}`,
        source: { lazy: true }
      }))
    };
  },
  // La dirección del archivo se busca recién al reproducir (una consulta por título).
  async resolveSource(item) {
    const meta = await getJson(META + encodeURIComponent(item.rawId), "archivos");
    const file = pickVideoFile(meta.files);
    if (!file) throw new Error("Este título de Internet Archive no tiene un archivo de video compatible con el navegador.");
    return {
      url: `https://archive.org/download/${encodeURIComponent(item.rawId)}/${file.name.split("/").map(encodeURIComponent).join("/")}`,
      type: file.format === "Ogg Video" ? "video/ogg" : "video/mp4"
    };
  }
};
```

---

## Código: `tests/arquitectura.test.js`

```js
// Pruebas de la arquitectura de proveedores con adaptadores SIMULADOS (no existen fuera de
// este archivo): registro, configuración, activación, consultas, respuestas incompletas,
// errores, tiempos de espera, fuentes, reproductor externo, credenciales e independencia.
import test from "node:test";
import assert from "node:assert/strict";

const data = { "supat:ajustes": JSON.stringify({ providers: [] }) };
globalThis.localStorage = {
  getItem: k => (k in data ? data[k] : null),
  setItem: (k, v) => { data[k] = String(v); },
  removeItem: k => { delete data[k]; }
};

const registry = await import("../src/providers/registry.js");
const { catalog, checkSource } = await import("../src/catalog/store.js");
const { LIMITS, validateProviderDef, capabilitiesOf, redact } = await import("../src/providers/contract.js");
const { validateEmbedUrl } = await import("../src/player/embed.js");

LIMITS.timeoutMs = 80;      // para que la prueba de tiempo de espera sea rápida
LIMITS.minRefreshMs = 0;

const SECRET = "clave-super-secreta-123";
const calls = { catalogo: 0 };

const mockCatalog = {
  type: "simulado-catalogo", name: "Catálogo simulado", description: "", origin: "prueba",
  kinds: ["movie", "series"], multiple: true, ttl: 0,
  fields: [{ key: "token", label: "Token", type: "password", required: true }],
  defaults: { token: "" },
  async load(config) {
    calls.catalogo++;
    if (config.token !== SECRET) throw new Error(`Token rechazado: ${config.token}`);
    return {
      items: [
        { id: 1, kind: "movie", title: "Película completa", tmdbId: 550, source: { url: "https://cdn.prueba.test/p.mp4" } },
        { id: 2, kind: "movie", title: "" },                 // incompleta: sin título
        { id: 3, kind: "anime", title: "No declarado" },     // tipo que el proveedor no declaró
        null,                                                // basura
        { id: 4, kind: "series", title: "Serie", imdbId: "tt0944947", seasons: [{ number: 1, episodes: [{ number: 1, title: "Uno" }] }] }
      ]
    };
  }
};

const mockRoto = {
  type: "simulado-roto", name: "Roto", description: "", origin: "prueba", kinds: ["movie"], ttl: 0, fields: [], defaults: {},
  async load() { throw new TypeError("Failed to fetch"); }
};

const mockLento = {
  type: "simulado-lento", name: "Lento", description: "", origin: "prueba", kinds: ["movie"], ttl: 0, fields: [], defaults: {},
  load: () => new Promise(resolve => setTimeout(() => resolve({ items: [] }), 1000))
};

const mockFormato = {
  type: "simulado-formato", name: "Formato raro", description: "", origin: "prueba", kinds: ["movie"], ttl: 0, fields: [], defaults: {},
  async load() { return { resultados: "no es una lista" }; }
};

const mockFuentes = {
  type: "simulado-fuentes", name: "Fuentes simuladas", description: "", origin: "prueba",
  kinds: ["movie"], ttl: 0, fields: [], defaults: {},
  embedOrigins: ["https://reproductor.prueba.test"],
  async findSources(query) {
    if (query.externalIds.tmdb !== 550) return [];
    return [
      { type: "embed", url: "https://reproductor.prueba.test/v?id=550", label: "HD" },
      { type: "embed", url: "https://otro-sitio.test/v?id=550" },   // origen no permitido
      { type: "embed", url: "http://reproductor.prueba.test/v" },   // sin https
      { url: "javascript:alert(1)" }                                // esquema peligroso
    ];
  }
};

const mockFuentesRoto = {
  type: "simulado-fuentes-roto", name: "Fuentes rotas", description: "", origin: "prueba",
  kinds: ["movie"], ttl: 0, fields: [], defaults: {},
  async findSources() { throw new Error("caído"); }
};

test("el contrato rechaza adaptadores inválidos y acepta los válidos", () => {
  assert.ok(validateProviderDef({ type: "X mayúscula", name: "", kinds: ["peliculas"], fields: "no" }).length >= 4);
  assert.match(validateProviderDef({ ...mockCatalog, load: undefined }).join(" "), /al menos/);
  assert.match(validateProviderDef({ ...mockFuentes, embedOrigins: ["http://inseguro.test"] }).join(" "), /iframe inválido/);
  assert.equal(registry.registerProviderType({ type: "malo" }), false);
  assert.equal(registry.PROVIDER_TYPES.malo, undefined);
  for (const def of [mockCatalog, mockRoto, mockLento, mockFormato, mockFuentes, mockFuentesRoto]) {
    assert.deepEqual(validateProviderDef(def), [], def.type);
    assert.equal(registry.registerProviderType(def), true);
  }
  assert.deepEqual(capabilitiesOf(mockFuentes), ["sources", "embed"]);
  assert.deepEqual(capabilitiesOf(mockCatalog), ["catalog"]);
});

let ids = {};
test("registro y configuración: campos obligatorios y activación", async () => {
  for (const def of [mockCatalog, mockRoto, mockLento, mockFormato, mockFuentes, mockFuentesRoto]) ids[def.type] = registry.addInstance(def.type).id;
  const inst = registry.getInstance(ids["simulado-catalogo"]);
  assert.equal(inst.enabled, false);
  assert.match(registry.validateConfig(inst)[0], /Token/);
  registry.updateInstance(inst.id, { config: { token: SECRET }, enabled: true });
  await catalog.load();
  assert.equal(catalog.status(inst.id).state, "ok");
  assert.equal(catalog.all().length, 2);
});

test("respuestas incompletas o de tipos no declarados se descartan con aviso", () => {
  const titles = catalog.all().map(x => x.title).sort();
  assert.deepEqual(titles, ["Película completa", "Serie"]);
  assert.match(catalog.status(ids["simulado-catalogo"]).warning, /descartaron 3/);
  assert.deepEqual(catalog.get(`${ids["simulado-catalogo"]}:1`).externalIds, { tmdb: 550 });
  assert.deepEqual(catalog.get(`${ids["simulado-catalogo"]}:4`).externalIds, { imdb: "tt0944947" });
});

test("independencia: un proveedor roto, lento o con formato inválido no afecta a los demás", async () => {
  for (const t of ["simulado-roto", "simulado-lento", "simulado-formato"]) registry.updateInstance(ids[t], { enabled: true });
  await catalog.load({ force: true });
  assert.equal(catalog.all().length, 2);
  assert.equal(catalog.status(ids["simulado-catalogo"]).state, "ok");
  assert.match(catalog.status(ids["simulado-roto"]).error, /Failed to fetch/);
  assert.match(catalog.status(ids["simulado-lento"]).error, /no respondió/);
  assert.match(catalog.status(ids["simulado-formato"]).error, /formato inválido/);
});

test("desactivar un proveedor saca sus títulos; reactivarlo los vuelve a traer", async () => {
  registry.updateInstance(ids["simulado-catalogo"], { enabled: false });
  await catalog.load();
  assert.equal(catalog.all().length, 0);
  assert.equal(catalog.status(ids["simulado-catalogo"]).state, "disabled");
  registry.updateInstance(ids["simulado-catalogo"], { enabled: true });
  await catalog.load();
  assert.equal(catalog.all().length, 2);
});

test("credenciales: no aparecen en errores, avisos ni en los datos del catálogo", async () => {
  registry.updateInstance(ids["simulado-catalogo"], { config: { token: "otro-secreto-456" } });
  await catalog.load({ force: true, only: ids["simulado-catalogo"] });
  const st = catalog.status(ids["simulado-catalogo"]);
  assert.match(st.error, /Token rechazado: ••••/);
  assert.doesNotMatch(JSON.stringify(st), /otro-secreto-456/);
  registry.updateInstance(ids["simulado-catalogo"], { config: { token: SECRET } });
  await catalog.load({ force: true, only: ids["simulado-catalogo"] });
  assert.doesNotMatch(JSON.stringify(catalog.all()), new RegExp(SECRET));
  assert.equal(redact(`url?token=${SECRET}`, mockCatalog, { token: SECRET }), "url?token=••••");
});

test("límite de consultas: dos actualizaciones seguidas no consultan dos veces", async () => {
  LIMITS.minRefreshMs = 60000;
  const before = calls.catalogo;
  await catalog.load({ force: true, only: ids["simulado-catalogo"] });
  await catalog.load({ force: true, only: ids["simulado-catalogo"] });
  assert.equal(calls.catalogo - before, 0, "la actualización anterior fue hace menos de un minuto");
  LIMITS.minRefreshMs = 0;
});

test("fuentes: se combinan la propia y las de otros proveedores, validadas y aisladas", async () => {
  registry.updateInstance(ids["simulado-fuentes"], { enabled: true });
  registry.updateInstance(ids["simulado-fuentes-roto"], { enabled: true });
  const peli = catalog.get(`${ids["simulado-catalogo"]}:1`);
  const options = await catalog.sourcesFor(peli);
  assert.deepEqual(options.map(o => o.label), ["Catálogo simulado", "Fuentes simuladas · HD"]);
  assert.deepEqual(await options[0].resolve(), { url: "https://cdn.prueba.test/p.mp4", type: "" });
  assert.deepEqual(await options[1].resolve(), { url: "https://reproductor.prueba.test/v?id=550", type: "embed" });
  assert.deepEqual(options[1].embedOrigins, ["https://reproductor.prueba.test"]);
  // Un título sin identificador conocido no recibe fuentes de otros.
  const serie = catalog.get(`${ids["simulado-catalogo"]}:4`);
  assert.equal((await catalog.sourcesFor(serie)).length, 0);
});

test("validación de fuentes y del reproductor externo", () => {
  assert.equal(checkSource({ url: "javascript:alert(1)" }, {}), null);
  assert.equal(checkSource({ url: "no es url" }, {}), null);
  assert.equal(checkSource({ type: "embed", url: "https://x.test/e" }, { embedOrigins: [] }), null);
  assert.equal(validateEmbedUrl("http://a.test/e", ["http://a.test"]).ok, false);
  assert.equal(validateEmbedUrl("https://usuario:clave@a.test/e", ["https://a.test"]).ok, false);
  assert.equal(validateEmbedUrl("https://a.test.malo.test/e", ["https://a.test"]).ok, false);
  assert.equal(validateEmbedUrl("https://a.test/e?x=1", ["https://a.test"]).ok, true);
});

test("quitar un tipo de proveedor no rompe el registro", () => {
  registry.unregisterProviderType("simulado-roto");
  assert.ok(!registry.getInstances().some(i => i.type === "simulado-roto"));
});
```
