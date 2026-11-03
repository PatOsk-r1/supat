// Panel de administración.
//  - "Cuentas" (administradores de Firestore): usuarios (suspender/reactivar), listas públicas y auditoría.
//  - Catálogo central (propietario, rol "owner" del servidor): ver central-admin.js.
// Muestra solo datos operativos: nunca contraseñas (Firebase no las da) ni datos personales de uso.
import { escapeHtml as e } from "../../app/util.js";
import { heading, empty } from "../components.js";
import { CENTRAL_TABS, renderCentralTab } from "./central-admin.js";

const ACTIONS = { suspend: "Suspendió", reactivate: "Reactivó", "delete-public-list": "Borró la lista pública", "provider-config": "Cambió un proveedor" };
const date = ms => (ms ? new Date(ms).toLocaleString("es", { dateStyle: "short", timeStyle: "short" }) : "—");

// Pestañas que puede ver esta cuenta. El servidor vuelve a validar cada operación.
export function adminTabs(account) {
  return [...(account.isAdmin ? [["cuentas", "Cuentas"]] : []), ...(account.isOwner ? CENTRAL_TABS : [])];
}

export function render(ctx) {
  const head = `<div class="section-heading">${heading("ADMINISTRACIÓN", "Panel")}</div>`;
  if (!ctx.account.ready) return { title: "Administración", html: head + `<div class="empty" role="status"><div class="xp-spinner"></div>Conectando…</div>` };
  const tabs = adminTabs(ctx.account);
  if (!tabs.length) return { title: "Administración", html: head + empty("No tenés acceso a esta sección.") };
  if (!ctx.account.verified) return { title: "Administración", html: head + empty("Verificá tu correo para usar el panel.", "Tocá el enlace del mail que te enviamos (revisá spam) y después \"Ya lo verifiqué\" en tu perfil.", `<a class="primary" href="#/perfil">Ir a mi perfil</a>`) };
  if (!tabs.some(([id]) => id === ctx.state.adminTab)) ctx.state.adminTab = tabs[0][0];
  const tab = ctx.state.adminTab;
  const nav = tabs.length > 1 ? `<div class="filters admin-tabs" role="tablist" aria-label="Secciones del panel">${tabs.map(([id, label]) =>
    `<button type="button" role="tab" class="filter ${tab === id ? "chosen" : ""}" aria-selected="${tab === id}" data-action="admin-tab" data-tab="${id}" data-key="atab:${id}">${e(label)}</button>`).join("")}</div>` : "";
  const message = `${ctx.state.formError ? `<p class="form-error" role="alert">${e(ctx.state.formError)}</p>` : ""}${ctx.state.formMessage ? `<p class="note ok" role="status">${e(ctx.state.formMessage)}</p>` : ""}`;
  if (tab !== "cuentas") {
    return {
      title: "Administración",
      html: head + nav + message + `<div class="settings">${renderCentralTab(ctx)}</div>`,
      mount() { ctx.loadCentral?.(tab); return () => {}; }
    };
  }
  return accountsTab(ctx, head + nav);
}

function accountsTab(ctx, head) {

  const data = ctx.state.admin;
  if (!data) {
    return {
      title: "Administración",
      html: head + `<div class="empty" role="status"><div class="xp-spinner"></div>Cargando…</div>`,
      mount() {
        Promise.all([ctx.admin.users(), ctx.admin.publicLists(), ctx.admin.audit()])
          .then(([users, lists, audit]) => { ctx.state.admin = { users, lists, audit }; ctx.render(); })
          .catch(err => { ctx.state.admin = { error: err.message || "No se pudo cargar." }; ctx.render(); });
        return () => {};
      }
    };
  }
  if (data.error) return { title: "Administración", html: head + empty("No se pudo cargar el panel.", data.error) };

  const confirm = ctx.state.confirm;
  const html = head + `${ctx.state.formError ? `<p class="form-error" role="alert">${e(ctx.state.formError)}</p>` : ""}
  <div class="settings">
    <section class="settings-block" aria-labelledby="h-users">
      <h2 id="h-users">Usuarios (${data.users.length})</h2>
      <div class="table-wrap"><table class="admin-table">
        <thead><tr><th scope="col">Nombre</th><th scope="col">Alta</th><th scope="col">Estado</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
        <tbody>${data.users.map(u => {
          const key = `${u.suspended ? "reactivate" : "suspend"}:${u.uid}`;
          const self = u.uid === ctx.account.user.uid;
          return `<tr><td>${e(u.displayName)}<small class="uid">${e(u.uid.slice(0, 8))}…</small></td><td>${date(u.createdAt)}</td>
            <td>${u.suspended ? `<span class="badge badge-off">Suspendida</span>` : `<span class="badge badge-on">Activa</span>`}</td>
            <td>${self ? "" : `<button type="button" class="${u.suspended ? "secondary" : "danger"} ${confirm === key ? "confirming" : ""}" data-action="admin-suspend" data-uid="${e(u.uid)}" data-suspend="${!u.suspended}" data-key="${e(key)}">
              ${confirm === key ? "¿Seguro? Tocá de nuevo" : u.suspended ? "Reactivar" : "Suspender"}</button>`}</td></tr>`;
        }).join("")}</tbody></table></div>
    </section>
    <section class="settings-block" aria-labelledby="h-pub">
      <h2 id="h-pub">Listas públicas (${data.lists.length})</h2>
      ${data.lists.length ? `<ul class="history">${data.lists.map(l => `<li><a href="#/publica/${encodeURIComponent(l.id)}"><strong>${e(l.name)}</strong></a>
        <small>de ${e(l.ownerName)} · ${l.count} títulos</small>
        <button type="button" class="link" data-action="admin-delete-list" data-id="${e(l.id)}" data-key="pub:${e(l.id)}">${confirm === `pub:${l.id}` ? "¿Borrar? Tocá de nuevo" : "Borrar"}</button></li>`).join("")}</ul>` : `<p class="note">No hay listas públicas.</p>`}
    </section>
    <section class="settings-block" aria-labelledby="h-audit">
      <h2 id="h-audit">Registro de acciones</h2>
      ${data.audit.length ? `<ul class="history">${data.audit.map(a => {
        const who = data.users.find(u => u.uid === a.actor)?.displayName || a.actor.slice(0, 8);
        const target = data.users.find(u => u.uid === a.target)?.displayName || a.target.slice(0, 12);
        return `<li><strong>${e(who)}</strong> <span>${e(ACTIONS[a.action] || a.action)}: ${e(target)}</span><small>${date(a.at)}${a.detail ? ` · ${e(a.detail)}` : ""}</small></li>`;
      }).join("")}</ul>` : `<p class="note">Todavía no hay acciones registradas.</p>`}
    </section>
  </div>`;
  return { title: "Administración", html };
}
