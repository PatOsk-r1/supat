// Fuentes de contenido: Fuente A y Fuente B (Ajustes → Fuentes de contenido, solo propietario).
//
// Cada una es independiente: su propia configuración, credenciales, importación y reproducción.
// La configuración (sin secretos) se guarda en providers.config_json = { form }; las credenciales,
// cifradas en providers.secrets_enc. Nada específico de un proveedor vive en el código.
import { fail, readJson } from "./http.js";
import { ADAPTERS, contextFor } from "./providers/registry.js";
import { ProviderError, normalizeTitle, normalizeEpisode, guardedFetch } from "./providers/contract.js";
import { encryptSecrets, decryptSecrets, redact, containsSecret } from "./secrets.js";
import { audit, auditStatement, log } from "./log.js";
import { createJob, runPending, activeJob, cancelJob, setPaused } from "./sync.js";
import { jobOut } from "./admin.js";
import { SLOTS, SECRET_FIELDS, ALL_FIELDS, FORM_KEYS, parseKv, missingToSave, missingToActivate } from "../../src/shared/fuente-esquema.js";
import { capabilities, playbackProblems } from "./providers/configurable.js";

const ADAPTER = "configurable";
const SOURCE_IDS = Object.values(SLOTS).map(s => s.id);
const FIELD_TYPES = Object.fromEntries(ALL_FIELDS.map(f => [f.key, f.type]));

function slotOf(params) {
  const slot = SLOTS[params.slot];
  if (!slot) fail(404, "Esa fuente no existe (usar a o b).");
  return slot;
}
const getRow = (env, id) => env.DB.prepare("SELECT * FROM providers WHERE id = ?").bind(id).first();
const formOf = row => (row ? JSON.parse(row.config_json || "{}").form || {} : {});

async function secretsOf(env, row) {
  try { return row ? await decryptSecrets(env, row.secrets_enc) : {}; } catch { return {}; }
}

// Lo que manda el formulario → solo claves conocidas, con tipos y tamaños acotados.
function cleanForm(input = {}) {
  const out = {};
  for (const key of FORM_KEYS) {
    if (!(key in input)) continue;
    const v = input[key];
    out[key] = FIELD_TYPES[key] === "check" ? Boolean(v) : String(v ?? "").slice(0, FIELD_TYPES[key] === "kv" || FIELD_TYPES[key] === "list" ? 8000 : 2000);
  }
  return out;
}

async function counts(env, providerId) {
  const { results } = await env.DB.prepare(`SELECT t.kind, COUNT(*) AS n FROM titles t WHERE EXISTS (SELECT 1 FROM title_sources s
    WHERE s.title_id = t.id AND s.provider_id = ? AND s.removed = 0) GROUP BY t.kind`).bind(providerId).all();
  const out = Object.fromEntries(results.map(r => [r.kind, r.n]));
  out.episodes = (await env.DB.prepare("SELECT COUNT(*) AS n FROM episode_sources WHERE provider_id = ? AND removed = 0").bind(providerId).first())?.n || 0;
  return out;
}

// Vista para el propietario. Nunca incluye valores secretos: solo cuáles están cargados y, de las
// listas personalizadas, los NOMBRES de encabezados/parámetros.
async function view(env, key) {
  const slot = SLOTS[key];
  const row = await getRow(env, slot.id);
  const form = formOf(row);
  const secrets = await secretsOf(env, row);
  const secretsSet = SECRET_FIELDS.filter(k => String(secrets[k] || "") !== "");
  const config = { form };
  const [job, last] = row ? await Promise.all([
    activeJob(env, slot.id),
    env.DB.prepare("SELECT * FROM sync_jobs WHERE provider_id = ? ORDER BY id DESC LIMIT 1").bind(slot.id).first()
  ]) : [null, null];
  return {
    slot: key,
    label: slot.label,
    configured: Boolean(row),
    enabled: Boolean(row?.enabled),
    form,
    secretsSet,
    customSecretNames: { authHeaders: parseKv(secrets.authHeaders).map(([n]) => n), authParams: parseKv(secrets.authParams).map(([n]) => n) },
    missingToSave: missingToSave(form),
    missingToActivate: missingToActivate(form, secretsSet),
    playbackProblems: playbackProblems(config),
    capabilities: capabilities(config),
    lastTest: row?.last_test_at ? { at: row.last_test_at, ok: Boolean(row.last_test_ok), message: row.last_test_message } : null,
    lastSyncAt: row?.last_sync_at || null,
    lastStatus: row?.last_status || "",
    lastError: row?.last_error || "",
    activeJob: job ? jobOut(job) : null,
    lastJob: last ? jobOut(last) : null,
    counts: row ? await counts(env, slot.id) : {}
  };
}

async function requireRow(env, slot) {
  const row = await getRow(env, slot.id);
  if (!row) fail(409, `Primero guardá la configuración de ${slot.label}.`);
  return row;
}

async function saveTest(env, id, result) {
  await env.DB.prepare("UPDATE providers SET last_test_at = ?, last_test_ok = ?, last_test_message = ? WHERE id = ?")
    .bind(Date.now(), result.ok ? 1 : 0, String(result.message).slice(0, 500), id).run();
}

const errText = (err, secrets) => redact(err instanceof ProviderError ? err.message : `Error: ${err?.message || "desconocido"}`, secrets);

// Comprueba desde el servidor que un enlace responda (primer KB), sin devolverlo.
async function probeUrl(url, fetchImpl) {
  try {
    const res = await guardedFetch({ fetchImpl, budget: { left: 1 } })(url, { headers: { Range: "bytes=0-1023" } });
    const ctype = res.headers.get("content-type") || "";
    try { await res.body?.cancel(); } catch { /* nada */ }
    return { status: res.status, contentType: ctype.split(";")[0] };
  } catch (err) {
    return { status: err.status || 0, contentType: "", error: err.message };
  }
}

export const sourcesAdminRoutes = {
  "GET /api/admin/sources": async ({ env }) => ({ sources: { a: await view(env, "a"), b: await view(env, "b") } }),

  // Guardar: valida los datos básicos y explica qué falta. Las credenciales vacías se conservan.
  "PUT /api/admin/sources/:slot": async ({ env, request, user, params }) => {
    const slot = slotOf(params);
    const body = await readJson(request, 256 * 1024);
    const form = cleanForm(body.form);
    const missing = missingToSave(form);
    if (missing.length) fail(400, `Faltan datos para guardar: ${missing.join(", ")}.`, "config");
    const row = await getRow(env, slot.id);
    const saved = await secretsOf(env, row);
    const next = { ...saved };
    const changedSecrets = [];
    for (const k of SECRET_FIELDS) {
      const v = body.secrets?.[k];
      if (typeof v === "string" && v !== "") { next[k] = v.slice(0, 8000); changedSecrets.push(k); }
    }
    for (const k of [].concat(body.clearSecrets || [])) if (SECRET_FIELDS.includes(k) && k in next) { delete next[k]; changedSecrets.push(`${k} (borrada)`); }
    const before = formOf(row);
    const changed = FORM_KEYS.filter(k => JSON.stringify(before[k] ?? "") !== JSON.stringify(form[k] ?? ""));
    const now = Date.now();
    const label = String(form.displayName).trim().slice(0, 60);
    const enc = await encryptSecrets(env, next);
    await env.DB.batch([
      row
        ? env.DB.prepare("UPDATE providers SET label = ?, adapter = ?, config_json = ?, secrets_enc = ?, updated_at = ? WHERE id = ?").bind(label, ADAPTER, JSON.stringify({ form }), enc, now, slot.id)
        : env.DB.prepare("INSERT INTO providers (id, adapter, label, enabled, schedule, config_json, secrets_enc, priority, created_at, updated_at) VALUES (?, ?, ?, 0, 'daily', ?, ?, ?, ?, ?)")
          .bind(slot.id, ADAPTER, label, JSON.stringify({ form }), enc, slot.id === SLOTS.a.id ? 10 : 20, now, now),
      // Solo Fuente A y Fuente B: cualquier proveedor anterior queda apagado (sus datos no se borran).
      env.DB.prepare(`UPDATE providers SET enabled = 0, updated_at = ? WHERE id NOT IN (${SOURCE_IDS.map(() => "?").join(",")}) AND enabled = 1`).bind(now, ...SOURCE_IDS),
      auditStatement(env, user.uid, row ? "source-update" : "source-create", slot.id, `Campos: ${[...changed, ...changedSecrets.map(k => `${k} (credencial)`)].join(", ").slice(0, 450) || "ninguno"}`)
    ]);
    return { source: await view(env, params.slot) };
  },

  "POST /api/admin/sources/:slot/enable": async ({ env, request, user, params }) => {
    const slot = slotOf(params);
    const row = await requireRow(env, slot);
    const { enabled } = await readJson(request);
    if (enabled) {
      const secrets = await secretsOf(env, row);
      const missing = missingToActivate(formOf(row), SECRET_FIELDS.filter(k => secrets[k]));
      if (missing.length) fail(400, `No se puede activar. Falta: ${missing.join(", ")}.`, "config");
    }
    await env.DB.batch([
      env.DB.prepare("UPDATE providers SET enabled = ?, updated_at = ? WHERE id = ?").bind(enabled ? 1 : 0, Date.now(), slot.id),
      auditStatement(env, user.uid, "source-update", slot.id, enabled ? "activada" : "desactivada")
    ]);
    return { source: await view(env, params.slot) };
  },

  "POST /api/admin/sources/:slot/test-connection": async ({ env, user, params, fetchImpl }) => {
    const slot = slotOf(params);
    const row = await requireRow(env, slot);
    const { def, ctx } = await contextFor(env, row, { fetchImpl, budget: { left: 4 } });
    let result;
    try {
      const r = await def.test(ctx);
      result = { ok: true, message: redact(r.message, ctx.secrets), sample: (r.sample || []).map(s => redact(String(s ?? ""), ctx.secrets)) };
    } catch (err) {
      result = { ok: false, message: errText(err, ctx.secrets) };
      await log(env, "warn", "test", `Conexión: ${result.message}`, { providerId: slot.id, secrets: ctx.secrets });
    }
    await saveTest(env, slot.id, result);
    await audit(env, user.uid, "source-test", slot.id, result.ok ? "Conexión correcta" : `Conexión falló: ${result.message}`);
    return result;
  },

  // Primera página de una categoría, normalizada: cuántos resultados, si hay más páginas y qué
  // campos del mapeo se encontraron. Con "episodes", toma la primera serie y pide sus episodios.
  "POST /api/admin/sources/:slot/test-catalog": async ({ env, request, user, params, fetchImpl }) => {
    const slot = slotOf(params);
    const row = await requireRow(env, slot);
    const { kind = "movie" } = await readJson(request);
    const { def, ctx } = await contextFor(env, row, { fetchImpl, budget: { left: 6 } });
    try {
      if (kind === "episodes") {
        if (!def.episodesEnabled(ctx.config)) return { ok: false, message: "Los episodios no están configurados o la categoría no está marcada (no soportado)." };
        const seriesKind = def.kindsFor(ctx.config).find(k => k !== "movie");
        if (!seriesKind) return { ok: false, message: "Hace falta el endpoint de series o de anime para probar episodios." };
        const page = await def.listPage(ctx, { kind: seriesKind, cursor: null });
        const first = page.items.map(i => normalizeTitle(i, def.kindsFor(ctx.config))).find(Boolean);
        if (!first) return { ok: false, message: "La primera página de series no trae resultados válidos (revisá el mapeo de ID y título)." };
        const eps = await def.listEpisodes(ctx, { source: { externalId: first.externalId, data: first.data }, cursor: null });
        const valid = eps.episodes.map(normalizeEpisode).filter(Boolean);
        return { ok: valid.length > 0, message: `Episodios de la primera serie: ${eps.episodes.length} recibidos, ${valid.length} válidos${eps.next ? ", hay más páginas o temporadas" : ""}.`,
          sample: valid.slice(0, 3).map(e => `T${e.season} E${e.number}${e.title ? ` · ${redact(e.title, ctx.secrets)}` : ""}`) };
      }
      if (!def.kindsFor(ctx.config).includes(kind)) return { ok: false, message: `La categoría "${kind}" no está configurada (no soportado).` };
      const page = await def.listPage(ctx, { kind, cursor: null });
      const valid = page.items.map(i => normalizeTitle(i, [kind])).filter(Boolean);
      const has = f => valid.filter(t => (Array.isArray(t[f]) ? t[f].length : t[f])).length;
      const coverage = { titulo: has("title"), anio: has("year"), poster: has("poster"), backdrop: has("backdrop"), descripcion: has("description"), tmdb: has("tmdb"), imdb: has("imdb") };
      await audit(env, user.uid, "source-test", slot.id, `Catálogo (${kind}): ${valid.length} válidos`);
      return {
        ok: valid.length > 0,
        message: `${page.items.length} resultado(s) en la primera página, ${valid.length} válidos; ${page.next ? "hay página siguiente" : "no hay más páginas"}.`,
        coverage, total: valid.length,
        sample: valid.slice(0, 3).map(t => redact(t.title, ctx.secrets))
      };
    } catch (err) {
      const message = errText(err, ctx.secrets);
      await log(env, "warn", "test", `Catálogo (${kind}): ${message}`, { providerId: slot.id, secrets: ctx.secrets });
      return { ok: false, message };
    }
  },

  // Prueba de reproducción: resuelve una película o un episodio (importado, o de la primera página)
  // y comprueba desde el servidor que el enlace responda. No devuelve el enlace.
  "POST /api/admin/sources/:slot/test-playback": async ({ env, request, user, params, fetchImpl }) => {
    const slot = slotOf(params);
    const row = await requireRow(env, slot);
    const { kind = "movie" } = await readJson(request);
    const { def, ctx } = await contextFor(env, row, { fetchImpl, budget: { left: 8 } });
    try {
      const problems = playbackProblems(ctx.config);
      if (problems.length) return { ok: false, message: problems.join(" ") };
      let source = null, episode = null, title = {}, playback = null;
      if (kind === "episode") {
        const ep = await env.DB.prepare(`SELECT es.external_id, es.data_json, es.playback_json, e.season, e.number, s.external_id AS sid, s.data_json AS sdata, t.tmdb_id, t.imdb_id
          FROM episode_sources es JOIN episodes e ON e.id = es.episode_id JOIN title_sources s ON s.title_id = e.title_id AND s.provider_id = es.provider_id JOIN titles t ON t.id = e.title_id
          WHERE es.provider_id = ? AND es.removed = 0 LIMIT 1`).bind(slot.id).first();
        if (ep) {
          source = { externalId: ep.sid, data: JSON.parse(ep.sdata || "{}") };
          episode = { externalId: ep.external_id, data: JSON.parse(ep.data_json || "{}"), season: ep.season, number: ep.number };
          title = { tmdb: ep.tmdb_id ?? "", imdb: ep.imdb_id ?? "" };
          playback = ep.playback_json ? JSON.parse(ep.playback_json) : null;
        } else {
          if (!def.episodesEnabled(ctx.config)) return { ok: false, message: "Los episodios no están configurados (no soportado)." };
          const seriesKind = def.kindsFor(ctx.config).find(k => k !== "movie");
          const first = (await def.listPage(ctx, { kind: seriesKind, cursor: null })).items.map(i => normalizeTitle(i, [seriesKind])).find(Boolean);
          if (!first) return { ok: false, message: "No hay series para probar." };
          source = { externalId: first.externalId, data: first.data };
          title = { tmdb: first.tmdb ?? "", imdb: first.imdb ?? "" };
          const e = (await def.listEpisodes(ctx, { source, cursor: null })).episodes.map(normalizeEpisode).find(Boolean);
          if (!e) return { ok: false, message: "La primera serie no tiene episodios válidos." };
          episode = { externalId: e.externalId, data: e.data, season: e.season, number: e.number };
          playback = e.playback;
        }
      } else {
        const t = await env.DB.prepare(`SELECT s.external_id, s.data_json, s.playback_json, t.tmdb_id, t.imdb_id FROM title_sources s JOIN titles t ON t.id = s.title_id
          WHERE s.provider_id = ? AND s.removed = 0 AND t.kind = 'movie' AND s.playback_json != '' LIMIT 1`).bind(slot.id).first();
        if (t) {
          source = { externalId: t.external_id, data: JSON.parse(t.data_json || "{}") };
          title = { tmdb: t.tmdb_id ?? "", imdb: t.imdb_id ?? "" };
          playback = JSON.parse(t.playback_json);
        } else {
          if (!def.kindsFor(ctx.config).includes("movie")) return { ok: false, message: "Las películas no están configuradas (no soportado)." };
          const first = (await def.listPage(ctx, { kind: "movie", cursor: null })).items.map(i => normalizeTitle(i, ["movie"])).find(Boolean);
          if (!first) return { ok: false, message: "No hay películas para probar." };
          source = { externalId: first.externalId, data: first.data };
          title = { tmdb: first.tmdb ?? "", imdb: first.imdb ?? "" };
          playback = first.playback;
        }
      }
      let resolved = playback?.url ? { url: playback.url, type: playback.type || "" } : null;
      if (!resolved) resolved = await def.resolve(ctx, { source, episode, title });
      const allowed = new Set(def.urlSecretsAllowed?.(ctx.config) || []);
      const guarded = Object.fromEntries(Object.entries(ctx.secrets).filter(([k]) => !allowed.has(k)));
      if (containsSecret(resolved.url, guarded)) return { ok: false, message: "El enlace incluye una credencial privada de la fuente: Supat no lo entrega al navegador." };
      const domains = def.allowedPlaybackOrigins?.(ctx.config) || [];
      let origin = "";
      try { origin = new URL(resolved.url).origin; } catch { return { ok: false, message: "La fuente devolvió una dirección inválida." }; }
      if (domains.length && !domains.includes(origin)) return { ok: false, message: "El enlace es de un dominio que no está en \"Dominios de reproducción permitidos\"." };
      const keyVisible = allowed.has("playbackKey") && containsSecret(resolved.url, { playbackKey: ctx.secrets.playbackKey });
      const probe = resolved.type === "embed" ? null : await probeUrl(resolved.url, fetchImpl);
      const ok = resolved.type === "embed" || [200, 206].includes(probe?.status);
      const message = [
        `Enlace de ${kind === "episode" ? "episodio" : "película"} obtenido (${resolved.type || "formato a detectar"}).`,
        probe ? (probe.status ? `Respondió ${probe.status}${probe.contentType ? ` (${probe.contentType})` : ""}.` : `No respondió: ${redact(probe.error || "", ctx.secrets)}`) : "Reproductor externo: se abre en un iframe.",
        resolved.subtitles?.length ? `${resolved.subtitles.length} subtítulo(s).` : "",
        resolved.expiresAt ? `Vence en ${Math.max(0, Math.round((resolved.expiresAt - Date.now()) / 60000))} min.` : "",
        keyVisible ? "Atención: la credencial de reproducción queda visible en el enlace del navegador." : ""
      ].filter(Boolean).join(" ");
      await audit(env, user.uid, "source-test", slot.id, `Reproducción (${kind}): ${ok ? "correcta" : "falló"}`);
      return { ok, message: redact(message, ctx.secrets) };
    } catch (err) {
      const message = errText(err, ctx.secrets);
      await log(env, "warn", "test", `Reproducción (${kind}): ${message}`, { providerId: slot.id, secrets: ctx.secrets });
      return { ok: false, message };
    }
  },

  "POST /api/admin/sources/:slot/import": async ({ env, request, user, params, fetchImpl }) => {
    const slot = slotOf(params);
    const row = await requireRow(env, slot);
    if (!row.enabled) fail(409, `Activá ${slot.label} antes de importar.`);
    const { mode } = await readJson(request);
    const { job, existing } = await createJob(env, row, { mode: mode === "incremental" ? "incremental" : "full", trigger: "manual", actor: user.uid });
    if (!existing) await audit(env, user.uid, mode === "incremental" ? "sync-incremental" : "sync-full", slot.id, `Trabajo ${job.id}`);
    await runPending(env, { fetchImpl, jobId: job.id });
    return { job: jobOut(await env.DB.prepare("SELECT * FROM sync_jobs WHERE id = ?").bind(job.id).first()), existing };
  },

  "POST /api/admin/sources/:slot/pause": async ({ env, user, params }) => {
    const slot = slotOf(params);
    const job = await activeJob(env, slot.id);
    if (!job) fail(409, "No hay una importación en curso.");
    await setPaused(env, job.id, true);
    await audit(env, user.uid, "sync-pause", slot.id, `Trabajo ${job.id}`);
    return { source: await view(env, params.slot) };
  },

  "POST /api/admin/sources/:slot/resume": async ({ env, user, params, fetchImpl }) => {
    const slot = slotOf(params);
    const job = await activeJob(env, slot.id);
    if (!job) fail(409, "No hay una importación para reanudar.");
    await setPaused(env, job.id, false);
    await audit(env, user.uid, "sync-resume", slot.id, `Trabajo ${job.id}`);
    await runPending(env, { fetchImpl, jobId: job.id });
    return { source: await view(env, params.slot) };
  },

  // Reiniciar: cancela la importación en curso (lo importado se conserva) y empieza una completa
  // desde la primera página. Pide confirmación explícita.
  "POST /api/admin/sources/:slot/restart": async ({ env, request, user, params, fetchImpl }) => {
    const slot = slotOf(params);
    const row = await requireRow(env, slot);
    const { confirm } = await readJson(request);
    if (confirm !== true) fail(400, "Reiniciar la importación necesita confirmación.");
    if (!row.enabled) fail(409, `Activá ${slot.label} antes de importar.`);
    const current = await activeJob(env, slot.id);
    if (current) await cancelJob(env, current.id);
    const { job } = await createJob(env, row, { mode: "full", trigger: "manual", actor: user.uid });
    await audit(env, user.uid, "sync-restart", slot.id, `Trabajo ${job.id}${current ? ` (cancelado ${current.id})` : ""}`);
    await runPending(env, { fetchImpl, jobId: job.id });
    return { source: await view(env, params.slot) };
  },

  "GET /api/admin/sources/:slot/errors": async ({ env, params }) => {
    const slot = slotOf(params);
    const { results } = await env.DB.prepare("SELECT id, at, level, scope, job_id, message FROM logs WHERE provider_id = ? AND level IN ('warn', 'error') ORDER BY id DESC LIMIT 50").bind(slot.id).all();
    return { errors: results.map(l => ({ id: l.id, at: l.at, level: l.level, scope: l.scope, jobId: l.job_id, message: l.message })) };
  }
};

// Estado del catálogo para cualquier usuario: sin direcciones, credenciales ni detalles técnicos.
export async function catalogStatus(env) {
  const { results } = await env.DB.prepare(`SELECT id, enabled, last_status, last_sync_at FROM providers WHERE id IN (${SOURCE_IDS.map(() => "?").join(",")})`).bind(...SOURCE_IDS).all();
  if (!results.length) return { configured: false, available: false };
  const enabled = results.filter(r => r.enabled);
  const ids = enabled.map(r => r.id);
  const c = { movie: 0, series: 0, anime: 0, live: 0, episodes: 0 };
  let importing = false;
  if (ids.length) {
    // Títulos únicos: uno que está en las dos fuentes cuenta una sola vez.
    const marks = ids.map(() => "?").join(",");
    const { results: byKind } = await env.DB.prepare(`SELECT t.kind, COUNT(*) AS n FROM titles t WHERE EXISTS (SELECT 1 FROM title_sources s
      WHERE s.title_id = t.id AND s.removed = 0 AND s.provider_id IN (${marks})) GROUP BY t.kind`).bind(...ids).all();
    for (const r of byKind) c[r.kind] = r.n;
    c.episodes = (await env.DB.prepare(`SELECT COUNT(DISTINCT es.episode_id) AS n FROM episode_sources es WHERE es.removed = 0 AND es.provider_id IN (${marks})`).bind(...ids).first())?.n || 0;
    for (const id of ids) importing ||= Boolean(await activeJob(env, id));
  }
  const total = c.movie + c.series + c.anime + c.live;
  return {
    configured: true,
    enabled: enabled.length > 0,
    available: enabled.length > 0 && total > 0,
    counts: c,
    lastSyncAt: Math.max(0, ...enabled.map(r => r.last_sync_at || 0)) || null,
    importing,
    failing: enabled.some(r => r.last_status === "error")
  };
}
