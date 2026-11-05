// Rutas del propietario para las prioridades de datos entre fuentes (ver priorities.js).
// Guardar NO cambia datos. La vista previa no escribe nada. Aplicar exige confirmación, deja
// constancia en la auditoría y recalcula el catálogo con una tarea por tandas que se puede reanudar.
import { fail, readJson } from "./http.js";
import { audit } from "./log.js";
import { SLOTS } from "../../src/shared/fuente-esquema.js";
import { ALL_PRIORITY_FIELDS, TITLE_FIELDS, EPISODE_FIELDS, DEFAULT_ORDER, cleanPriorities, getPriorities, setPriorities, diffTitles, diffEpisodes, recomputeTitles, recomputeEpisodes } from "./priorities.js";

const BATCH = 150;
const LOCK_MS = 60000;
const PREVIEW_LIMIT = 400;

const jobOut = j => (j ? { id: j.id, status: j.status, processed: j.processed, changed: j.changed, phase: JSON.parse(j.payload || "{}").phase || "", lastError: j.last_error, createdAt: j.created_at, finishedAt: j.finished_at } : null);
const lastJob = env => env.DB.prepare("SELECT * FROM maint_jobs WHERE kind = 'priorities' ORDER BY id DESC LIMIT 1").first();

async function sourcesList(env) {
  const { results } = await env.DB.prepare(`SELECT id, label FROM providers WHERE id IN (${DEFAULT_ORDER.map(() => "?").join(",")})`).bind(...DEFAULT_ORDER).all();
  return DEFAULT_ORDER.map(id => ({ id, slot: Object.keys(SLOTS).find(k => SLOTS[k].id === id), label: results.find(r => r.id === id)?.label || SLOTS[Object.keys(SLOTS).find(k => SLOTS[k].id === id)].label }));
}

// Una tanda de la tarea de recálculo. Devuelve el trabajo actualizado.
export async function runMaintStep(env, { jobId = null } = {}) {
  const now = Date.now();
  const job = jobId
    ? await env.DB.prepare("SELECT * FROM maint_jobs WHERE id = ? AND status = 'running' AND locked_until < ?").bind(jobId, now).first()
    : await env.DB.prepare("SELECT * FROM maint_jobs WHERE status = 'running' AND locked_until < ? ORDER BY id LIMIT 1").bind(now).first();
  if (!job) return null;
  const locked = await env.DB.prepare("UPDATE maint_jobs SET locked_until = ? WHERE id = ? AND locked_until < ? RETURNING id").bind(now + LOCK_MS, job.id, now).first();
  if (!locked) return null;
  const payload = JSON.parse(job.payload || "{}");
  const priorities = await getPriorities(env, "active");
  try {
    let processed = job.processed, changed = job.changed, cursor = job.cursor, status = "running", finished = null;
    if (payload.phase !== "episodes") {
      const { results } = await env.DB.prepare("SELECT DISTINCT title_id FROM title_sources WHERE title_id > ? AND meta_json != '' ORDER BY title_id LIMIT ?").bind(cursor, BATCH).all();
      if (results.length) {
        changed += await recomputeTitles(env, results.map(r => r.title_id), priorities);
        processed += results.length;
        cursor = results[results.length - 1].title_id;
      } else { payload.phase = "episodes"; cursor = 0; }
    } else {
      const { results } = await env.DB.prepare("SELECT DISTINCT episode_id FROM episode_sources WHERE episode_id > ? AND meta_json != '' ORDER BY episode_id LIMIT ?").bind(cursor, BATCH).all();
      if (results.length) {
        changed += await recomputeEpisodes(env, results.map(r => r.episode_id), priorities);
        processed += results.length;
        cursor = results[results.length - 1].episode_id;
      } else { status = "done"; finished = Date.now(); }
    }
    await env.DB.prepare("UPDATE maint_jobs SET status = ?, cursor = ?, processed = ?, changed = ?, payload = ?, locked_until = 0, updated_at = ?, finished_at = ? WHERE id = ?")
      .bind(status, cursor, processed, changed, JSON.stringify(payload), Date.now(), finished, job.id).run();
    if (status === "done") await audit(env, job.created_by || "sistema", "priority-applied", "catalogo", `Recalculados ${processed} registros, ${changed} con cambios`);
  } catch (err) {
    await env.DB.prepare("UPDATE maint_jobs SET locked_until = 0, last_error = ?, updated_at = ? WHERE id = ?").bind(String(err?.message || err).slice(0, 300), Date.now(), job.id).run();
  }
  return env.DB.prepare("SELECT * FROM maint_jobs WHERE id = ?").bind(job.id).first();
}

export const priorityRoutes = {
  "GET /api/admin/priorities": async ({ env }) => ({
    fields: { titles: TITLE_FIELDS, episodes: EPISODE_FIELDS },
    sources: await sourcesList(env),
    active: cleanPriorities((await getPriorities(env, "active")) || {}),
    pending: await getPriorities(env, "pending"),
    job: jobOut(await lastJob(env))
  }),

  // Guardar: queda PENDIENTE. No cambia ningún dato del catálogo.
  "PUT /api/admin/priorities": async ({ env, request, user }) => {
    const body = await readJson(request);
    const pending = cleanPriorities(body.priorities || {});
    await setPriorities(env, "pending", pending);
    const active = cleanPriorities((await getPriorities(env, "active")) || {});
    const changed = ALL_PRIORITY_FIELDS.filter(([f]) => JSON.stringify(pending[f]) !== JSON.stringify(active[f])).map(([, l]) => l);
    await audit(env, user.uid, "priority-save", "catalogo", `Pendiente (sin aplicar). Campos distintos de la activa: ${changed.join(", ") || "ninguno"}`);
    return { pending };
  },

  // Vista previa: qué cambiaría (sin escribir). Se evalúan los títulos y episodios que tienen datos de
  // más de una fuente (los únicos en los que la prioridad puede cambiar algo), hasta un límite.
  "POST /api/admin/priorities/preview": async ({ env, request }) => {
    const body = await readJson(request);
    const proposal = cleanPriorities(body.priorities || (await getPriorities(env, "pending")) || {});
    const multiTitles = (await env.DB.prepare(`SELECT title_id FROM title_sources WHERE removed = 0 AND meta_json != '' GROUP BY title_id HAVING COUNT(*) > 1 ORDER BY title_id LIMIT ?`).bind(PREVIEW_LIMIT).all()).results.map(r => r.title_id);
    const totalMulti = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM (SELECT title_id FROM title_sources WHERE removed = 0 AND meta_json != '' GROUP BY title_id HAVING COUNT(*) > 1)`).first())?.n || 0;
    const multiEps = (await env.DB.prepare(`SELECT episode_id FROM episode_sources WHERE removed = 0 AND meta_json != '' GROUP BY episode_id HAVING COUNT(*) > 1 ORDER BY episode_id LIMIT ?`).bind(PREVIEW_LIMIT).all()).results.map(r => r.episode_id);
    const t = await diffTitles(env, multiTitles, proposal);
    const e = await diffEpisodes(env, multiEps, proposal);
    const fieldCounts = {};
    for (const d of [...t.diffs, ...e.diffs]) for (const f of Object.keys(d.changes)) fieldCounts[f] = (fieldCounts[f] || 0) + 1;
    const names = new Map();
    if (t.diffs.length) {
      const ids = t.diffs.slice(0, 10).map(d => d.id);
      const { results } = await env.DB.prepare(`SELECT id, title FROM titles WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all();
      for (const r of results) names.set(r.id, r.title);
    }
    const short = v => String(Array.isArray(v) ? v.join(", ") : v ?? "").replace(/^\[|\]$/g, "").slice(0, 80);
    return {
      evaluatedTitles: multiTitles.length, totalMultiTitles: totalMulti, changedTitles: t.diffs.length,
      evaluatedEpisodes: multiEps.length, changedEpisodes: e.diffs.length, fieldCounts,
      examples: t.diffs.slice(0, 10).map(d => ({ title: names.get(d.id) || `#${d.id}`, changes: Object.fromEntries(Object.entries(d.changes).map(([f, [a, b]]) => [f, [short(a), short(b)]])) }))
    };
  },

  // Aplicar: exige confirmación. La pendiente pasa a activa y se recalcula el catálogo por tandas.
  "POST /api/admin/priorities/apply": async ({ env, request, user }) => {
    const { confirm } = await readJson(request);
    if (confirm !== true) fail(400, "Aplicar las prioridades a todo el catálogo necesita confirmación.");
    const pending = await getPriorities(env, "pending");
    if (!pending) fail(409, "No hay prioridades pendientes: guardalas primero.");
    const running = await env.DB.prepare("SELECT id FROM maint_jobs WHERE kind = 'priorities' AND status = 'running'").first();
    if (running) await env.DB.prepare("UPDATE maint_jobs SET status = 'cancelled', finished_at = ? WHERE id = ?").bind(Date.now(), running.id).run();
    await setPriorities(env, "active", pending);
    const now = Date.now();
    const job = await env.DB.prepare("INSERT INTO maint_jobs (kind, status, payload, created_by, created_at, updated_at) VALUES ('priorities', 'running', ?, ?, ?, ?) RETURNING *")
      .bind(JSON.stringify({ phase: "titles" }), user.uid, now, now).first();
    await audit(env, user.uid, "priority-apply", "catalogo", `Tarea ${job.id}: aplicar prioridades a todo el catálogo`);
    const step = await runMaintStep(env, { jobId: job.id });
    return { job: jobOut(step || job) };
  },

  // Reanudar o avanzar una tanda (también lo hace solo el cron cada minuto).
  "POST /api/admin/priorities/continue": async ({ env }) => {
    const job = await lastJob(env);
    if (!job || job.status !== "running") fail(409, "No hay una actualización de prioridades en curso.");
    const step = await runMaintStep(env, { jobId: job.id });
    return { job: jobOut(step || (await lastJob(env))) };
  }
};
