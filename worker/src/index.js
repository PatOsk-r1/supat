// API del catálogo central de Supat (Cloudflare Worker).
//
// Todas las rutas, salvo /api/health, exigen sesión de Firebase verificada en el servidor.
// Las de /api/admin/ exigen además el rol "owner", que asigna solo el servidor.
import { json, errorResponse, corsHeaders, allowedOrigin, fail, intParam } from "./http.js";
import { authenticate, requireUser, requireOwner } from "./auth.js";
import { listTitles, searchTitles, titleDetail } from "./catalog.js";
import { resolvePlayback } from "./play.js";
import { adminRoutes } from "./admin.js";
import { runPending, scheduleDaily, fetchEpisodesNow } from "./sync.js";
import { log } from "./log.js";
import { KINDS } from "./providers/contract.js";

const kindParam = url => {
  const k = url.searchParams.get("kind") || "";
  if (k && !KINDS.includes(k)) fail(400, "Tipo de contenido inválido.");
  return k;
};
const idParam = v => {
  const n = parseInt(v, 10);
  if (!(n > 0)) fail(404, "No existe ese título.");
  return n;
};

const userRoutes = {
  "GET /api/me": async ({ user }) => ({ uid: user.uid, role: user.role, emailVerified: user.emailVerified, blocked: user.blocked, suspended: user.suspended }),

  "GET /api/catalog/titles": async ({ env, url }) => listTitles(env, {
    kind: kindParam(url), page: intParam(url, "page", 1, 1, 10000), pageSize: intParam(url, "pageSize", 50, 1, 200),
    sort: url.searchParams.get("sort") || "recientes"
  }),

  "GET /api/catalog/search": async ({ env, url }) => {
    const q = (url.searchParams.get("q") || "").slice(0, 100);
    return searchTitles(env, { q, kind: kindParam(url), page: intParam(url, "page", 1, 1, 1000), pageSize: intParam(url, "pageSize", 30, 1, 100) });
  },

  "GET /api/catalog/titles/:id": async ({ env, params, fetchImpl }) => {
    const id = idParam(params.id);
    let detail = await titleDetail(env, id);
    if (!detail) fail(404, "No existe ese título.");
    // Serie sin episodios importados todavía: se piden ahora al proveedor (unas pocas páginas).
    if (detail.episodesPending) {
      const source = await env.DB.prepare(`SELECT s.* FROM title_sources s JOIN providers p ON p.id = s.provider_id
        WHERE s.title_id = ? AND s.removed = 0 AND p.enabled = 1 AND s.episodes_synced_at IS NULL ORDER BY p.priority LIMIT 1`).bind(id).first();
      if (source) {
        try { await fetchEpisodesNow(env, source, { fetchImpl }); }
        catch (err) { await log(env, "warn", "episodes", `Episodios a pedido del título ${id}: ${err.message}`, { providerId: source.provider_id }); }
        detail = await titleDetail(env, id);
      }
    }
    return detail;
  },

  "GET /api/catalog/titles/:id/play": async ({ env, params, url, user, fetchImpl }) => {
    const episode = url.searchParams.get("episode");
    const result = await resolvePlayback(env, idParam(params.id), episode ? idParam(episode) : null, { fetchImpl });
    if (result.error) {
      // El detalle técnico (servidores, códigos) solo lo ve el propietario; está en los registros.
      fail(502, user.role === "owner" ? result.error : "No se pudo obtener la reproducción de este título. Probá más tarde.", "play");
    }
    return result;
  }
};

function compile(routes) {
  return Object.entries(routes).map(([key, handler]) => {
    const [method, path] = key.split(" ");
    const names = [];
    const re = new RegExp("^" + path.replace(/:([a-zA-Z]+)/g, (_, n) => { names.push(n); return "([^/]+)"; }) + "$");
    return { method, re, names, handler };
  });
}
const USER = compile(userRoutes);
const ADMIN = compile(adminRoutes);

function match(table, method, pathname) {
  let pathFound = false;
  for (const r of table) {
    const m = r.re.exec(pathname);
    if (!m) continue;
    pathFound = true;
    if (r.method !== method) continue;
    const params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
    return { handler: r.handler, params };
  }
  return pathFound ? "method" : null;
}

export async function handle(request, env, { fetchImpl = fetch } = {}) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  if (method === "OPTIONS") {
    return allowedOrigin(request, env) ? new Response(null, { status: 204, headers: corsHeaders(request, env) }) : new Response(null, { status: 403 });
  }
  if (url.pathname === "/api/health" && method === "GET") return json({ ok: true });

  const admin = url.pathname.startsWith("/api/admin/");
  const found = match(admin ? ADMIN : USER, method, url.pathname);
  if (!found) fail(404, "Ruta inexistente.");
  if (found === "method") fail(405, "Método no permitido.");

  // Autenticación y permisos en CADA ruta, antes de hacer cualquier otra cosa.
  const user = await authenticate(request, env, fetchImpl);
  if (admin) requireOwner(user);
  else if (url.pathname !== "/api/me") requireUser(user);

  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    // Los cambios solo se aceptan desde los sitios permitidos (o sin Origin: herramientas del propietario).
    const origin = request.headers.get("Origin");
    if (origin && !allowedOrigin(request, env)) fail(403, "Origen no permitido.");
  }
  return json(await found.handler({ env, request, url, user, params: found.params, fetchImpl }));
}

export default {
  async fetch(request, env, execCtx) {
    let response;
    try {
      response = await handle(request, env);
    } catch (err) {
      if (!err?.status) console.error(err);
      response = errorResponse(err);
    }
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(corsHeaders(request, env))) headers.set(k, v);
    return new Response(response.body, { status: response.status, headers });
  },

  async scheduled(event, env, execCtx) {
    execCtx.waitUntil((async () => {
      try {
        if (event.cron === "0 5 * * *") {
          const created = await scheduleDaily(env);
          if (created.length) await log(env, "info", "cron", `Sincronización diaria: ${created.length} trabajo(s) creados.`);
        }
        await runPending(env);
      } catch (err) {
        await log(env, "error", "cron", `Fallo en la ejecución programada: ${err?.message || err}`);
      }
    })());
  }
};
