// Fuente de reproducción de un título o episodio del catálogo central.
// Prueba las fuentes en orden de prioridad (o solo la elegida) hasta que una entrega una dirección
// válida. Un error de una fuente no bloquea a las demás.
// Nunca entrega una dirección que contenga una credencial, salvo la de reproducción cuando el
// propietario eligió explícitamente "dentro de la URL que usa el navegador".
import { contextFor } from "./providers/registry.js";
import { normalizePlayback } from "./providers/contract.js";
import { containsSecret, redact } from "./secrets.js";
import { log } from "./log.js";

const MAX_TRIES = 3;

function checkUrl(playback, def, config, secrets) {
  if (!playback?.url) return "sin dirección";
  const allowed = new Set(def.urlSecretsAllowed?.(config) || []);
  const guarded = Object.fromEntries(Object.entries(secrets).filter(([k]) => !allowed.has(k)));
  if (containsSecret(playback.url, guarded)) return "la dirección incluye una credencial privada de la fuente (no se entrega al navegador)";
  let origin = "";
  try { origin = new URL(playback.url).origin; } catch { /* inválida */ }
  if (playback.type === "embed") {
    const origins = def.embedOrigins?.(config) || [];
    if (!origins.includes(origin)) return "reproductor externo de un dominio no permitido";
  }
  const domains = def.allowedPlaybackOrigins?.(config) || [];
  if (domains.length && !domains.includes(origin)) return "la dirección es de un dominio de reproducción no permitido";
  return "";
}

// Fuentes que ofrecen un título (o un episodio), sin datos técnicos: solo el nombre visible.
export async function listPlaybackSources(env, titleId, episodeId = null) {
  const { results } = episodeId
    ? await env.DB.prepare(`SELECT s.id, p.label FROM title_sources s JOIN providers p ON p.id = s.provider_id
        WHERE s.title_id = ? AND s.removed = 0 AND p.enabled = 1 AND EXISTS (SELECT 1 FROM episode_sources es JOIN episodes e ON e.id = es.episode_id
          WHERE es.episode_id = ? AND e.title_id = s.title_id AND es.provider_id = s.provider_id AND es.removed = 0 AND es.playback_json != '')
        ORDER BY p.priority, s.id`).bind(titleId, episodeId).all()
    : await env.DB.prepare(`SELECT s.id, p.label FROM title_sources s JOIN providers p ON p.id = s.provider_id
        WHERE s.title_id = ? AND s.removed = 0 AND p.enabled = 1 AND s.playback_json != '' ORDER BY p.priority, s.id`).bind(titleId).all();
  return results.map(r => ({ id: r.id, label: r.label }));
}

export async function resolvePlayback(env, titleId, episodeId = null, { fetchImpl = fetch, sourceId = null } = {}) {
  let providerFilter = null;
  if (sourceId) {
    const chosen = await env.DB.prepare("SELECT provider_id FROM title_sources WHERE id = ? AND title_id = ?").bind(sourceId, titleId).first();
    if (!chosen) return { error: "La fuente elegida no ofrece este título." };
    providerFilter = chosen.provider_id;
  }
  const filter = providerFilter ? " AND p.id = ?" : "";
  const extra = providerFilter ? [providerFilter] : [];
  const rows = episodeId
    ? (await env.DB.prepare(`SELECT es.*, p.label, p.adapter, p.config_json, p.secrets_enc, p.id AS pid, e.season, e.number, e.title_id
        FROM episode_sources es JOIN episodes e ON e.id = es.episode_id JOIN providers p ON p.id = es.provider_id
        WHERE es.episode_id = ? AND e.title_id = ? AND es.removed = 0 AND p.enabled = 1 AND es.playback_json != ''${filter} ORDER BY p.priority, es.id LIMIT ?`)
      .bind(episodeId, titleId, ...extra, MAX_TRIES).all()).results
    : (await env.DB.prepare(`SELECT s.*, p.label, p.adapter, p.config_json, p.secrets_enc, p.id AS pid
        FROM title_sources s JOIN providers p ON p.id = s.provider_id
        WHERE s.title_id = ? AND s.removed = 0 AND p.enabled = 1 AND s.playback_json != ''${filter} ORDER BY p.priority, s.id LIMIT ?`)
      .bind(titleId, ...extra, MAX_TRIES).all()).results;
  const title = await env.DB.prepare("SELECT tmdb_id, imdb_id FROM titles WHERE id = ?").bind(titleId).first();

  const problems = [];
  for (const row of rows) {
    const providerRow = { id: row.pid, adapter: row.adapter, config_json: row.config_json, secrets_enc: row.secrets_enc };
    let secrets = {};
    let ctxRef = null;
    try {
      const { def, ctx } = await contextFor(env, providerRow, { fetchImpl, budget: { left: 4 } });
      secrets = ctx.secrets;
      ctxRef = ctx;
      let playback = normalizePlayback(JSON.parse(row.playback_json));
      let extras = {};
      const sourceInfo = async () => {
        const target = { externalId: row.external_id, data: JSON.parse(row.data_json || "{}") };
        if (!episodeId) return { source: target, episode: null };
        const series = await env.DB.prepare("SELECT external_id, data_json FROM title_sources WHERE title_id = ? AND provider_id = ? LIMIT 1").bind(row.title_id, row.pid).first();
        return { source: series ? { externalId: series.external_id, data: JSON.parse(series.data_json || "{}") } : null, episode: { ...target, season: row.season, number: row.number } };
      };
      const titleIds = { tmdb: title?.tmdb_id ?? "", imdb: title?.imdb_id ?? "" };
      if (playback?.lazy) {
        if (!def.resolve) throw new Error("el adaptador no sabe pedir la fuente");
        const { source, episode } = await sourceInfo();
        const resolved = await def.resolve(ctx, { source, episode, title: titleIds });
        playback = normalizePlayback(resolved);
        if (playback && resolved?.type === "embed") playback.type = "embed";
        extras = { subtitles: resolved?.subtitles || [], expiresAt: resolved?.expiresAt || null };
      } else if (playback?.url && def.subtitlesFor) {
        // Método directo: los subtítulos salen de plantillas o del catálogo (sin pedir nada).
        const { source, episode } = await sourceInfo();
        extras = { subtitles: def.subtitlesFor(ctx, { source, episode, title: titleIds }) };
      }
      // Subtítulos con credenciales o direcciones inválidas se descartan.
      extras.subtitles = (extras.subtitles || []).filter(t => /^https?:\/\//i.test(t.url || "") && !containsSecret(t.url, ctx.secrets));
      const why = checkUrl(playback, def, ctx.config, ctx.secrets);
      if (why) throw new Error(why);
      return {
        url: playback.url, type: playback.type || "", provider: row.label,
        ...(extras.subtitles?.length ? { subtitles: extras.subtitles } : {}),
        ...(extras.expiresAt ? { expiresAt: extras.expiresAt } : {}),
        ...(playback.type === "embed" ? { embedOrigins: def.embedOrigins?.(ctx.config) || [] } : {})
      };
    } catch (err) {
      const message = redact(err?.message || "error", secrets);
      // Si la fuente pidió esperar (429), el resto del sistema (importación) también lo respeta.
      if (err?.deferUntil && ctxRef?.saveState) await ctxRef.saveState().catch(() => {});
      problems.push(`${row.label}: ${message}`);
      await log(env, "warn", "play", `No se pudo obtener la fuente (título ${titleId}${episodeId ? `, episodio ${episodeId}` : ""}): ${message}`, { providerId: row.pid, secrets });
    }
  }
  return { error: rows.length ? `Ninguna fuente entregó una reproducción que funcione. ${problems.join(" · ")}` : "Este título no tiene fuentes de reproducción." };
}
