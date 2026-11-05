// Prioridades de datos entre fuentes (Ajustes → Prioridad de datos, solo propietario).
//
// Cada fuente guarda sus propios valores descriptivos (title_sources.meta_json y
// episode_sources.meta_json). El valor que muestra Supat para cada campo es el de la fuente con
// MAYOR prioridad que tenga un valor no vacío. Si ninguna fuente activa lo tiene, se conserva el
// valor guardado (una fuente con un campo vacío nunca borra el de otra).
//
// Configuración:
//   app_settings "priority.active"  → la que se usa al importar y al recalcular;
//   app_settings "priority.pending" → la guardada desde Ajustes, todavía sin aplicar.
// Guardar NO cambia datos. Aplicar exige confirmación, crea una tarea reanudable (maint_jobs) que
// recalcula el catálogo por tandas, y queda en la auditoría.
import { normalizeText } from "./catalog-text.js";

export const TITLE_FIELDS = [
  ["title", "Título"], ["originalTitle", "Título original"], ["description", "Sinopsis"], ["poster", "Póster"],
  ["backdrop", "Imagen de fondo"], ["categories", "Géneros"], ["year", "Año"], ["releaseDate", "Fecha de estreno"], ["rating", "Puntaje"]
];
export const EPISODE_FIELDS = [["epTitle", "Título del episodio"], ["epDescription", "Sinopsis del episodio"], ["epStill", "Imagen del episodio"], ["epDuration", "Duración del episodio"]];
export const ALL_PRIORITY_FIELDS = [...TITLE_FIELDS, ...EPISODE_FIELDS];
export const DEFAULT_ORDER = ["fuente-a", "fuente-b"];

const COLUMN = { title: "title", originalTitle: "original_title", description: "description", poster: "poster", backdrop: "backdrop", categories: "categories_json", year: "year", rating: "rating", releaseDate: null };
const EP_COLUMN = { epTitle: ["title", "title"], epDescription: ["description", "description"], epStill: ["still", "still"], epDuration: ["duration", "duration"] };

export async function getPriorities(env, which = "active") {
  try {
    const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(`priority.${which}`).first();
    return row ? JSON.parse(row.value) : null;
  } catch { return null; }
}

export async function setPriorities(env, which, value) {
  await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(`priority.${which}`, JSON.stringify(value), Date.now()).run();
}

// Valida lo que manda Ajustes: { campo: ["fuente-a", "fuente-b"] }.
export function cleanPriorities(input = {}) {
  const out = {};
  for (const [field] of ALL_PRIORITY_FIELDS) {
    const list = [].concat(input[field] || []).filter(id => DEFAULT_ORDER.includes(id));
    out[field] = [...new Set([...list, ...DEFAULT_ORDER])];
  }
  return out;
}

const orderFor = (priorities, field) => (priorities?.[field]?.length ? priorities[field] : DEFAULT_ORDER);
const rank = (order, providerId) => { const i = order.indexOf(providerId); return i < 0 ? 100 + providerId.charCodeAt(0) : i; };
const empty = v => v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);

// Elige el valor de cada campo según la prioridad. sources: [{ provider_id, meta }].
export function chooseFields(sources, priorities, fields) {
  const out = {};
  for (const [field] of fields) {
    const order = orderFor(priorities, field);
    const sorted = [...sources].sort((a, b) => rank(order, a.provider_id) - rank(order, b.provider_id));
    const winner = sorted.find(s => !empty(s.meta?.[field]));
    if (winner) out[field] = { value: winner.meta[field], from: winner.provider_id };
  }
  return out;
}

const chunk = (list, n = 80) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

async function sourcesOf(env, table, key, ids) {
  const bySource = new Map();
  for (const part of chunk(ids)) {
    const { results } = await env.DB.prepare(`SELECT ${key} AS owner, provider_id, meta_json FROM ${table} WHERE ${key} IN (${part.map(() => "?").join(",")}) AND removed = 0 AND meta_json != ''`).bind(...part).all();
    for (const r of results) {
      if (!bySource.has(r.owner)) bySource.set(r.owner, []);
      try { bySource.get(r.owner).push({ provider_id: r.provider_id, meta: JSON.parse(r.meta_json) }); } catch { /* se ignora */ }
    }
  }
  return bySource;
}

// Cambios que produciría una prioridad sobre ciertos títulos (sin escribir). Devuelve
// [{ id, kind: "title", changes: { campo: [antes, después] } }] y las sentencias para aplicarlos.
export async function diffTitles(env, titleIds, priorities) {
  if (!titleIds.length) return { diffs: [], statements: [] };
  const current = new Map();
  for (const part of chunk(titleIds)) {
    const { results } = await env.DB.prepare(`SELECT id, title, original_title, year, description, poster, backdrop, categories_json, rating FROM titles WHERE id IN (${part.map(() => "?").join(",")})`).bind(...part).all();
    for (const r of results) current.set(r.id, r);
  }
  const sources = await sourcesOf(env, "title_sources", "title_id", titleIds);
  const diffs = [], statements = [];
  for (const [id, row] of current) {
    const chosen = chooseFields(sources.get(id) || [], priorities, TITLE_FIELDS);
    const changes = {}, sets = [], binds = [];
    for (const [field, col] of Object.entries(COLUMN)) {
      if (!col || !chosen[field]) continue;
      let next = chosen[field].value;
      if (field === "categories") next = JSON.stringify(next);
      if (String(row[col] ?? "") === String(next ?? "")) continue;
      changes[field] = [row[col], next];
      sets.push(`${col} = ?`); binds.push(next);
      if (field === "title") { sets.push("title_norm = ?"); binds.push(normalizeText(`${next} ${chosen.originalTitle?.value || row.original_title || ""}`)); }
    }
    if (sets.length) {
      diffs.push({ id, kind: "title", changes });
      statements.push(env.DB.prepare(`UPDATE titles SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).bind(...binds, Date.now(), id));
    }
  }
  return { diffs, statements };
}

export async function diffEpisodes(env, episodeIds, priorities) {
  if (!episodeIds.length) return { diffs: [], statements: [] };
  const current = new Map();
  for (const part of chunk(episodeIds)) {
    const { results } = await env.DB.prepare(`SELECT id, title, description, still, duration FROM episodes WHERE id IN (${part.map(() => "?").join(",")})`).bind(...part).all();
    for (const r of results) current.set(r.id, r);
  }
  const sources = await sourcesOf(env, "episode_sources", "episode_id", episodeIds);
  const diffs = [], statements = [];
  for (const [id, row] of current) {
    const chosen = chooseFields(sources.get(id) || [], priorities, EPISODE_FIELDS);
    const changes = {}, sets = [], binds = [];
    for (const [field, [col]] of Object.entries(EP_COLUMN)) {
      if (!chosen[field] || String(row[col] ?? "") === String(chosen[field].value ?? "")) continue;
      changes[field] = [row[col], chosen[field].value];
      sets.push(`${col} = ?`); binds.push(chosen[field].value);
    }
    if (sets.length) {
      diffs.push({ id, kind: "episode", changes });
      statements.push(env.DB.prepare(`UPDATE episodes SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).bind(...binds, Date.now(), id));
    }
  }
  return { diffs, statements };
}

// Recalcula y guarda (lo usa la importación con la prioridad ACTIVA).
export async function recomputeTitles(env, titleIds, priorities) {
  const { statements, diffs } = await diffTitles(env, [...new Set(titleIds)], priorities);
  if (statements.length) await env.DB.batch(statements);
  return diffs.length;
}
export async function recomputeEpisodes(env, episodeIds, priorities) {
  const { statements, diffs } = await diffEpisodes(env, [...new Set(episodeIds)], priorities);
  if (statements.length) await env.DB.batch(statements);
  return diffs.length;
}
