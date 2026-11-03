// Ajustes: proveedores (activar, configurar, actualizar, quitar), TMDb, reproducción y datos guardados.
import { escapeHtml as e } from "../../app/util.js";
import { PROVIDER_TYPES, getInstances } from "../../providers/registry.js";
import { heading } from "../components.js";

const STATE_TEXT = { ok: "Funcionando", loading: "Cargando…", error: "Con problemas", disabled: "Desactivado" };

function dateText(ts) {
  return ts ? new Date(ts).toLocaleString("es", { dateStyle: "short", timeStyle: "short" }) : "nunca";
}

function field(instance, f) {
  const id = `f-${instance.id}-${f.key}`;
  const value = instance.config[f.key] ?? "";
  const help = f.help ? `<small id="${id}-help">${e(f.help)}</small>` : "";
  const described = f.help ? `aria-describedby="${id}-help"` : "";
  let control;
  if (f.type === "textarea") control = `<textarea id="${id}" name="${e(f.key)}" rows="4" placeholder="${e(f.placeholder || "")}" ${described}>${e(value)}</textarea>`;
  else if (f.type === "select") control = `<select id="${id}" name="${e(f.key)}" ${described}>${f.options.map(([v, t]) => `<option value="${e(v)}" ${String(value) === v ? "selected" : ""}>${e(t)}</option>`).join("")}</select>`;
  else if (f.type === "file") control = `<input id="${id}" type="file" accept="${e(f.accept || "")}" data-action="provider-file" data-id="${e(instance.id)}" data-field="${e(f.key)}" ${described}>
    ${value ? `<span class="note">Archivo cargado: ${e(value)}</span>` : ""}`;
  else control = `<input id="${id}" name="${e(f.key)}" type="${f.type === "password" ? "password" : f.type === "number" ? "number" : f.type === "url" ? "url" : "text"}"
    value="${e(value)}" placeholder="${e(f.placeholder || "")}" autocomplete="off" spellcheck="false" ${described}>`;
  return `<div class="field"><label for="${id}">${e(f.label)}${f.required ? " *" : ""}</label>${control}${help}</div>`;
}

function providerCard(instance, ctx) {
  const def = PROVIDER_TYPES[instance.type];
  const st = ctx.catalog.status(instance.id);
  const state = instance.enabled ? st.state : "disabled";
  const confirmRemove = ctx.state.confirm === `remove:${instance.id}`;
  return `<article class="provider ${instance.enabled ? "" : "is-off"}">
    <header class="provider-head">
      <div>
        <h3>${e(instance.label)} ${def.isDemo ? `<span class="badge badge-demo">DEMO</span>` : ""}</h3>
        <p>${e(def.description)}</p>
        <p class="provider-origin">Origen: ${e(def.origin)}${def.license ? ` · ${e(def.license)}` : ""}</p>
      </div>
      <label class="switch"><input type="checkbox" data-action="provider-toggle" data-id="${e(instance.id)}" data-key="toggle:${e(instance.id)}" ${instance.enabled ? "checked" : ""}>
        <span>${instance.enabled ? "Activo" : "Inactivo"}</span></label>
    </header>
    <div class="provider-status status-${state}" role="status">
      <strong>${STATE_TEXT[state]}</strong>
      ${instance.enabled ? ` · ${st.count || 0} títulos · actualizado ${dateText(st.updatedAt)}${st.fromCache ? " (copia guardada)" : ""}` : ""}
      ${instance.enabled && st.error ? `<span class="provider-error">${e(st.error)}</span>` : ""}
      ${instance.enabled && st.warning ? `<span class="provider-error">${e(st.warning)}</span>` : ""}
    </div>
    ${def.fields.length ? `<form class="provider-form" data-form="provider" data-id="${e(instance.id)}">
      <div class="field"><label for="f-${e(instance.id)}-label">Nombre</label><input id="f-${e(instance.id)}-label" name="__label" value="${e(instance.label)}"></div>
      ${def.fields.map(f => field(instance, f)).join("")}
      ${def.notice ? `<p class="note">${e(def.notice)}</p>` : ""}
      <div class="form-actions"><button type="submit" class="primary">Guardar</button></div>
    </form>` : ""}
    <div class="provider-actions">
      ${instance.enabled && def.ttl ? `<button type="button" class="secondary" data-action="provider-refresh" data-id="${e(instance.id)}" data-key="refresh:${e(instance.id)}">Actualizar ahora</button>` : ""}
      ${def.multiple || !def.isDemo ? `<button type="button" class="danger ${confirmRemove ? "confirming" : ""}" data-action="provider-remove" data-id="${e(instance.id)}" data-key="remove:${e(instance.id)}">${confirmRemove ? "¿Quitar? Tocá de nuevo" : "Quitar"}</button>` : ""}
    </div>
  </article>`;
}

function confirmButton(ctx, action, label) {
  const on = ctx.state.confirm === action;
  return `<button type="button" class="danger ${on ? "confirming" : ""}" data-action="data-clear" data-what="${action}" data-key="${action}">${on ? "¿Seguro? Tocá de nuevo" : e(label)}</button>`;
}

export function render(ctx) {
  const s = ctx.settings.all();
  const instances = getInstances();
  const addable = Object.values(PROVIDER_TYPES).filter(d => d.multiple || !instances.some(i => i.type === d.type));
  const tmdbStatus = ctx.state.tmdbStatus || "";

  const html = `<div class="section-heading">${heading("CONFIGURACIÓN", "Ajustes")}</div>
  <div class="settings">
    <section class="settings-block" aria-labelledby="h-prov">
      <h2 id="h-prov">Proveedores de contenido</h2>
      <p class="note">Cada proveedor es una fuente de títulos. Usá solo fuentes que tengas permiso de usar: la app no trae ninguna fuente privada.</p>
      ${instances.map(i => providerCard(i, ctx)).join("") || `<p class="note">No hay proveedores configurados.</p>`}
      ${addable.length ? `<div class="add-provider">
        <label for="add-type">Agregar proveedor</label>
        <select id="add-type">${addable.map(d => `<option value="${e(d.type)}">${e(d.name)}</option>`).join("")}</select>
        <button type="button" class="secondary" data-action="provider-add" data-key="provider-add">Agregar</button>
      </div>` : ""}
    </section>

    <section class="settings-block" aria-labelledby="h-tmdb">
      <h2 id="h-tmdb">Imágenes e información (TMDb)</h2>
      <p class="note">Con una clave gratuita de The Movie Database la app completa pósters, sinopsis, reparto y temporadas.
        Se crea en themoviedb.org → Configuración → API. La clave se guarda solo en este navegador.</p>
      <form data-form="tmdb" class="provider-form">
        <div class="field"><label for="tmdb-key">Clave de API (v3) o token de lectura (v4)</label>
          <input id="tmdb-key" name="tmdbKey" type="password" value="${e(s.tmdbKey)}" autocomplete="off" spellcheck="false"></div>
        <div class="field"><label for="tmdb-lang">Idioma de la información</label>
          <select id="tmdb-lang" name="language">${[["es-ES", "Español (España)"], ["es-MX", "Español (Latinoamérica)"], ["en-US", "Inglés"], ["pt-BR", "Portugués (Brasil)"]]
            .map(([v, t]) => `<option value="${v}" ${s.language === v ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        <div class="form-actions"><button type="submit" class="primary">Guardar y probar</button>
          ${s.tmdbKey ? `<button type="button" class="danger" data-action="tmdb-remove" data-key="tmdb-remove">Quitar clave</button>` : ""}</div>
        <p class="note" role="status" id="tmdb-status">${e(tmdbStatus)}</p>
      </form>
    </section>

    <section class="settings-block" aria-labelledby="h-play">
      <h2 id="h-play">Reproducción</h2>
      <div class="field"><label for="set-player">Reproductor para HLS (.m3u8)</label>
        <select id="set-player" data-setting="player">
          ${[["auto", "Automático (recomendado)"], ["native", "Solo el del navegador"], ["hlsjs", "Siempre hls.js"]].map(([v, t]) => `<option value="${v}" ${s.player === v ? "selected" : ""}>${t}</option>`).join("")}
        </select><small>"Automático" usa hls.js cuando el navegador lo admite y, si falla, el reproductor del navegador.</small></div>
      <label class="check"><input type="checkbox" data-setting="resume" ${s.resume ? "checked" : ""}> Seguir desde donde lo dejé</label>
      <label class="check"><input type="checkbox" data-setting="autoplayNext" ${s.autoplayNext ? "checked" : ""}> Pasar solo al siguiente episodio</label>
    </section>

    <section class="settings-block" aria-labelledby="h-data">
      <h2 id="h-data">Datos guardados en este navegador</h2>
      <p class="note">${ctx.favorites.size} favoritos · ${ctx.progress.recent(999).length} títulos en "Seguir viendo".</p>
      <div class="data-actions">
        ${confirmButton(ctx, "cache", "Borrar catálogos guardados")}
        ${confirmButton(ctx, "progress", "Borrar \"Seguir viendo\"")}
        ${confirmButton(ctx, "favorites", "Borrar favoritos")}
        ${confirmButton(ctx, "all", "Restablecer todo")}
      </div>
    </section>

    <section class="settings-block" aria-labelledby="h-about">
      <h2 id="h-about">Acerca de</h2>
      <p class="note">Xuper Web es un prototipo independiente y no oficial, sin relación con Xuper TV. No incluye fuentes privadas ni contenido protegido:
        todo lo que se reproduce viene de los proveedores configurados acá.</p>
      <p class="note tmdb-credit">Este producto usa la API de TMDb, pero no está respaldado ni certificado por TMDb.</p>
    </section>
  </div>`;
  return { title: "Ajustes", html };
}
