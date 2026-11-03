// Pantallas de cuenta: ingresar, registrarse, recuperar contraseña, perfil, listas e historial.
import { escapeHtml as e } from "../../app/util.js";
import { hrefFor } from "../../app/router.js";
import { formatTime } from "../../player/player.js";
import { cardFor, grid, heading, empty } from "../components.js";

const message = ctx => {
  const { formError, formMessage } = ctx.state;
  return `${formError ? `<p class="form-error" role="alert">${e(formError)}</p>` : ""}${formMessage ? `<p class="form-ok" role="status">${e(formMessage)}</p>` : ""}`;
};
const busy = ctx => (ctx.state.busy ? "disabled" : "");

// Pestañas de "Mi espacio".
export function spaceTabs(current) {
  const tabs = [["favoritos", "Favoritos"], ["listas", "Mis listas"], ["historial", "Historial"]];
  return `<nav class="space-tabs" aria-label="Mi espacio">${tabs.map(([id, label]) =>
    `<a href="#/${id}" class="filter ${current === id ? "chosen" : ""}" ${current === id ? 'aria-current="page"' : ""}>${label}</a>`).join("")}</nav>`;
}

// Bloque para quien no inició sesión.
export function signInPrompt(what) {
  return empty(`Iniciá sesión para ${what}.`, "Tus datos quedan guardados en tu cuenta y los ves en cualquier dispositivo.",
    `<div class="hero-actions"><a class="primary" href="#/cuenta">Ingresar</a><a class="secondary" href="#/cuenta/registro">Crear cuenta</a></div>`);
}

export function verifyPrompt(ctx) {
  return `<div class="verify-box" role="status"><strong>Verificá tu correo para empezar a guardar.</strong>
    <span>Te enviamos un enlace a ${e(ctx.account.user.email)}. Después de tocarlo, volvé acá.</span>
    <div class="hero-actions"><button type="button" class="primary" data-action="verify-check" ${busy(ctx)}>Ya lo verifiqué</button>
    <button type="button" class="secondary" data-action="verify-resend" ${busy(ctx)}>Reenviar el correo</button></div></div>`;
}

// Estado de la cuenta para las pantallas que necesitan sesión verificada (o null si está todo bien).
function gate(ctx, what) {
  if (!ctx.account.ready) return `<div class="empty" role="status"><div class="xp-spinner"></div>Conectando con tu cuenta…</div>`;
  if (!ctx.account.signedIn) return signInPrompt(what);
  if (ctx.account.suspended) return empty("Tu cuenta está suspendida.", "No podés guardar ni ver tus datos. Escribinos si creés que es un error.");
  if (!ctx.account.verified) return verifyPrompt(ctx);
  return null;
}

export function renderAuth(ctx, route) {
  if (ctx.account.signedIn) return { title: "Cuenta", html: `<h1 class="sr-only" tabindex="-1">Cuenta</h1>` + empty(`Ya iniciaste sesión como ${ctx.account.name}.`, "", `<a class="primary" href="#/perfil">Ir a mi perfil</a>`) };
  const mode = route.mode;
  const titles = { ingresar: "Ingresar", registro: "Crear cuenta", recuperar: "Recuperar contraseña" };
  const forms = {
    ingresar: `<form data-form="login" class="auth-form" novalidate>
        <div class="field"><label for="a-email">Correo</label><input id="a-email" name="email" type="email" autocomplete="username" required></div>
        <div class="field"><label for="a-pass">Contraseña</label><input id="a-pass" name="password" type="password" autocomplete="current-password" required></div>
        ${message(ctx)}
        <button type="submit" class="primary" ${busy(ctx)}>Ingresar</button>
        <p class="auth-links"><a href="#/cuenta/recuperar">¿Olvidaste la contraseña?</a> · <a href="#/cuenta/registro">Crear una cuenta</a></p>
      </form>`,
    registro: `<form data-form="register" class="auth-form" novalidate>
        <div class="field"><label for="a-name">Nombre</label><input id="a-name" name="name" maxlength="40" autocomplete="nickname" required></div>
        <div class="field"><label for="a-email">Correo</label><input id="a-email" name="email" type="email" autocomplete="email" required></div>
        <div class="field"><label for="a-pass">Contraseña</label><input id="a-pass" name="password" type="password" autocomplete="new-password" minlength="10" maxlength="128" required aria-describedby="a-pass-help">
          <small id="a-pass-help">Al menos 10 caracteres. Una frase de varias palabras es más fácil de recordar y más segura.</small></div>
        ${message(ctx)}
        <button type="submit" class="primary" ${busy(ctx)}>Crear cuenta</button>
        <p class="auth-links">¿Ya tenés cuenta? <a href="#/cuenta">Ingresar</a></p>
      </form>`,
    recuperar: `<form data-form="reset" class="auth-form" novalidate>
        <p class="note">Escribí tu correo y te enviamos un enlace para crear una contraseña nueva.</p>
        <div class="field"><label for="a-email">Correo</label><input id="a-email" name="email" type="email" autocomplete="email" required></div>
        ${message(ctx)}
        <button type="submit" class="primary" ${busy(ctx)}>Enviar enlace</button>
        <p class="auth-links"><a href="#/cuenta">Volver a ingresar</a></p>
      </form>`
  };
  return {
    title: titles[mode],
    html: `<section class="auth">
      <div class="auth-card">
        <span class="brand-icon auth-icon" aria-hidden="true">S</span>
        <h1 tabindex="-1">${titles[mode]}</h1>
        ${ctx.state.authReason ? `<p class="note">${e(ctx.state.authReason)}</p>` : ""}
        ${forms[mode]}
      </div>
    </section>`
  };
}

export function renderProfile(ctx) {
  const blocked = gate(ctx, "ver tu perfil");
  if (blocked && (!ctx.account.signedIn || !ctx.account.ready)) return { title: "Perfil", html: `<div class="section-heading">${heading("TU CUENTA", "Perfil")}</div>${blocked}` };
  const a = ctx.account;
  const created = a.profile?.createdAt?.toDate?.().toLocaleDateString("es", { dateStyle: "long" }) || "";
  const confirm = ctx.state.confirm;
  const localCount = ctx.localData?.count?.() || 0;
  const html = `<div class="section-heading">${heading("TU CUENTA", a.name)}</div>
  <div class="settings">
    ${!a.verified ? verifyPrompt(ctx) : ""}
    ${message(ctx)}
    ${localCount && a.verified ? `<section class="settings-block"><h2>Datos de este dispositivo</h2>
      <p class="note">Tenés ${localCount} favoritos o títulos empezados guardados en este navegador desde antes de tener cuenta.</p>
      <div class="form-actions"><button type="button" class="primary" data-action="import-local" ${busy(ctx)}>Pasarlos a mi cuenta</button></div></section>` : ""}
    <section class="settings-block" aria-labelledby="h-datos">
      <h2 id="h-datos">Datos de la cuenta</h2>
      <p class="note">Correo: ${e(a.user.email)}${created ? ` · Cuenta creada el ${e(created)}` : ""}${a.isAdmin ? " · Administrador" : ""}</p>
      <form data-form="profile-name" class="provider-form">
        <div class="field"><label for="p-name">Nombre</label><input id="p-name" name="name" value="${e(a.name)}" maxlength="40" required></div>
        <div class="form-actions"><button type="submit" class="primary" ${busy(ctx)}>Guardar nombre</button></div>
      </form>
    </section>
    <section class="settings-block" aria-labelledby="h-pass">
      <h2 id="h-pass">Cambiar contraseña</h2>
      <form data-form="password" class="provider-form">
        <div class="field"><label for="p-cur">Contraseña actual</label><input id="p-cur" name="current" type="password" autocomplete="current-password" required></div>
        <div class="field"><label for="p-new">Contraseña nueva</label><input id="p-new" name="next" type="password" autocomplete="new-password" minlength="10" maxlength="128" required><small>Al menos 10 caracteres. Al cambiarla se cierran tus otras sesiones.</small></div>
        <div class="form-actions"><button type="submit" class="primary" ${busy(ctx)}>Cambiar contraseña</button></div>
      </form>
    </section>
    <section class="settings-block" aria-labelledby="h-ses">
      <h2 id="h-ses">Sesiones</h2>
      <p class="note">Cerrá la sesión en este dispositivo, o en todos (por ejemplo, si usaste una computadora ajena). Las sesiones vencen solas a los 30 días.</p>
      <div class="form-actions">
        <button type="button" class="secondary" data-action="logout">Cerrar sesión</button>
        ${a.verified ? `<button type="button" class="danger ${confirm === "logout-all" ? "confirming" : ""}" data-action="logout-all" data-key="logout-all">${confirm === "logout-all" ? "¿Seguro? Tocá de nuevo" : "Cerrar todas las sesiones"}</button>` : ""}
      </div>
    </section>
    ${a.isAdmin ? `<section class="settings-block"><h2>Administración</h2><div class="form-actions"><a class="secondary" href="#/admin">Abrir el panel de administración</a></div></section>` : ""}
    <section class="settings-block danger-zone" aria-labelledby="h-del">
      <h2 id="h-del">Eliminar la cuenta</h2>
      <p class="note">Se borran tu cuenta, tus favoritos, listas (también las públicas) e historial. No se puede deshacer.</p>
      <form data-form="delete-account" class="provider-form">
        <div class="field"><label for="p-del">Escribí tu contraseña para confirmar</label><input id="p-del" name="password" type="password" autocomplete="current-password" required></div>
        <div class="form-actions"><button type="submit" class="danger" ${busy(ctx)}>Eliminar mi cuenta para siempre</button></div>
      </form>
    </section>
  </div>`;
  return { title: "Perfil", html };
}

export function renderLists(ctx) {
  const blocked = gate(ctx, "crear tus listas");
  const head = `<div class="section-heading">${heading("MI ESPACIO", "Mis listas")}${spaceTabs("listas")}</div>`;
  if (blocked) return { title: "Mis listas", html: head + blocked };
  const lists = ctx.userdata.lists.all();
  const html = head + `${message(ctx)}
    <form data-form="list-create" class="list-create">
      <div class="field"><label for="l-name">Nueva lista</label><input id="l-name" name="name" maxlength="80" placeholder="Por ejemplo: Clásicos para el finde" required></div>
      <button type="submit" class="primary" ${busy(ctx)}>Crear</button>
    </form>
    ${lists.length ? `<ul class="lists">${lists.map(l => `<li><a href="#/lista/${encodeURIComponent(l.id)}" class="list-link">
        <strong>${e(l.name)}</strong><small>${l.visibility === "public" ? "Pública" : "Privada"}${l.description ? ` · ${e(l.description)}` : ""}</small></a></li>`).join("")}</ul>`
      : empty("Todavía no creaste listas.", "Creá una arriba y agregale títulos desde la ficha de cada uno.")}`;
  return { title: "Mis listas", html };
}

export function renderListDetail(ctx, route) {
  const blocked = gate(ctx, "ver tus listas");
  if (blocked) return { title: "Lista", html: `<h1 class="sr-only" tabindex="-1">Lista</h1>${blocked}` };
  const list = ctx.userdata.lists.get(route.id);
  if (!list) return { title: "Lista", html: `<h1 class="sr-only" tabindex="-1">Lista</h1>` + empty("No encontramos esta lista.", "", `<a class="primary" href="#/listas">Mis listas</a>`) };
  const items = ctx.state.listItems?.[route.id];
  const confirm = ctx.state.confirm === `list-del:${list.id}`;
  const publicUrl = `${location.origin}${location.pathname}#/publica/${encodeURIComponent(list.id)}`;
  const html = `<a href="#/listas" class="back">← Mis listas</a>
    <div class="section-heading">${heading(list.visibility === "public" ? "LISTA PÚBLICA" : "LISTA PRIVADA", list.name)}</div>
    ${message(ctx)}
    <form data-form="list-edit" data-id="${e(list.id)}" class="provider-form list-edit">
      <div class="field"><label for="le-name">Nombre</label><input id="le-name" name="name" value="${e(list.name)}" maxlength="80" required></div>
      <div class="field"><label for="le-desc">Descripción</label><textarea id="le-desc" name="description" maxlength="300" rows="2">${e(list.description || "")}</textarea></div>
      <label class="check"><input type="checkbox" name="public" ${list.visibility === "public" ? "checked" : ""}> Lista pública: cualquiera con el enlace puede verla (solo el nombre de la lista, tu nombre y los títulos).</label>
      ${list.visibility === "public" ? `<p class="note">Enlace público: <code class="selectable">${e(publicUrl)}</code></p>` : ""}
      <div class="form-actions"><button type="submit" class="primary" ${busy(ctx)}>Guardar cambios</button>
        <button type="button" class="danger ${confirm ? "confirming" : ""}" data-action="list-delete" data-id="${e(list.id)}" data-key="list-del">${confirm ? "¿Borrar la lista? Tocá de nuevo" : "Borrar lista"}</button></div>
    </form>
    ${!items ? `<p class="note" role="status">Cargando títulos…</p>` : items.length
      ? `<ul class="list-items">${items.map(x => `<li><a href="${x.kind === "live" ? hrefFor.watch({ id: x.itemId }) : hrefFor.detail({ id: x.itemId })}">${x.poster ? `<img src="${e(x.poster)}" alt="" loading="lazy">` : ""}<strong>${e(x.title)}</strong></a>
          <button type="button" class="link" data-action="list-remove-item" data-id="${e(list.id)}" data-item="${e(x.itemId)}">Quitar</button></li>`).join("")}</ul>`
      : empty("La lista está vacía.", "Agregá títulos desde la ficha de cada uno con \"Agregar a una lista\".")}`;
  return {
    title: list.name, html,
    mount() {
      if (!items) ctx.userdata.lists.items(list.id).then(list2 => { ctx.state.listItems = { ...ctx.state.listItems, [list.id]: list2 }; ctx.render(); }).catch(() => {});
      return () => {};
    }
  };
}

export function renderHistory(ctx) {
  const blocked = gate(ctx, "ver tu historial");
  const head = `<div class="section-heading">${heading("MI ESPACIO", "Historial")}${spaceTabs("historial")}</div>`;
  if (blocked) return { title: "Historial", html: head + blocked };
  const entries = ctx.userdata.progress.all();
  const confirm = ctx.state.confirm === "history-clear";
  const html = head + (entries.length ? `<ul class="history">${entries.map(h => {
    const item = ctx.catalog.get(h.itemId);
    const href = item ? hrefFor.watch(item, h.episodeId ? { id: h.episodeId } : null) : "";
    const when = h.updatedAt ? new Date(h.updatedAt).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" }) : "";
    const pct = h.finished ? 100 : h.duration ? Math.round((h.time / h.duration) * 100) : 0;
    return `<li>${href ? `<a href="${href}">` : "<span>"}<strong>${e(h.title)}</strong>${h.episodeLabel ? `<small>${e(h.episodeLabel)}</small>` : ""}${href ? "</a>" : "</span>"}
      <small>${h.finished ? "Visto" : `${pct}% · ${formatTime(h.time)}`} · ${e(when)}${item ? "" : " · ya no está en el catálogo"}</small>
      <button type="button" class="link" data-action="history-remove" data-id="${e(h.id)}">Quitar</button></li>`;
  }).join("")}</ul>
    <div class="form-actions"><button type="button" class="danger ${confirm ? "confirming" : ""}" data-action="history-clear" data-key="history-clear">${confirm ? "¿Borrar todo? Tocá de nuevo" : "Borrar historial"}</button></div>`
    : empty("Todavía no viste nada.", "Lo que reproduzcas aparece acá, con la fecha y por dónde ibas."));
  return { title: "Historial", html };
}

export function renderPublicList(ctx, route) {
  const data = ctx.state.publicList;
  if (!data || data.id !== route.id) {
    return {
      title: "Lista pública",
      html: `<div class="empty" role="status"><div class="xp-spinner"></div>Cargando lista…</div>`,
      mount() {
        ctx.userdata.publicList(route.id)
          .then(l => { ctx.state.publicList = l || { id: route.id, missing: true }; ctx.render(); })
          .catch(() => { ctx.state.publicList = { id: route.id, missing: true }; ctx.render(); });
        return () => {};
      }
    };
  }
  if (data.missing) return { title: "Lista pública", html: `<h1 class="sr-only" tabindex="-1">Lista</h1>` + empty("Esta lista no existe o ya no es pública.") };
  const known = data.items.map(x => ctx.catalog.get(x.itemId)).filter(Boolean);
  const unknown = data.items.length - known.length;
  return {
    title: data.name,
    html: `<div class="section-heading">${heading(`LISTA DE ${data.ownerName.toUpperCase()}`, data.name)}</div>
      ${data.description ? `<p class="synopsis">${e(data.description)}</p>` : ""}
      ${grid(known.map(x => cardFor(x, ctx)).join(""), "La lista no tiene títulos disponibles en este catálogo.")}
      ${unknown ? `<p class="note">${unknown} título(s) de esta lista no están en los proveedores activos.</p>` : ""}`
  };
}
