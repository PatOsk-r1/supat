// Ajustes: fuentes de contenido (propietario), TMDb, reproducción y datos guardados.
import { escapeHtml as e } from "../../app/util.js";
import { heading } from "../components.js";
import { getInstance } from "../../providers/registry.js";
import { sourcesSection } from "./sources-settings.js";
import { prioritiesSection } from "./priorities-settings.js";

function dateText(ts) {
  return ts ? new Date(ts).toLocaleString("es", { dateStyle: "short", timeStyle: "short" }) : "nunca";
}

// Estado del catálogo que ve cualquier usuario (lo que cargó el navegador).
function catalogState(ctx) {
  if (!getInstance("central")) return `<p class="note">Esta versión de Supat no tiene configurado el servidor del catálogo.</p>`;
  const st = ctx.catalog.status("central");
  if (st.state === "loading") return `<div class="provider-status" role="status"><strong>Cargando el catálogo…</strong></div>`;
  if (st.state === "ok") return `<div class="provider-status status-ok" role="status"><strong>Catálogo disponible</strong> · ${st.count} títulos · actualizado ${dateText(st.updatedAt)}${st.fromCache ? " (copia guardada)" : ""}
    ${st.warning ? `<span class="provider-error">${e(st.warning)}</span>` : ""}</div>`;
  return `<div class="provider-status status-error" role="status"><strong>Catálogo no disponible</strong>
    <span class="provider-error">${e(st.error || "No se pudo cargar el catálogo.")}</span></div>`;
}

function sourceSection(ctx) {
  return `<section class="settings-block" aria-labelledby="h-fuentes">
      <h2 id="h-fuentes">${ctx.account.isOwner ? "Fuentes de contenido" : "Catálogo"}</h2>
      ${catalogState(ctx)}
      ${ctx.account.isOwner && ctx.state.formError ? `<p class="form-error" role="alert">${e(ctx.state.formError)}</p>` : ""}
      ${ctx.account.isOwner && ctx.state.formMessage ? `<p class="note ok" role="status">${e(ctx.state.formMessage)}</p>` : ""}
      ${ctx.account.isOwner && ctx.state.busy ? `<p class="note" role="status">Procesando…</p>` : ""}
      ${ctx.account.isOwner ? sourcesSection(ctx) : `<p class="note">El catálogo es el mismo para todos los usuarios.</p>`}
    </section>
    ${ctx.account.isOwner ? `<section class="settings-block" aria-labelledby="h-prio"><h2 id="h-prio">Prioridad de datos entre fuentes</h2>${prioritiesSection(ctx)}</section>` : ""}`;
}

function confirmButton(ctx, action, label) {
  const on = ctx.state.confirm === action;
  return `<button type="button" class="danger ${on ? "confirming" : ""}" data-action="data-clear" data-what="${action}" data-key="${action}">${on ? "¿Seguro? Tocá de nuevo" : e(label)}</button>`;
}

export function render(ctx) {
  const s = ctx.settings.all();
  const tmdbStatus = ctx.state.tmdbStatus || "";

  const html = `<div class="section-heading">${heading("CONFIGURACIÓN", "Ajustes")}</div>
  <div class="settings">
    ${sourceSection(ctx)}

    <section class="settings-block" aria-labelledby="h-tmdb">
      <h2 id="h-tmdb">Imágenes e información (TMDb)</h2>
      <p class="note">Con una clave gratuita de The Movie Database la app completa pósters, sinopsis, reparto y temporadas.
        Se crea en themoviedb.org → Configuración → API. La clave se guarda solo en este navegador.</p>
      <form data-form="tmdb" class="provider-form">
        <div class="field"><label for="tmdb-key">Clave de API (v3) o token de lectura (v4)</label>
          <input id="tmdb-key" name="tmdbKey" type="password" value="${e(s.tmdbKey)}" autocomplete="off" spellcheck="false"></div>
        <div class="field"><label for="tmdb-region">País para "Dónde verla"</label>
          <select id="tmdb-region" name="region">${[["UY", "Uruguay"], ["AR", "Argentina"], ["CL", "Chile"], ["MX", "México"], ["CO", "Colombia"], ["PE", "Perú"], ["ES", "España"], ["BR", "Brasil"], ["US", "Estados Unidos"]]
            .map(([v, t]) => `<option value="${v}" ${s.region === v ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        <div class="field"><label for="tmdb-lang">Idioma de la información</label>
          <select id="tmdb-lang" name="language">${[["es-ES", "Español (España)"], ["es-MX", "Español (Latinoamérica)"], ["en-US", "Inglés"], ["pt-BR", "Portugués (Brasil)"]]
            .map(([v, t]) => `<option value="${v}" ${s.language === v ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        <div class="form-actions"><button type="submit" class="primary">Guardar y probar</button>
          ${s.tmdbKey ? `<button type="button" class="danger" data-action="tmdb-remove" data-key="tmdb-remove">Quitar clave</button>` : ""}</div>
        <p class="note" role="status" id="tmdb-status">${e(tmdbStatus)}</p>
        <p class="note tmdb-credit">Este producto usa la API de TMDb, pero no está respaldado ni certificado por TMDb.</p>
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
  </div>`;
  return {
    title: "Ajustes",
    html,
    // El propietario ve su configuración; mientras hay una importación en curso, el avance se actualiza solo.
    mount() {
      if (!ctx.account.isOwner) return () => {};
      if (!ctx.state.sources) ctx.loadSources?.();
      if (!ctx.state.priorities) ctx.loadPriorities?.();
      const importing = () => Object.values(ctx.state.sources?.data || {}).some(s => s.activeJob && !s.activeJob.paused);
      const timer = setInterval(() => { if (importing() && !document.hidden) ctx.loadSources?.({ quiet: true }); }, 15000);
      return () => clearInterval(timer);
    }
  };
}
