// Catálogo central: guardar lo que importan los proveedores (sin duplicados) y leerlo.
//
// Duplicados: un título que llega de un proveedor se une a uno existente si coincide
//   1) el mismo proveedor y el mismo id (ya importado antes), o
//   2) el id de TMDb (por tipo: película o serie), o
//   3) el id de IMDb.
// Si no coincide, es un título nuevo. Si TMDb e IMDb apuntan a títulos distintos, se une
// por TMDb y se registra el posible duplicado (no se borra ni se une nada a ciegas).
//
// Cuotas del plan gratuito de D1: cada tanda usa pocas consultas (las escrituras van juntas
// en un batch, que cuenta como una) y lo que no cambió no se vuelve a escribir.

const CHUNK = 90; // D1 acepta hasta 100 parámetros por consulta

export function normalizeText(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim().slice(0, 300);
}

// Huella corta y estable (FNV-1a de 64 bits en dos mitades).
export function fingerprint(value) {
  const text = JSON.stringify(value);
  let h1 = 0x811c9dc5, h2 = 0xcbf29ce4;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822507) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}

const chunks = (list, n = CHUNK) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
const marks = n => Array(n).fill("?").join(",");

async function selectIn(env, sqlBefore, values, sqlAfter = "", extra = []) {
  const out = [];
  for (const part of chunks(values)) {
    if (!part.length) continue;
    const { results } = await env.DB.prepare(`${sqlBefore} (${marks(part.length)}) ${sqlAfter}`).bind(...extra, ...part).all();
    out.push(...results);
  }
  return out;
}

const titleFields = t => [t.title, normalizeText(t.title + " " + t.originalTitle), t.originalTitle, t.year, t.description, t.poster, t.backdrop, JSON.stringify(t.categories), t.rating];

// Guarda una página de títulos ya normalizados (contract.normalizeTitle) de un proveedor.
// Devuelve los contadores de la tanda.
export async function upsertTitles(env, providerId, items, { now = Date.now(), touchSeen = false } = {}) {
  const counts = { seen: items.length, created: 0, updated: 0, merged: 0, unchanged: 0, conflicts: 0, conflictNotes: [] };
  if (!items.length) return counts;

  // Repetidos dentro de la misma página: se queda el último.
  const byExt = new Map(items.map(t => [t.externalId, t]));
  items = [...byExt.values()];

  const existing = new Map((await selectIn(env, "SELECT external_id, title_id, hash FROM title_sources WHERE provider_id = ? AND external_id IN", items.map(t => t.externalId), "", [providerId]))
    .map(r => [r.external_id, r]));

  const tmdbs = [...new Set(items.filter(t => t.tmdb).map(t => t.tmdb))];
  const imdbs = [...new Set(items.filter(t => t.imdb).map(t => t.imdb))];
  const known = [
    ...await selectIn(env, "SELECT id, tmdb_type, tmdb_id, imdb_id, origin_provider FROM titles WHERE tmdb_id IN", tmdbs),
    ...await selectIn(env, "SELECT id, tmdb_type, tmdb_id, imdb_id, origin_provider FROM titles WHERE imdb_id IN", imdbs)
  ];
  const byTmdb = new Map(known.filter(r => r.tmdb_id).map(r => [`${r.tmdb_type}:${r.tmdb_id}`, r]));
  const byImdb = new Map(known.filter(r => r.imdb_id).map(r => [r.imdb_id, r]));
  const linkedIds = [...new Set([...existing.values()].map(r => r.title_id))];
  const linked = new Map((await selectIn(env, "SELECT id, tmdb_type, tmdb_id, imdb_id, origin_provider FROM titles WHERE id IN", linkedIds)).map(r => [r.id, r]));

  const statements = [];
  const unchangedIds = [];
  // Ids externos que se crean en esta misma tanda (para unir repetidos entre sí).
  const pendingTmdb = new Set(), pendingImdb = new Set();
  const claim = (row, t) => {
    // Agrega TMDb/IMDb al título si le faltan y nadie más los usa.
    const sets = [], binds = [];
    if (t.tmdb && !row.tmdb_id) {
      const key = `${t.tmdbType}:${t.tmdb}`;
      if (byTmdb.has(key) || pendingTmdb.has(key)) counts.conflicts++;
      else { sets.push("tmdb_type = ?", "tmdb_id = ?"); binds.push(t.tmdbType, t.tmdb); byTmdb.set(key, row); }
    }
    if (t.imdb && !row.imdb_id) {
      if (byImdb.has(t.imdb) || pendingImdb.has(t.imdb)) counts.conflicts++;
      else { sets.push("imdb_id = ?"); binds.push(t.imdb); byImdb.set(t.imdb, row); }
    }
    return { sets, binds };
  };

  for (const t of items) {
    const hash = fingerprint(t);
    const playback = t.playback ? JSON.stringify(t.playback) : "";
    const data = JSON.stringify(t.data || {});
    const src = existing.get(t.externalId);

    if (src) {
      if (src.hash === hash) { counts.unchanged++; unchangedIds.push(t.externalId); continue; }
      const row = linked.get(src.title_id) || { id: src.title_id };
      const own = row.origin_provider === providerId;
      const { sets, binds } = claim(row, t);
      // Si el título lo creó este proveedor, sus datos mandan; si no, solo completa lo que falta.
      const f = titleFields(t);
      const update = own
        // La fuente que creó el título manda, pero un campo que ahora llega vacío NO borra el guardado.
        ? `UPDATE titles SET title = ?, title_norm = ?, original_title = COALESCE(NULLIF(?, ''), original_title), year = COALESCE(?, year), description = COALESCE(NULLIF(?, ''), description),
            poster = COALESCE(NULLIF(?, ''), poster), backdrop = COALESCE(NULLIF(?, ''), backdrop), categories_json = COALESCE(NULLIF(?, '[]'), categories_json), rating = COALESCE(?, rating),
            has_episodes = MAX(has_episodes, ?), updated_at = ?${sets.map(s => ", " + s).join("")} WHERE id = ?`
        : `UPDATE titles SET original_title = COALESCE(NULLIF(original_title, ''), ?), year = COALESCE(year, ?), description = COALESCE(NULLIF(description, ''), ?), poster = COALESCE(NULLIF(poster, ''), ?), backdrop = COALESCE(NULLIF(backdrop, ''), ?), rating = COALESCE(rating, ?), has_episodes = MAX(has_episodes, ?), updated_at = ?${sets.map(s => ", " + s).join("")} WHERE id = ?`;
      const bind = own ? [...f, t.hasEpisodes ? 1 : 0, now, ...binds, row.id] : [t.originalTitle, t.year, t.description, t.poster, t.backdrop, t.rating, t.hasEpisodes ? 1 : 0, now, ...binds, row.id];
      statements.push(env.DB.prepare(update).bind(...bind));
      statements.push(env.DB.prepare("UPDATE title_sources SET playback_json = ?, data_json = ?, hash = ?, removed = 0, seen_at = ? WHERE provider_id = ? AND external_id = ?")
        .bind(playback, data, hash, now, providerId, t.externalId));
      counts.updated++;
      continue;
    }

    // ¿Ya existe el título (de otro proveedor) por TMDb o IMDb?
    const tKey = t.tmdb ? `${t.tmdbType}:${t.tmdb}` : "";
    const match = (tKey && byTmdb.get(tKey)) || (t.imdb && byImdb.get(t.imdb)) || null;
    if (match) {
      if (t.imdb && match.imdb_id && match.imdb_id !== t.imdb) counts.conflicts++;
      if (tKey && byTmdb.get(tKey) && t.imdb && byImdb.get(t.imdb) && byTmdb.get(tKey).id !== byImdb.get(t.imdb).id) {
        counts.conflicts++;
        counts.conflictNotes.push(`"${t.title}": TMDb ${t.tmdb} e IMDb ${t.imdb} están en títulos distintos (${byTmdb.get(tKey).id} y ${byImdb.get(t.imdb).id}).`);
      }
      const { sets, binds } = claim(match, t);
      statements.push(env.DB.prepare(`UPDATE titles SET original_title = COALESCE(NULLIF(original_title, ''), ?), year = COALESCE(year, ?), description = COALESCE(NULLIF(description, ''), ?), poster = COALESCE(NULLIF(poster, ''), ?), backdrop = COALESCE(NULLIF(backdrop, ''), ?), has_episodes = MAX(has_episodes, ?), updated_at = ?${sets.map(s => ", " + s).join("")} WHERE id = ?`)
        .bind(t.originalTitle, t.year, t.description, t.poster, t.backdrop, t.hasEpisodes ? 1 : 0, now, ...binds, match.id));
      statements.push(env.DB.prepare("INSERT INTO title_sources (title_id, provider_id, external_id, playback_json, data_json, hash, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(match.id, providerId, t.externalId, playback, data, hash, now));
      counts.merged++;
      continue;
    }

    // Título nuevo.
    const tmdbFree = tKey && !pendingTmdb.has(tKey);
    const imdbFree = t.imdb && !pendingImdb.has(t.imdb);
    if (tKey && !tmdbFree) {
      // Otro elemento de esta misma tanda ya lo está creando: se une a ese.
      statements.push(env.DB.prepare("INSERT INTO title_sources (title_id, provider_id, external_id, playback_json, data_json, hash, seen_at) VALUES ((SELECT id FROM titles WHERE tmdb_type = ? AND tmdb_id = ?), ?, ?, ?, ?, ?, ?)")
        .bind(t.tmdbType, t.tmdb, providerId, t.externalId, playback, data, hash, now));
      counts.merged++;
      continue;
    }
    if (!tKey && t.imdb && !imdbFree) {
      statements.push(env.DB.prepare("INSERT INTO title_sources (title_id, provider_id, external_id, playback_json, data_json, hash, seen_at) VALUES ((SELECT id FROM titles WHERE imdb_id = ?), ?, ?, ?, ?, ?, ?)")
        .bind(t.imdb, providerId, t.externalId, playback, data, hash, now));
      counts.merged++;
      continue;
    }
    statements.push(env.DB.prepare("INSERT INTO titles (kind, title, title_norm, original_title, year, description, poster, backdrop, categories_json, rating, tmdb_type, tmdb_id, imdb_id, has_episodes, origin_provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(t.kind, ...titleFields(t), tKey ? t.tmdbType : null, tKey ? t.tmdb : null, imdbFree ? t.imdb : null, t.hasEpisodes ? 1 : 0, providerId, now, now));
    // Va justo después del INSERT del título: last_insert_rowid() es el título recién creado.
    statements.push(env.DB.prepare("INSERT INTO title_sources (title_id, provider_id, external_id, playback_json, data_json, hash, seen_at) VALUES (last_insert_rowid(), ?, ?, ?, ?, ?, ?)")
      .bind(providerId, t.externalId, playback, data, hash, now));
    if (tKey) pendingTmdb.add(tKey);
    if (imdbFree) pendingImdb.add(t.imdb);
    counts.created++;
  }

  // Importación completa: también se marca como visto lo que no cambió (para detectar bajas).
  if (touchSeen) for (const part of chunks(unchangedIds, CHUNK - 2)) {
    statements.push(env.DB.prepare(`UPDATE title_sources SET seen_at = ?, removed = 0 WHERE provider_id = ? AND external_id IN (${marks(part.length)})`).bind(now, providerId, ...part));
  }
  if (statements.length) await env.DB.batch(statements);
  return counts;
}

// Guarda episodios (contract.normalizeEpisode) de una serie, para la fuente `source` (fila de title_sources).
export async function upsertEpisodes(env, providerId, titleId, episodes, { now = Date.now() } = {}) {
  const counts = { seen: episodes.length, saved: 0, unchanged: 0 };
  if (!episodes.length) return counts;
  const byExt = new Map(episodes.map(e => [e.externalId, e]));
  episodes = [...byExt.values()];
  const existing = new Map((await selectIn(env, "SELECT external_id, hash FROM episode_sources WHERE provider_id = ? AND external_id IN", episodes.map(e => e.externalId), "", [providerId]))
    .map(r => [r.external_id, r.hash]));
  const statements = [];
  for (const e of episodes) {
    const hash = fingerprint(e);
    if (existing.get(e.externalId) === hash) { counts.unchanged++; continue; }
    statements.push(env.DB.prepare(`INSERT INTO episodes (title_id, season, number, title, description, still, duration, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (title_id, season, number) DO UPDATE SET title = COALESCE(NULLIF(excluded.title, ''), title), description = COALESCE(NULLIF(excluded.description, ''), description),
      still = COALESCE(NULLIF(excluded.still, ''), still), duration = MAX(duration, excluded.duration), updated_at = excluded.updated_at`)
      .bind(titleId, e.season, e.number, e.title, e.description, e.still, e.duration, now));
    statements.push(env.DB.prepare(`INSERT INTO episode_sources (episode_id, provider_id, external_id, playback_json, data_json, hash, seen_at)
      VALUES ((SELECT id FROM episodes WHERE title_id = ? AND season = ? AND number = ?), ?, ?, ?, ?, ?, ?)
      ON CONFLICT (provider_id, external_id) DO UPDATE SET episode_id = excluded.episode_id, playback_json = excluded.playback_json, data_json = excluded.data_json, hash = excluded.hash, removed = 0, seen_at = excluded.seen_at`)
      .bind(titleId, e.season, e.number, providerId, e.externalId, e.playback ? JSON.stringify(e.playback) : "", JSON.stringify(e.data || {}), hash, now));
    counts.saved++;
  }
  if (statements.length) await env.DB.batch(statements);
  return counts;
}

// ---------- lectura ----------
const ACTIVE = "EXISTS (SELECT 1 FROM title_sources s JOIN providers p ON p.id = s.provider_id WHERE s.title_id = t.id AND s.removed = 0 AND p.enabled = 1)";
const SORTS = { recientes: "t.updated_at DESC, t.id DESC", titulo: "t.title_norm ASC, t.id ASC", anio: "t.year DESC, t.id DESC" };

export function titleOut(r) {
  let categories = [];
  try { categories = JSON.parse(r.categories_json || "[]"); } catch { /* vacío */ }
  return {
    id: r.id, kind: r.kind, title: r.title, originalTitle: r.original_title || "", year: r.year, description: r.description,
    poster: r.poster, backdrop: r.backdrop, categories, rating: r.rating,
    externalIds: { ...(r.tmdb_id ? { tmdb: r.tmdb_id, tmdbType: r.tmdb_type } : {}), ...(r.imdb_id ? { imdb: r.imdb_id } : {}) },
    hasEpisodes: Boolean(r.has_episodes), updatedAt: r.updated_at
  };
}

// Página de títulos. Se pide uno de más para saber si hay página siguiente sin contar toda la tabla.
export async function listTitles(env, { kind = "", page = 1, pageSize = 50, sort = "recientes" } = {}) {
  const where = [ACTIVE];
  const binds = [];
  if (kind) { where.push("t.kind = ?"); binds.push(kind); }
  const { results } = await env.DB.prepare(`SELECT t.* FROM titles t WHERE ${where.join(" AND ")} ORDER BY ${SORTS[sort] || SORTS.recientes} LIMIT ? OFFSET ?`)
    .bind(...binds, pageSize + 1, (page - 1) * pageSize).all();
  return { page, pageSize, hasMore: results.length > pageSize, items: results.slice(0, pageSize).map(titleOut) };
}

// Convierte el texto buscado en una consulta FTS5 segura (cada palabra como prefijo).
export function ftsQuery(q) {
  const words = normalizeText(q).split(" ").filter(w => w.length >= 1).slice(0, 8);
  return words.map(w => `"${w}"*`).join(" ");
}

export async function searchTitles(env, { q, kind = "", page = 1, pageSize = 30 } = {}) {
  const match = ftsQuery(q);
  if (!match) return { page, pageSize, hasMore: false, items: [] };
  const binds = [match];
  let extra = "";
  if (kind) { extra = " AND t.kind = ?"; binds.push(kind); }
  const { results } = await env.DB.prepare(`SELECT t.* FROM titles_fts f JOIN titles t ON t.id = f.rowid WHERE titles_fts MATCH ?${extra} AND ${ACTIVE} ORDER BY f.rank LIMIT ? OFFSET ?`)
    .bind(...binds, pageSize + 1, (page - 1) * pageSize).all();
  return { page, pageSize, hasMore: results.length > pageSize, items: results.slice(0, pageSize).map(titleOut) };
}

// Ficha completa: título, de qué proveedores viene (sin datos internos) y temporadas.
export async function titleDetail(env, id) {
  const row = await env.DB.prepare(`SELECT t.* FROM titles t WHERE t.id = ? AND ${ACTIVE}`).bind(id).first();
  if (!row) return null;
  const [{ results: sources }, { results: eps }] = await env.DB.batch([
    env.DB.prepare(`SELECT s.id, s.provider_id, p.label, s.playback_json != '' AS playable, s.episodes_synced_at FROM title_sources s JOIN providers p ON p.id = s.provider_id
      WHERE s.title_id = ? AND s.removed = 0 AND p.enabled = 1 ORDER BY p.priority, s.id`).bind(id),
    env.DB.prepare(`SELECT e.id, e.season, e.number, e.title, e.description, e.still, e.duration FROM episodes e WHERE e.title_id = ?
      AND EXISTS (SELECT 1 FROM episode_sources es JOIN providers p ON p.id = es.provider_id WHERE es.episode_id = e.id AND es.removed = 0 AND p.enabled = 1)
      ORDER BY e.season, e.number LIMIT 3000`).bind(id)
  ]);
  const seasons = new Map();
  for (const e of eps) {
    if (!seasons.has(e.season)) seasons.set(e.season, []);
    seasons.get(e.season).push({ id: e.id, number: e.number, title: e.title, description: e.description, still: e.still, duration: e.duration });
  }
  return {
    ...titleOut(row),
    sources: sources.map(s => ({ id: s.id, provider: s.label, playable: Boolean(s.playable) })),
    episodesPending: Boolean(row.has_episodes) && !eps.length && sources.some(s => !s.episodes_synced_at),
    seasons: [...seasons.entries()].map(([number, episodes]) => ({ number, episodes }))
  };
}

export async function stats(env) {
  const rows = await env.DB.batch([
    env.DB.prepare("SELECT kind, COUNT(*) AS n FROM titles GROUP BY kind"),
    env.DB.prepare("SELECT provider_id, COUNT(*) AS n, SUM(removed) AS removed FROM title_sources GROUP BY provider_id"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM episodes"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM titles WHERE (SELECT COUNT(*) FROM title_sources s WHERE s.title_id = titles.id) > 1"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM titles WHERE tmdb_id IS NOT NULL OR imdb_id IS NOT NULL")
  ]);
  return {
    titlesByKind: Object.fromEntries(rows[0].results.map(r => [r.kind, r.n])),
    sourcesByProvider: rows[1].results.map(r => ({ providerId: r.provider_id, count: r.n, removed: r.removed || 0 })),
    episodes: rows[2].results[0]?.n || 0,
    multiSource: rows[3].results[0]?.n || 0,
    withExternalIds: rows[4].results[0]?.n || 0
  };
}
