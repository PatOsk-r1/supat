// Fuente de reproducción de un título o episodio del catálogo central.
// Prueba los proveedores en orden de prioridad hasta que uno entrega una dirección válida.
// Nunca entrega una dirección que contenga una credencial del proveedor.
import { contextFor } from "./providers/registry.js";
import { normalizePlayback } from "./providers/contract.js";
import { containsSecret, redact } from "./secrets.js";
import { log } from "./log.js";

const MAX_TRIES = 3;

function checkUrl(playback, def, config, secrets) {
  if (!playback?.url) return "sin dirección";
  if (containsSecret(playback.url, secrets)) return "la dirección incluye una credencial del proveedor (no se entrega al navegador)";
  if (playback.type === "embed") {
    const origins = def.embedOrigins?.(config) || [];
    let origin = "";
    try { origin = new URL(playback.url).origin; } catch { /* inválida */ }
    if (!origins.includes(origin)) return "reproductor externo de un origen no declarado en la especificación";
  }
  return "";
}

export async function resolvePlayback(env, titleId, episodeId = null, { fetchImpl = fetch } = {}) {
  const rows = episodeId
    ? (await env.DB.prepare(`SELECT es.*, p.label, p.adapter, p.config_json, p.secrets_enc, p.id AS pid, e.season, e.number, e.title_id
        FROM episode_sources es JOIN episodes e ON e.id = es.episode_id JOIN providers p ON p.id = es.provider_id
        WHERE es.episode_id = ? AND e.title_id = ? AND es.removed = 0 AND p.enabled = 1 AND es.playback_json != '' ORDER BY p.priority, es.id LIMIT ?`)
      .bind(episodeId, titleId, MAX_TRIES).all()).results
    : (await env.DB.prepare(`SELECT s.*, p.label, p.adapter, p.config_json, p.secrets_enc, p.id AS pid
        FROM title_sources s JOIN providers p ON p.id = s.provider_id
        WHERE s.title_id = ? AND s.removed = 0 AND p.enabled = 1 AND s.playback_json != '' ORDER BY p.priority, s.id LIMIT ?`)
      .bind(titleId, MAX_TRIES).all()).results;

  const problems = [];
  for (const row of rows) {
    const providerRow = { id: row.pid, adapter: row.adapter, config_json: row.config_json, secrets_enc: row.secrets_enc };
    let secrets = {};
    try {
      const { def, ctx } = await contextFor(env, providerRow, { fetchImpl, budget: { left: 4 } });
      secrets = ctx.secrets;
      let playback = normalizePlayback(JSON.parse(row.playback_json));
      if (playback?.lazy) {
        if (!def.resolve) throw new Error("el adaptador no sabe pedir la fuente");
        const target = { externalId: row.external_id, data: JSON.parse(row.data_json || "{}") };
        let source = target, episode = null;
        if (episodeId) {
          const series = await env.DB.prepare("SELECT external_id, data_json FROM title_sources WHERE title_id = ? AND provider_id = ? LIMIT 1").bind(row.title_id, row.pid).first();
          source = series ? { externalId: series.external_id, data: JSON.parse(series.data_json || "{}") } : null;
          episode = { ...target, season: row.season, number: row.number };
        }
        playback = normalizePlayback(await def.resolve(ctx, { source, episode }));
      }
      const why = checkUrl(playback, def, ctx.config, ctx.secrets);
      if (why) throw new Error(why);
      return { url: playback.url, type: playback.type || "", provider: row.label };
    } catch (err) {
      const message = redact(err?.message || "error", secrets);
      problems.push(`${row.label}: ${message}`);
      await log(env, "warn", "play", `No se pudo obtener la fuente (título ${titleId}${episodeId ? `, episodio ${episodeId}` : ""}): ${message}`, { providerId: row.pid, secrets });
    }
  }
  return { error: rows.length ? `Ningún proveedor entregó una fuente que funcione. ${problems.join(" · ")}` : "Este título no tiene fuentes de reproducción." };
}
