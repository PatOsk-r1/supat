// Fuente de contenido única (Ajustes → Fuentes de contenido).
//
// Supat usa UNA sola fuente externa, configurada por el propietario:
//   nombre, dirección base, clave de API (catálogo), credencial de reproducción (solo enlaces),
//   categorías a importar y la especificación de rutas del adaptador (ver worker/README.md).
// Las dos credenciales viven cifradas en el servidor. Al guardar una configuración que funciona,
// se desactiva cualquier otro proveedor y arranca la importación completa.
import { fail, readJson } from "./http.js";
import { ADAPTERS, contextFor } from "./providers/registry.js";
import { CATEGORIES, categoriesOf } from "./providers/generic-http.js";
import { guardedFetch, normalizePlayback, ProviderError } from "./providers/contract.js";
import { encryptSecrets, decryptSecrets, redact, containsSecret } from "./secrets.js";
import { audit, auditStatement, log } from "./log.js";
import { createJob, runPending, activeJob } from "./sync.js";
import { mergeConfig, jobOut } from "./admin.js";

export const SOURCE_ID = "fuente";
const ADAPTER = "http-json";
const SECRET_FIELDS = ["apiKey", "playbackKey"];
// Cambios que obligan a volver a importar todo.
const STRUCTURAL = ["baseUrl", "spec", "categories"];

const getRow = env => env.DB.prepare("SELECT * FROM providers WHERE id = ?").bind(SOURCE_ID).first();

async function counts(env) {
  const { results } = await env.DB.prepare(`SELECT t.kind, COUNT(*) AS n FROM titles t WHERE EXISTS (SELECT 1 FROM title_sources s
    WHERE s.title_id = t.id AND s.provider_id = ? AND s.removed = 0) GROUP BY t.kind`).bind(SOURCE_ID).all();
  const out = Object.fromEntries(results.map(r => [r.kind, r.n]));
  out.episodes = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM episode_sources WHERE provider_id = ? AND removed = 0`).bind(SOURCE_ID).first())?.n || 0;
  return out;
}

async function lastJob(env) {
  return env.DB.prepare("SELECT * FROM sync_jobs WHERE provider_id = ? ORDER BY id DESC LIMIT 1").bind(SOURCE_ID).first();
}

// Vista para el propietario: configuración sin credenciales (solo cuáles están cargadas).
async function ownerView(env) {
  const row = await getRow(env);
  if (!row) return { configured: false, categories: [...CATEGORIES], secretsSet: [], counts: {} };
  const config = JSON.parse(row.config_json || "{}");
  let secretsSet = [];
  try { secretsSet = Object.keys(await decryptSecrets(env, row.secrets_enc)).filter(k => SECRET_FIELDS.includes(k)); }
  catch { secretsSet = []; }
  const [job, last] = await Promise.all([activeJob(env, SOURCE_ID), lastJob(env)]);
  return {
    configured: true,
    label: row.label,
    baseUrl: config.baseUrl || "",
    categories: categoriesOf(config),
    spec: config.spec || "",
    secretsSet,
    enabled: Boolean(row.enabled),
    lastTest: row.last_test_at ? { at: row.last_test_at, ok: Boolean(row.last_test_ok), message: row.last_test_message } : null,
    lastSyncAt: row.last_sync_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    activeJob: job ? jobOut(job) : null,
    lastJob: last ? jobOut(last) : null,
    counts: await counts(env)
  };
}

// Lo que manda el formulario → configuración del adaptador.
function inputConfig(body) {
  const config = {};
  if ("baseUrl" in body) config.baseUrl = String(body.baseUrl || "").trim();
  if ("spec" in body) {
    // Se guarda normalizada (sin sangría): el mismo contenido con otro formato no cuenta como cambio.
    const text = String(body.spec || "").trim();
    try { config.spec = text ? JSON.stringify(JSON.parse(text)) : ""; } catch { config.spec = text; }
  }
  if ("categories" in body) {
    const list = [].concat(body.categories || []).filter(c => CATEGORIES.includes(c));
    if (!list.length) fail(400, "Elegí al menos una categoría.");
    config.categories = list.join(",");
  }
  for (const k of SECRET_FIELDS) if (k in body) config[k] = String(body[k] || "");
  return config;
}

// Prueba las dos credenciales, cada una en su función:
//  1. clave de API → primera página del catálogo;
//  2. credencial de reproducción → pedir el enlace del primer título (si la especificación lo usa).
// Nunca devuelve direcciones ni credenciales: solo si funcionó y por qué no.
async function testSource(env, def, config, secrets, fetchImpl) {
  const ctx = { config, secrets, providerId: SOURCE_ID, fetch: guardedFetch({ secrets, fetchImpl, budget: { left: 6 } }) };
  const kinds = def.kindsFor(config);
  if (!kinds.length) return { ok: false, message: "La especificación no define rutas para las categorías elegidas." };
  const steps = [];
  let page;
  try {
    page = await def.listPage(ctx, { kind: kinds[0], cursor: null, since: null });
    steps.push(`Catálogo: correcto (${page.items.length} título(s) en la primera página de "${kinds[0]}").`);
  } catch (err) {
    return { ok: false, message: `Catálogo: ${redact(err instanceof ProviderError ? err.message : `error (${err?.message || "desconocido"})`, secrets)}` };
  }
  let spec = {};
  try { spec = JSON.parse(config.spec || "{}"); } catch { /* ya validada */ }
  if (spec.playbackAuth) {
    if (!secrets.playbackKey) return { ok: false, message: `${steps[0]} Reproducción: falta la credencial de reproducción.` };
    const item = page.items.find(i => i.playback?.lazy);
    if (!item) {
      steps.push("Reproducción: no se pudo probar (la primera página no tiene títulos con enlace a pedir).");
    } else {
      try {
        const playback = normalizePlayback(await def.resolve(ctx, { source: { externalId: String(item.id), data: item.data || {} }, episode: null }));
        if (!playback?.url) throw new ProviderError("no devolvió una dirección válida.");
        if (containsSecret(playback.url, secrets)) throw new ProviderError("el enlace incluye una credencial, así que no se puede entregar al navegador (haría falta un proxy de video).");
        steps.push("Reproducción: correcta (se obtuvo un enlace válido).");
      } catch (err) {
        return { ok: false, message: `${steps[0]} Reproducción: ${redact(err?.message || "error", secrets)}` };
      }
    }
  }
  return { ok: true, message: steps.join(" "), sample: page.items.slice(0, 3).map(i => redact(String(i.title || ""), secrets)) };
}

async function saveTest(env, result) {
  await env.DB.prepare("UPDATE providers SET last_test_at = ?, last_test_ok = ?, last_test_message = ? WHERE id = ?")
    .bind(Date.now(), result.ok ? 1 : 0, String(result.message).slice(0, 500), SOURCE_ID).run();
}

export const sourceAdminRoutes = {
  "GET /api/admin/source": async ({ env }) => ({ source: await ownerView(env), categories: CATEGORIES }),

  // Guardar: valida, guarda cifrado, prueba, deja esta fuente como la única activa y, si funciona
  // y es nueva o cambió algo estructural, arranca la importación completa.
  "PUT /api/admin/source": async ({ env, request, user, fetchImpl }) => {
    const def = ADAPTERS[ADAPTER];
    const body = await readJson(request, 256 * 1024);
    const label = String(body.label ?? "").trim().slice(0, 60);
    if (!label) fail(400, "Escribí un nombre para la fuente.");
    const row = await getRow(env);
    const merged = await mergeConfig(env, def, row, inputConfig(body), [].concat(body.clearSecrets || []).filter(k => SECRET_FIELDS.includes(k)));
    if (merged.problems.length) fail(400, merged.problems.join(" "), "config");
    const before = row ? JSON.parse(row.config_json || "{}") : {};
    const structural = !row || STRUCTURAL.some(k => String(before[k] ?? "") !== String(merged.config[k] ?? ""));
    const now = Date.now();
    const enc = await encryptSecrets(env, merged.secrets);
    await env.DB.batch([
      row
        ? env.DB.prepare("UPDATE providers SET label = ?, config_json = ?, secrets_enc = ?, updated_at = ? WHERE id = ?").bind(label, JSON.stringify(merged.config), enc, now, SOURCE_ID)
        : env.DB.prepare("INSERT INTO providers (id, adapter, label, enabled, schedule, config_json, secrets_enc, priority, created_at, updated_at) VALUES (?, ?, ?, 0, 'daily', ?, ?, 0, ?, ?)")
          .bind(SOURCE_ID, ADAPTER, label, JSON.stringify(merged.config), enc, now, now),
      // Una única fuente activa: cualquier otro proveedor queda apagado (sus datos no se borran).
      env.DB.prepare("UPDATE providers SET enabled = 0, updated_at = ? WHERE id != ? AND enabled = 1").bind(now, SOURCE_ID),
      auditStatement(env, user.uid, row ? "source-update" : "source-create", SOURCE_ID, `Campos: ${merged.changed.join(", ") || "ninguno"}${label !== row?.label ? ", nombre" : ""}`)
    ]);

    const test = await testSource(env, def, merged.config, merged.secrets, fetchImpl);
    await saveTest(env, test);
    let job = null;
    if (test.ok) {
      await env.DB.prepare("UPDATE providers SET enabled = 1 WHERE id = ?").bind(SOURCE_ID).run();
      const fresh = await getRow(env);
      if (structural || !fresh.last_sync_at) {
        const created = await createJob(env, fresh, { mode: "full", trigger: "manual", actor: user.uid });
        if (!created.existing) await audit(env, user.uid, "sync-full", SOURCE_ID, `Trabajo ${created.job.id} (al guardar la fuente)`);
        await runPending(env, { fetchImpl, jobId: created.job.id });
        job = jobOut(await env.DB.prepare("SELECT * FROM sync_jobs WHERE id = ?").bind(created.job.id).first());
      }
    } else {
      await log(env, "warn", "fuente", `Prueba de conexión al guardar: ${test.message}`, { providerId: SOURCE_ID, secrets: merged.secrets });
    }
    return { source: await ownerView(env), test, job };
  },

  // Probar sin guardar: usa lo escrito en el formulario y completa las credenciales vacías con las guardadas.
  "POST /api/admin/source/test": async ({ env, request, user, fetchImpl }) => {
    const def = ADAPTERS[ADAPTER];
    const body = await readJson(request, 256 * 1024);
    const row = await getRow(env);
    const merged = await mergeConfig(env, def, row, inputConfig(body));
    if (merged.problems.length) return { ok: false, message: merged.problems.join(" ") };
    const result = await testSource(env, def, merged.config, merged.secrets, fetchImpl);
    if (row && !merged.changed.length) await saveTest(env, result);
    await audit(env, user.uid, "source-test", SOURCE_ID, result.ok ? "Correcta" : `Falló: ${result.message}`);
    return result;
  },

  "POST /api/admin/source/sync": async ({ env, request, user, fetchImpl }) => {
    const row = await getRow(env);
    if (!row) fail(409, "Primero configurá la fuente.");
    if (!row.enabled) fail(409, "La fuente no está activa: guardala con una prueba de conexión correcta.");
    const body = await readJson(request);
    const mode = body.mode === "full" ? "full" : "incremental";
    const { job, existing } = await createJob(env, row, { mode, trigger: "manual", actor: user.uid });
    if (!existing) await audit(env, user.uid, mode === "full" ? "sync-full" : "sync-incremental", SOURCE_ID, `Trabajo ${job.id}`);
    await runPending(env, { fetchImpl, jobId: job.id });
    return { job: jobOut(await env.DB.prepare("SELECT * FROM sync_jobs WHERE id = ?").bind(job.id).first()), existing };
  }
};

// Estado del catálogo para cualquier usuario: sin direcciones, credenciales ni detalles técnicos.
export async function catalogStatus(env) {
  const row = await getRow(env);
  if (!row) return { configured: false, available: false };
  const job = await activeJob(env, SOURCE_ID);
  const c = await counts(env);
  const total = (c.movie || 0) + (c.series || 0) + (c.anime || 0) + (c.live || 0);
  return {
    configured: true,
    available: Boolean(row.enabled) && total > 0,
    enabled: Boolean(row.enabled),
    label: row.label,
    counts: c,
    lastSyncAt: row.last_sync_at,
    importing: Boolean(job),
    failing: row.last_status === "error"
  };
}
