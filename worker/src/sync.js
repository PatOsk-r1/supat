// Importación y sincronización por tandas.
//
// Un "trabajo" (sync_jobs) recorre el catálogo de un proveedor página por página y guarda en
// cursor_json dónde quedó. Cada ejecución (cron cada 10 minutos, o "Continuar" desde el panel)
// procesa unas pocas páginas y se detiene: así respeta los límites del plan gratuito
// (10 ms de CPU, 50 consultas a D1 y 50 consultas externas por ejecución).
//
// Fases: "items" (títulos, tipo por tipo) → "episodes" (temporadas y episodios de las series)
//        → fin (en la importación completa, marca como "ya no disponible" lo que el proveedor dejó de ofrecer;
//          nunca borra).
// Errores: si el proveedor falla de forma temporal (429, 5xx, red) se reintenta más tarde con
// espera creciente (1, 2, 4, 8, 16 minutos); después de 5 intentos el trabajo queda "failed".
import { ADAPTERS, contextFor, kindsOf } from "./providers/registry.js";
import { normalizeTitle, normalizeEpisode, ProviderError, LIMITS } from "./providers/contract.js";
import { upsertTitles, upsertEpisodes } from "./catalog.js";
import { log } from "./log.js";
import { redact } from "./secrets.js";

const MAX_ATTEMPTS = 5;
const MAX_STALLS = 5;        // ejecuciones que se cortaron sin guardar avance (por ejemplo, por el límite de CPU)
const DB_BUDGET = 38;        // consultas a D1 por ejecución (el plan gratuito permite 50)

const episodesOn = (def, config) => (def.episodesEnabled ? def.episodesEnabled(config) : Boolean(def.listEpisodes));

// Cuenta las consultas a D1 de esta ejecución (un batch cuenta como una), para cortar antes del límite.
function countingDb(db) {
  const counter = { n: 0 };
  const wrap = stmt => new Proxy(stmt, {
    get(target, prop) {
      if (prop === "__target") return target; // D1 recibe en batch() la consulta original, no el envoltorio
      if (prop === "bind") return (...args) => wrap(target.bind(...args));
      if (["first", "all", "run", "raw"].includes(prop)) return (...args) => { counter.n++; return target[prop](...args); };
      const v = target[prop];
      return typeof v === "function" ? v.bind(target) : v;
    }
  });
  const proxy = new Proxy(db, {
    get(target, prop) {
      if (prop === "prepare") return sql => wrap(target.prepare(sql));
      if (prop === "batch") return stmts => { counter.n++; return target.batch(stmts.map(s => s.__target || s)); };
      const v = target[prop];
      return typeof v === "function" ? v.bind(target) : v;
    }
  });
  return { db: proxy, counter };
}
const LOCK_MS = 90 * 1000;
const RUN_WALL_MS = 20 * 1000;
const INCREMENTAL_MARGIN_MS = 3600 * 1000;

const ACTIVE_STATES = "('queued', 'running')";

export async function activeJob(env, providerId) {
  return env.DB.prepare(`SELECT * FROM sync_jobs WHERE provider_id = ? AND status IN ${ACTIVE_STATES} ORDER BY id DESC LIMIT 1`).bind(providerId).first();
}

// Crea un trabajo. Si ya hay uno activo para ese proveedor, devuelve ese (no se duplican).
export async function createJob(env, provider, { mode = "incremental", trigger = "manual", actor = "", allowRemovals = false } = {}) {
  const current = await activeJob(env, provider.id);
  if (current) return { job: current, existing: true };
  const def = ADAPTERS[provider.adapter];
  const config = JSON.parse(provider.config_json || "{}");
  // Sin una sincronización completa previa, la "incremental" no tiene desde cuándo: se hace completa.
  if (mode === "incremental" && !provider.last_sync_at) mode = "full";
  const incremental = mode === "incremental" && def?.supportsIncremental?.(config);
  const since = incremental ? provider.last_sync_at - INCREMENTAL_MARGIN_MS : null;
  const now = Date.now();
  const cursor = { phase: "items", kinds: def ? kindsOf(def, config) : [], ki: 0, cursor: null, ...(allowRemovals ? { allowRemovals: true } : {}) };
  const res = await env.DB.prepare("INSERT INTO sync_jobs (provider_id, mode, status, cursor_json, since, next_run_at, trigger, created_by, created_at) VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?) RETURNING *")
    .bind(provider.id, mode, JSON.stringify(cursor), since, now, trigger, actor, now).first();
  await log(env, "info", "sync", `Trabajo ${res.id} creado (${mode === "full" ? "importación completa" : incremental ? "incremental" : "actualización (el proveedor no permite pedir solo cambios)"}, ${trigger}).`, { providerId: provider.id, jobId: res.id });
  return { job: res, existing: false };
}

// Toma el próximo trabajo pendiente con un candado (para que dos ejecuciones no lo procesen a la vez).
async function claim(env, now, onlyJobId = null) {
  const row = onlyJobId
    ? await env.DB.prepare(`SELECT id FROM sync_jobs WHERE id = ? AND status IN ${ACTIVE_STATES} AND paused = 0 AND locked_until < ?`).bind(onlyJobId, now).first()
    : await env.DB.prepare(`SELECT id FROM sync_jobs WHERE status IN ${ACTIVE_STATES} AND paused = 0 AND next_run_at <= ? AND locked_until < ? ORDER BY next_run_at, id LIMIT 1`).bind(now, now).first();
  if (!row) return null;
  // "stalls" sube al tomar el trabajo y vuelve a 0 cuando se guarda avance: si una ejecución
  // se corta (límite de CPU o de tiempo) sin guardar, queda contada.
  const res = await env.DB.prepare(`UPDATE sync_jobs SET locked_until = ?, status = 'running', started_at = COALESCE(started_at, ?), stalls = stalls + 1 WHERE id = ? AND locked_until < ? AND status IN ${ACTIVE_STATES} RETURNING *`)
    .bind(now + LOCK_MS, now, row.id, now).first();
  return res || null;
}

function saveJob(env, job, cursor, extra = {}) {
  const f = { ...job, ...extra };
  return env.DB.prepare(`UPDATE sync_jobs SET status = ?, cursor_json = ?, pages = ?, seen = ?, created = ?, updated = ?, merged = ?, unchanged = ?, conflicts = ?, skipped = ?, episodes = ?,
    attempts = ?, next_run_at = ?, locked_until = ?, last_error = ?, finished_at = ?, stalls = 0 WHERE id = ?`)
    .bind(f.status, JSON.stringify(cursor), f.pages, f.seen, f.created, f.updated, f.merged, f.unchanged, f.conflicts, f.skipped, f.episodes,
      f.attempts, f.next_run_at, f.locked_until, String(f.last_error || "").slice(0, 500), f.finished_at ?? null, f.id).run();
}

// Procesa una tanda de un trabajo ya tomado. Devuelve el trabajo actualizado.
export async function runJobStep(baseEnv, job, { fetchImpl = fetch, pages = Number(baseEnv.SYNC_PAGES_PER_RUN) || 3, deadline = Date.now() + RUN_WALL_MS } = {}) {
  const { db, counter } = countingDb(baseEnv.DB);
  const env = { ...baseEnv, DB: db };
  const provider = await env.DB.prepare("SELECT * FROM providers WHERE id = ?").bind(job.provider_id).first();
  const now = Date.now();
  if (job.stalls > MAX_STALLS) {
    const message = "Varias ejecuciones seguidas se cortaron sin poder guardar avance (probablemente el límite de CPU del plan gratuito con páginas muy grandes). Achicá la cantidad de títulos por página en la especificación y volvé a sincronizar: lo ya importado se conserva.";
    await saveJob(env, job, JSON.parse(job.cursor_json), { status: "failed", locked_until: 0, finished_at: now, last_error: message });
    await log(env, "error", "sync", `Trabajo ${job.id}: ${message}`, { providerId: job.provider_id, jobId: job.id });
    return { ...job, status: "failed" };
  }
  if (!provider || !provider.enabled || !ADAPTERS[provider.adapter]) {
    const why = !provider ? "el proveedor ya no existe" : !provider.enabled ? "el proveedor está desactivado" : "su adaptador ya no existe";
    await saveJob(env, job, JSON.parse(job.cursor_json), { status: "cancelled", locked_until: 0, finished_at: now, last_error: `Cancelado: ${why}.` });
    return { ...job, status: "cancelled" };
  }

  let ctxInfo;
  try {
    ctxInfo = await contextFor(env, provider, { fetchImpl, budget: { left: LIMITS.maxSubrequests } });
  } catch (err) {
    await saveJob(env, job, JSON.parse(job.cursor_json), { status: "failed", locked_until: 0, finished_at: now, last_error: err.message });
    await log(env, "error", "sync", err.message, { providerId: provider.id, jobId: job.id });
    return { ...job, status: "failed" };
  }
  const { def, ctx } = ctxInfo;
  const kinds = kindsOf(def, ctx.config);
  const cursor = JSON.parse(job.cursor_json || "{}");
  const j = { ...job };
  let done = 0;

  try {
    while (done < pages && Date.now() < deadline && counter.n < DB_BUDGET) {
      if (cursor.phase === "items") {
        const kind = cursor.kinds?.[cursor.ki];
        if (!kind) { cursor.phase = episodesOn(def, ctx.config) ? "episodes" : "finish"; cursor.cursor = null; continue; }
        const page = await def.listPage(ctx, { kind, cursor: cursor.cursor, since: j.since });
        // Se procesa la página completa (sin recortar): el tamaño lo decide la especificación.
        const raw = Array.isArray(page?.items) ? page.items : [];
        const items = raw.map(r => normalizeTitle(r, kinds)).filter(Boolean);
        const c = await upsertTitles(env, provider.id, items, { touchSeen: j.mode === "full" });
        for (const note of c.conflictNotes.slice(0, 3)) await log(env, "warn", "duplicados", note, { providerId: provider.id, jobId: j.id });
        j.pages++; j.seen += raw.length; j.created += c.created; j.updated += c.updated; j.merged += c.merged; j.unchanged += c.unchanged; j.conflicts += c.conflicts; j.skipped += raw.length - items.length;
        if (page?.next) cursor.cursor = page.next;
        else { cursor.ki++; cursor.cursor = null; }
        done++;
      } else if (cursor.phase === "episodes") {
        const source = cursor.ep
          ? await env.DB.prepare("SELECT * FROM title_sources WHERE id = ?").bind(cursor.ep.id).first()
          : await env.DB.prepare(`SELECT s.* FROM title_sources s JOIN titles t ON t.id = s.title_id WHERE s.provider_id = ? AND s.removed = 0 AND t.has_episodes = 1
              AND (s.episodes_synced_at IS NULL OR (s.episodes_synced_at < ? AND (? = 'full' OR s.seen_at >= ?))) ORDER BY s.id LIMIT 1`)
            .bind(provider.id, j.started_at, j.mode, j.started_at).first();
        if (!source) { cursor.phase = "finish"; delete cursor.ep; continue; }
        const src = { externalId: source.external_id, data: JSON.parse(source.data_json || "{}") };
        let page;
        try {
          page = await def.listEpisodes(ctx, { source: src, cursor: cursor.ep?.cursor || null });
        } catch (err) {
          if (!(err instanceof ProviderError) || err.retryable) throw err;
          // Falla permanente de UNA serie (por ejemplo 404): se registra y se sigue con las demás.
          await log(env, "warn", "episodes", `Episodios del título ${source.title_id} (${source.external_id}): ${redact(err.message, ctx.secrets)}`, { providerId: provider.id, jobId: j.id });
          await env.DB.prepare("UPDATE title_sources SET episodes_synced_at = ? WHERE id = ?").bind(Date.now(), source.id).run();
          delete cursor.ep;
          j.skipped++;
          done++;
          continue;
        }
        const episodes = (page?.episodes || []).map(normalizeEpisode).filter(Boolean);
        const c = await upsertEpisodes(env, provider.id, source.title_id, episodes);
        j.pages++; j.episodes += c.saved; j.skipped += (page?.episodes?.length || 0) - episodes.length;
        if (page?.next) cursor.ep = { id: source.id, cursor: page.next };
        else {
          delete cursor.ep;
          await env.DB.prepare("UPDATE title_sources SET episodes_synced_at = ? WHERE id = ?").bind(Date.now(), source.id).run();
        }
        done++;
      } else {
        // Fin: en la completa, lo que no apareció queda marcado como no disponible (no se borra).
        const finished = Date.now();
        const statements = [];
        if (j.mode === "full") {
          // Protección: si faltarían más del 10% de los títulos activos (y más de 20), no se dan de
          // baja: lo más probable es una respuesta incompleta de la fuente. Se confirman reiniciando
          // la importación con "allowRemovals".
          const { active, missing } = await env.DB.prepare(`SELECT SUM(removed = 0) AS active, SUM(removed = 0 AND seen_at < ?) AS missing FROM title_sources WHERE provider_id = ?`)
            .bind(j.started_at, provider.id).first() || {};
          const suspicious = (missing > 20 && missing > (active || 0) * 0.1) || (missing > 0 && j.seen === 0);
          if (suspicious && !cursor.allowRemovals) {
            await log(env, "warn", "sync", `Trabajo ${j.id}: la fuente no devolvió ${missing} de ${active} títulos; no se marcaron como no disponibles por precaución. Si las bajas son reales, reiniciá la importación confirmando las bajas.`, { providerId: provider.id, jobId: j.id });
          } else {
            statements.push(env.DB.prepare("UPDATE title_sources SET removed = 1 WHERE provider_id = ? AND removed = 0 AND seen_at < ?").bind(provider.id, j.started_at));
          }
        }
        statements.push(env.DB.prepare("UPDATE providers SET last_sync_at = ?, last_status = 'ok', last_error = '', updated_at = ? WHERE id = ?").bind(j.started_at, finished, provider.id));
        await env.DB.batch(statements);
        Object.assign(j, { status: "done", locked_until: 0, finished_at: finished, last_error: "" });
        await saveJob(env, j, cursor);
        await log(env, "info", "sync", `Trabajo ${j.id} terminado: ${j.pages} páginas, ${j.seen} recibidos, ${j.created} nuevos, ${j.updated} actualizados, ${j.merged} unidos a títulos existentes, ${j.unchanged} sin cambios, ${j.episodes} episodios, ${j.skipped} descartados.`, { providerId: provider.id, jobId: j.id });
        return j;
      }
      j.attempts = 0;
      await saveJob(env, j, cursor, { status: "running", next_run_at: Date.now(), locked_until: Date.now() + LOCK_MS });
    }
    // Quedó trabajo pendiente: se libera el candado para la próxima ejecución.
    await saveJob(env, j, cursor, { status: "running", next_run_at: Date.now(), locked_until: 0 });
    return { ...j, status: "running" };
  } catch (err) {
    const message = redact(err?.message || "Error desconocido.", ctx.secrets);
    const budgetOut = err instanceof ProviderError && err.status === -1;
    if (budgetOut) {
      await saveJob(env, j, cursor, { status: "running", next_run_at: Date.now(), locked_until: 0 });
      return { ...j, status: "running" };
    }
    const retryable = err instanceof ProviderError && err.retryable;
    const attempts = j.attempts + 1;
    // Reintentos configurables por fuente (Ajustes); si no, 5 intentos desde 1 minuto.
    const policy = def.retryPolicy ? def.retryPolicy(ctx.config) : { max: MAX_ATTEMPTS, delayMs: 60000 };
    if (retryable && attempts < policy.max) {
      const wait = Math.min(6 * 3600e3, policy.delayMs * 2 ** (attempts - 1));
      await saveJob(env, j, cursor, { status: "running", attempts, next_run_at: Date.now() + wait, locked_until: 0, last_error: message });
      await log(env, "warn", "sync", `Trabajo ${j.id}: ${message} Reintento ${attempts}/${policy.max - 1} en ${Math.round(wait / 1000)} s.`, { providerId: provider.id, jobId: j.id, secrets: ctx.secrets });
      return { ...j, status: "running", attempts };
    }
    const finished = Date.now();
    await saveJob(env, j, cursor, { status: "failed", attempts, locked_until: 0, finished_at: finished, last_error: message });
    await env.DB.prepare("UPDATE providers SET last_status = 'error', last_error = ?, updated_at = ? WHERE id = ?").bind(message.slice(0, 500), finished, provider.id).run();
    await log(env, "error", "sync", `Trabajo ${j.id} falló: ${message}`, { providerId: provider.id, jobId: j.id, secrets: ctx.secrets });
    if (!(err instanceof ProviderError)) console.error(err);
    return { ...j, status: "failed" };
  }
}

// Procesa trabajos pendientes hasta agotar el tiempo de esta ejecución.
export async function runPending(env, { fetchImpl = fetch, jobId = null, maxJobs = 3 } = {}) {
  const deadline = Date.now() + RUN_WALL_MS;
  const results = [];
  for (let n = 0; n < maxJobs && Date.now() < deadline; n++) {
    const job = await claim(env, Date.now(), jobId);
    if (!job) break;
    results.push(await runJobStep(env, job, { fetchImpl, deadline }));
    if (jobId) break;
  }
  return results;
}

// Cron diario: un trabajo incremental por cada proveedor activo con sincronización diaria.
export async function scheduleDaily(env) {
  const { results } = await env.DB.prepare("SELECT * FROM providers WHERE enabled = 1 AND schedule = 'daily'").all();
  const created = [];
  for (const p of results) {
    const { job, existing } = await createJob(env, p, { mode: "incremental", trigger: "cron" });
    if (!existing) created.push(job.id);
  }
  return created;
}

export async function cancelJob(env, jobId) {
  const res = await env.DB.prepare(`UPDATE sync_jobs SET status = 'cancelled', locked_until = 0, finished_at = ? WHERE id = ? AND status IN ${ACTIVE_STATES} RETURNING id`).bind(Date.now(), jobId).first();
  return Boolean(res);
}

// Episodios de una serie a pedido (al abrir la ficha, si todavía no se importaron).
export async function fetchEpisodesNow(env, sourceRow, { fetchImpl = fetch, maxPages = 3 } = {}) {
  const provider = await env.DB.prepare("SELECT * FROM providers WHERE id = ? AND enabled = 1").bind(sourceRow.provider_id).first();
  if (!provider) return 0;
  const { def, ctx } = await contextFor(env, provider, { fetchImpl, budget: { left: maxPages + 2 } });
  if (!def.listEpisodes || !episodesOn(def, ctx.config)) return 0;
  const src = { externalId: sourceRow.external_id, data: JSON.parse(sourceRow.data_json || "{}") };
  let cursor = null, saved = 0;
  for (let i = 0; i < maxPages; i++) {
    const page = await def.listEpisodes(ctx, { source: src, cursor });
    const c = await upsertEpisodes(env, provider.id, sourceRow.title_id, (page?.episodes || []).map(normalizeEpisode).filter(Boolean));
    saved += c.saved;
    cursor = page?.next;
    if (!cursor) {
      await env.DB.prepare("UPDATE title_sources SET episodes_synced_at = ? WHERE id = ?").bind(Date.now(), sourceRow.id).run();
      break;
    }
  }
  return saved;
}

// Pausar / reanudar: el trabajo conserva su posición; mientras está pausado, el cron no lo toma.
export async function setPaused(env, jobId, paused) {
  const res = await env.DB.prepare(`UPDATE sync_jobs SET paused = ?, next_run_at = ? WHERE id = ? AND status IN ${ACTIVE_STATES} RETURNING id`)
    .bind(paused ? 1 : 0, Date.now(), jobId).first();
  return Boolean(res);
}
