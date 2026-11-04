// Panel del propietario para el catálogo: trabajos de importación, usuarios y permisos, registros
// técnicos e infraestructura. La fuente de contenido se configura en Ajustes → Fuentes de contenido.
// Todo lo valida el servidor; esta pantalla nunca recibe credenciales.
import { escapeHtml as e } from "../../app/util.js";
import { API_BASE } from "../../app/api.js";

export const CENTRAL_TABS = [
  ["sincronizacion", "Sincronización"],
  ["usuarios", "Usuarios y permisos"],
  ["registros", "Registros"],
  ["infraestructura", "Infraestructura"]
];

const date = ms => (ms ? new Date(ms).toLocaleString("es", { dateStyle: "short", timeStyle: "short" }) : "—");
const JOB_STATUS = { queued: "En cola", running: "En curso", done: "Terminado", failed: "Falló", cancelled: "Cancelado" };
const JOB_PHASE = { items: "títulos", episodes: "episodios", finish: "cerrando" };
const LEVELS = { info: "Info", warn: "Aviso", error: "Error" };
const ACTIONS = { "source-create": "Configuró la fuente", "source-update": "Cambió la fuente", "source-test": "Probó la conexión de", "provider-create": "Creó el proveedor", "provider-update": "Cambió el proveedor", "provider-test": "Probó la conexión de", "sync-full": "Importación completa de", "sync-incremental": "Sincronizó", "sync-cancel": "Canceló el trabajo", "user-update": "Cambió permisos de", "catalog-reindex": "Reconstruyó el índice" };

// Correo enmascarado: alcanza para reconocer la cuenta sin mostrar el dato completo.
export const maskEmail = m => {
  const [user, domain] = String(m || "").split("@");
  return domain ? `${user.slice(0, 2)}•••@${domain}` : "—";
};

// Qué datos necesita cada pestaña (las carga app.js con centralAdmin).
export const TAB_DATA = {
  sincronizacion: ["providers", "jobs"],
  usuarios: ["users"],
  registros: ["logs", "audit", "providers"],
  infraestructura: ["stats", "providers"]
};

function jobsTab(ctx) {
  const { jobs = [], providers = [] } = ctx.state.central.data;
  const name = id => providers.find(p => p.id === id)?.label || id;
  const confirm = ctx.state.confirm;
  return `<section class="settings-block" aria-labelledby="h-cjobs">
    <h2 id="h-cjobs">Trabajos de importación</h2>
    <p class="note">Los trabajos avanzan por tandas: el servidor sigue solo cada minuto y la sincronización diaria arranca a las 05:00 (UTC). "Continuar" procesa la siguiente tanda ya mismo. La fuente se configura en <a href="#/ajustes">Ajustes → Fuentes de contenido</a>.</p>
    ${jobs.length ? `<div class="table-wrap"><table class="admin-table">
      <thead><tr><th scope="col">Trabajo</th><th scope="col">Estado</th><th scope="col">Avance</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
      <tbody>${jobs.map(j => {
        const active = ["queued", "running"].includes(j.status);
        const key = `ccancel:${j.id}`;
        return `<tr><td>#${j.id} ${e(name(j.providerId))}<small class="uid">${j.mode === "full" ? "completa" : "cambios"} · ${j.trigger === "cron" ? "automática" : "manual"} · ${date(j.createdAt)}</small></td>
          <td>${e(JOB_STATUS[j.status])}${active ? `<small class="uid">${e(JOB_PHASE[j.phase] || j.phase)}${j.attempts ? ` · reintento ${j.attempts}, próximo ${date(j.nextRunAt)}` : ""}</small>` : `<small class="uid">${date(j.finishedAt)}</small>`}</td>
          <td><small>${j.pages} pág. · ${j.seen} recibidos · ${j.created} nuevos · ${j.updated} actualizados · ${j.merged} unidos · ${j.unchanged} sin cambios · ${j.episodes} episodios · ${j.skipped} descartados${j.conflicts ? ` · ${j.conflicts} posibles duplicados` : ""}</small>
            ${j.lastError ? `<small class="provider-error">${e(j.lastError)}</small>` : ""}</td>
          <td>${active ? `<button type="button" class="secondary" data-action="central-continue" data-id="${j.id}" data-key="ccont:${j.id}">Continuar</button>
            <button type="button" class="danger ${confirm === key ? "confirming" : ""}" data-action="central-cancel" data-id="${j.id}" data-key="${key}">${confirm === key ? "¿Cancelar? Tocá de nuevo" : "Cancelar"}</button>` : ""}</td></tr>`;
      }).join("")}</tbody></table></div>` : `<p class="note">Todavía no hubo sincronizaciones.</p>`}
  </section>`;
}

function usersTab(ctx) {
  const { users = [] } = ctx.state.central.data;
  const confirm = ctx.state.confirm;
  const me = ctx.account.user?.uid;
  return `<section class="settings-block" aria-labelledby="h-cusers">
    <h2 id="h-cusers">Usuarios y permisos (${users.length})</h2>
    <p class="note">Aparecen las cuentas que ya usaron el catálogo central. "Propietario" puede administrar todo este panel. Los propietarios fijos (OWNER_UIDS del servidor o administradores de Firebase) no se pueden quitar desde acá, y nadie puede cambiar su propio rol.</p>
    ${users.length ? `<div class="table-wrap"><table class="admin-table">
      <thead><tr><th scope="col">Cuenta</th><th scope="col">Rol</th><th scope="col">Estado</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
      <tbody>${users.map(u => {
        const self = u.uid === me;
        const roleKey = `crole:${u.uid}`, blockKey = `cblock:${u.uid}`;
        const actions = self || u.initialOwner ? `<small class="uid">${self ? "Sos vos" : "Propietario fijo (configuración o administrador de Firebase)"}</small>` : `
          <button type="button" class="secondary ${confirm === roleKey ? "confirming" : ""}" data-action="central-role" data-uid="${e(u.uid)}" data-role="${u.role === "owner" ? "user" : "owner"}" data-key="${e(roleKey)}">${confirm === roleKey ? "¿Seguro? Tocá de nuevo" : u.role === "owner" ? "Quitar propietario" : "Hacer propietario"}</button>
          <button type="button" class="${u.blocked ? "secondary" : "danger"} ${confirm === blockKey ? "confirming" : ""}" data-action="central-block" data-uid="${e(u.uid)}" data-blocked="${!u.blocked}" data-key="${e(blockKey)}">${confirm === blockKey ? "¿Seguro? Tocá de nuevo" : u.blocked ? "Desbloquear" : "Bloquear"}</button>`;
        return `<tr><td>${e(maskEmail(u.email))}<small class="uid">${e(u.uid.slice(0, 8))}… · último uso ${date(u.lastSeenAt)}</small></td>
          <td>${u.role === "owner" ? `<span class="badge badge-on">Propietario</span>` : "Usuario"}</td>
          <td>${u.suspended ? `<span class="badge badge-off">Suspendida</span>` : u.blocked ? `<span class="badge badge-off">Bloqueada</span>` : "Activa"}</td>
          <td>${actions}</td></tr>`;
      }).join("")}</tbody></table></div>` : `<p class="note">Nadie usó el catálogo central todavía.</p>`}
  </section>`;
}

function logsTab(ctx) {
  const c = ctx.state.central;
  const { logs = [], audit = [], providers = [] } = c.data;
  const name = id => providers.find(p => p.id === id)?.label || id || "";
  return `<section class="settings-block" aria-labelledby="h-clogs">
    <h2 id="h-clogs">Registros técnicos</h2>
    <label class="select"><span class="sr-only">Nivel</span>
      <select data-action="central-log-level" aria-label="Nivel de los registros">${[["", "Todos los niveles"], ["error", "Solo errores"], ["warn", "Avisos"], ["info", "Información"]].map(([v, t]) => `<option value="${v}" ${(c.logLevel || "") === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
    ${logs.length ? `<ul class="history logs">${logs.map(l => `<li class="log-${e(l.level)}"><strong>${e(LEVELS[l.level])}</strong> <span>${e(l.message)}</span>
      <small>${date(l.at)} · ${e(l.scope)}${l.providerId ? ` · ${e(name(l.providerId))}` : ""}${l.jobId ? ` · trabajo ${l.jobId}` : ""}</small></li>`).join("")}</ul>
      ${logs.length >= 100 ? `<button type="button" class="secondary" data-action="central-logs-older" data-before="${logs[logs.length - 1].id}" data-key="clogs-older">Ver más antiguos</button>` : ""}` : `<p class="note">No hay registros.</p>`}
  </section>
  <section class="settings-block" aria-labelledby="h-caudit">
    <h2 id="h-caudit">Auditoría de administración</h2>
    ${audit.length ? `<ul class="history">${audit.map(a => `<li><strong>${e(a.actor.slice(0, 8))}…</strong> <span>${e(ACTIONS[a.action] || a.action)}: ${e(name(a.target) || a.target)}</span><small>${date(a.at)}${a.detail ? ` · ${e(a.detail)}` : ""}</small></li>`).join("")}</ul>` : `<p class="note">Todavía no hay acciones registradas.</p>`}
  </section>`;
}

function infraTab(ctx) {
  const { stats, providers = [] } = ctx.state.central.data;
  if (!stats) return "";
  const k = stats.catalog.titlesByKind;
  const name = id => providers.find(p => p.id === id)?.label || id;
  return `<section class="settings-block" aria-labelledby="h-cinfra">
    <h2 id="h-cinfra">Catálogo central</h2>
    <ul class="history">
      <li><strong>Títulos</strong> <span>${[["movie", "películas"], ["series", "series"], ["anime", "anime"], ["live", "canales"]].map(([x, label]) => `${k[x] || 0} ${label}`).join(" · ")}</span></li>
      <li><strong>Episodios</strong> <span>${stats.catalog.episodes}</span></li>
      <li><strong>Con TMDb o IMDb</strong> <span>${stats.catalog.withExternalIds} títulos</span></li>
      <li><strong>En más de un proveedor</strong> <span>${stats.catalog.multiSource} títulos (unidos sin duplicar)</span></li>
      ${stats.catalog.sourcesByProvider.map(s => `<li><strong>${e(name(s.providerId))}</strong> <span>${s.count} títulos${s.removed ? ` (${s.removed} ya no disponibles, conservados)` : ""}</span></li>`).join("")}
      <li><strong>Trabajos</strong> <span>${Object.entries(stats.jobs).map(([s, n]) => `${n} ${(JOB_STATUS[s] || s).toLowerCase()}`).join(" · ") || "ninguno"}</span></li>
    </ul>
    <p class="note">Servidor: ${e(API_BASE)} · Cloudflare Workers y D1 (plan gratuito). Cada tanda procesa hasta ${stats.limits.pagesPerRun} páginas y ${stats.limits.subrequestsPerRun} consultas externas.</p>
    <div class="form-actions"><button type="button" class="secondary" data-action="central-reindex" data-key="creindex">Reconstruir índice de búsqueda</button></div>
  </section>`;
}

const TABS = { sincronizacion: jobsTab, usuarios: usersTab, registros: logsTab, infraestructura: infraTab };

export function renderCentralTab(ctx) {
  const c = ctx.state.central;
  if (c.error) return `<p class="form-error" role="alert">${e(c.error)}</p>`;
  if (c.loading) return `<div class="empty" role="status"><div class="xp-spinner"></div>Cargando…</div>`;
  return TABS[c.tab]?.(ctx) || "";
}
