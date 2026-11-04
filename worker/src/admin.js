// Operaciones del propietario: proveedores, sincronización, usuarios, registros e infraestructura.
// Cada ruta ya pasó por requireOwner (index.js). Cada cambio deja su registro de auditoría,
// con los NOMBRES de los campos cambiados, nunca sus valores secretos.
import { fail, readJson, intParam } from "./http.js";
import { ADAPTERS, describeAdapters, splitConfig, kindsOf } from "./providers/registry.js";
import { secretFields, LIMITS } from "./providers/contract.js";
import { decryptSecrets } from "./secrets.js";
import { audit, auditStatement } from "./log.js";
import { runPending, cancelJob, activeJob } from "./sync.js";
import { stats } from "./catalog.js";
import { isFixedOwner } from "./auth.js";

const clip = (s, n) => String(s ?? "").trim().slice(0, n);

async function providerOut(env, row) {
  const def = ADAPTERS[row.adapter];
  const config = JSON.parse(row.config_json || "{}");
  let secretsSet = [];
  try { secretsSet = Object.keys(await decryptSecrets(env, row.secrets_enc)); }
  catch { secretsSet = row.secrets_enc ? ["(no se pueden leer: volvé a cargarlas)"] : []; }
  const job = await activeJob(env, row.id);
  return {
    id: row.id, adapter: row.adapter, adapterName: def?.name || row.adapter, label: row.label, enabled: Boolean(row.enabled),
    schedule: row.schedule, priority: row.priority, config, secretsSet,
    kinds: def ? kindsOf(def, config) : [], incremental: Boolean(def?.supportsIncremental?.(config)),
    lastSyncAt: row.last_sync_at, lastStatus: row.last_status, lastError: row.last_error,
    activeJob: job ? jobOut(job) : null, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

export function jobOut(j) {
  let phase = "";
  try { phase = JSON.parse(j.cursor_json || "{}").phase || ""; } catch { /* nada */ }
  return {
    id: j.id, providerId: j.provider_id, mode: j.mode, status: j.status, phase, trigger: j.trigger,
    pages: j.pages, seen: j.seen, created: j.created, updated: j.updated, merged: j.merged, unchanged: j.unchanged,
    conflicts: j.conflicts, skipped: j.skipped, episodes: j.episodes, attempts: j.attempts, lastError: j.last_error,
    nextRunAt: j.next_run_at, createdAt: j.created_at, startedAt: j.started_at, finishedAt: j.finished_at
  };
}

// Junta configuración guardada + cambios. Las credenciales vacías conservan las guardadas.
export async function mergeConfig(env, def, row, input = {}, clear = []) {
  const { config, secrets } = splitConfig(def, input);
  const savedConfig = row ? JSON.parse(row.config_json || "{}") : {};
  const savedSecrets = row ? await decryptSecrets(env, row.secrets_enc) : {};
  const nextSecrets = { ...savedSecrets };
  for (const [k, v] of Object.entries(secrets)) if (v) nextSecrets[k] = v;
  for (const k of [].concat(clear || [])) if (secretFields(def).includes(k)) delete nextSecrets[k];
  const nextConfig = { ...savedConfig, ...config };
  const missing = def.fields.filter(f => f.required && !String((f.secret ? nextSecrets : nextConfig)[f.key] ?? "").trim()).map(f => `Falta "${f.label}".`);
  const problems = [...missing, ...(def.validate?.(nextConfig) || [])];
  return {
    config: nextConfig, secrets: nextSecrets, problems,
    changed: [...Object.keys(config).filter(k => JSON.stringify(savedConfig[k]) !== JSON.stringify(config[k])), ...Object.keys(secrets).filter(k => secrets[k]).map(k => `${k} (credencial)`), ...[].concat(clear || []).map(k => `${k} (credencial borrada)`)]
  };
}

export const adminRoutes = {
  "GET /api/admin/adapters": async () => ({ adapters: describeAdapters() }),

  "GET /api/admin/providers": async ({ env }) => {
    const { results } = await env.DB.prepare("SELECT * FROM providers ORDER BY priority, created_at").all();
    return { providers: await Promise.all(results.map(r => providerOut(env, r))) };
  },

  "GET /api/admin/jobs": async ({ env, url }) => {
    const provider = url.searchParams.get("provider");
    const limit = intParam(url, "limit", 30, 1, 100);
    const stmt = provider
      ? env.DB.prepare("SELECT * FROM sync_jobs WHERE provider_id = ? ORDER BY id DESC LIMIT ?").bind(provider, limit)
      : env.DB.prepare("SELECT * FROM sync_jobs ORDER BY id DESC LIMIT ?").bind(limit);
    return { jobs: (await stmt.all()).results.map(jobOut) };
  },

  "POST /api/admin/jobs/:id/continue": async ({ env, params, fetchImpl }) => {
    const id = parseInt(params.id, 10);
    await env.DB.prepare("UPDATE sync_jobs SET next_run_at = ? WHERE id = ? AND status IN ('queued', 'running')").bind(Date.now(), id).run();
    const [step] = await runPending(env, { fetchImpl, jobId: id });
    const job = await env.DB.prepare("SELECT * FROM sync_jobs WHERE id = ?").bind(id).first();
    if (!job) fail(404, "No existe ese trabajo.");
    return { job: jobOut(job), ran: Boolean(step) };
  },

  "POST /api/admin/jobs/:id/cancel": async ({ env, params, user }) => {
    const id = parseInt(params.id, 10);
    const ok = await cancelJob(env, id);
    if (!ok) fail(409, "Ese trabajo no está activo.");
    await audit(env, user.uid, "sync-cancel", String(id));
    return { ok };
  },

  "GET /api/admin/logs": async ({ env, url }) => {
    const level = url.searchParams.get("level");
    const provider = url.searchParams.get("provider");
    const before = intParam(url, "before", Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER);
    const limit = intParam(url, "limit", 100, 1, 200);
    const where = ["id < ?"], binds = [before];
    if (["info", "warn", "error"].includes(level)) { where.push("level = ?"); binds.push(level); }
    if (provider) { where.push("provider_id = ?"); binds.push(provider); }
    const { results } = await env.DB.prepare(`SELECT * FROM logs WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`).bind(...binds, limit).all();
    return { logs: results.map(l => ({ id: l.id, at: l.at, level: l.level, scope: l.scope, providerId: l.provider_id, jobId: l.job_id, message: l.message })) };
  },

  "GET /api/admin/audit": async ({ env, url }) => {
    const limit = intParam(url, "limit", 100, 1, 200);
    const { results } = await env.DB.prepare("SELECT * FROM audit ORDER BY id DESC LIMIT ?").bind(limit).all();
    return { audit: results };
  },

  "GET /api/admin/users": async ({ env, url }) => {
    const limit = intParam(url, "limit", 200, 1, 500);
    const { results } = await env.DB.prepare("SELECT uid, email, role, blocked, suspended, fs_admin, created_at, last_seen_at FROM users ORDER BY last_seen_at DESC LIMIT ?").bind(limit).all();
    return { users: results.map(u => ({ uid: u.uid, email: u.email, role: isFixedOwner(env, u) ? "owner" : u.role, initialOwner: isFixedOwner(env, u), blocked: Boolean(u.blocked), suspended: Boolean(u.suspended), createdAt: u.created_at, lastSeenAt: u.last_seen_at })) };
  },

  // Cambiar rol o bloqueo de OTRO usuario. Nadie cambia su propio rol (así no se pierde el
  // último propietario), y los propietarios iniciales (OWNER_UIDS) no se pueden quitar desde acá.
  "PATCH /api/admin/users/:uid": async ({ env, request, user, params }) => {
    const target = params.uid;
    if (target === user.uid) fail(403, "No podés cambiar tu propio rol ni bloquearte.");
    const row = await env.DB.prepare("SELECT * FROM users WHERE uid = ?").bind(target).first();
    if (!row) fail(404, "Ese usuario todavía no usó el catálogo central.");
    const body = await readJson(request);
    const sets = [], binds = [], changes = [];
    if ("role" in body) {
      if (!["owner", "user"].includes(body.role)) fail(400, "Rol inválido.");
      if (isFixedOwner(env, row) && body.role !== "owner") fail(403, "Es propietario por configuración (OWNER_UIDS o administradores de Firebase); se cambia ahí.");
      sets.push("role = ?"); binds.push(body.role); changes.push(`rol ${row.role} → ${body.role}`);
    }
    if ("blocked" in body) {
      if (isFixedOwner(env, row) && body.blocked) fail(403, "No se puede bloquear a un propietario por configuración.");
      sets.push("blocked = ?"); binds.push(body.blocked ? 1 : 0); changes.push(body.blocked ? "bloqueado" : "desbloqueado");
    }
    if (!sets.length) fail(400, "No hay cambios.");
    await env.DB.batch([
      env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE uid = ?`).bind(...binds, target),
      auditStatement(env, user.uid, "user-update", target, changes.join(", "))
    ]);
    return { ok: true };
  },

  "GET /api/admin/stats": async ({ env }) => {
    const [catalog, jobs] = await Promise.all([
      stats(env),
      env.DB.prepare("SELECT status, COUNT(*) AS n FROM sync_jobs GROUP BY status").all()
    ]);
    return { catalog, jobs: Object.fromEntries(jobs.results.map(r => [r.status, r.n])), limits: { subrequestsPerRun: LIMITS.maxSubrequests, pagesPerRun: Number(env.SYNC_PAGES_PER_RUN) || 3 } };
  },

  // Reconstruye el índice de búsqueda (por si quedó desalineado). No toca los datos.
  "POST /api/admin/catalog/reindex": async ({ env, user }) => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO titles_fts (titles_fts) VALUES ('rebuild')"),
      auditStatement(env, user.uid, "catalog-reindex", "titles_fts")
    ]);
    return { ok: true };
  }
};
