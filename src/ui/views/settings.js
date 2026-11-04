// Ajustes: fuente de contenido, TMDb, reproducción y datos guardados.
import { escapeHtml as e } from "../../app/util.js";
import { heading } from "../components.js";
import { getInstance } from "../../providers/registry.js";

const CATEGORY_LABELS = [["movie", "Películas"], ["series", "Series"], ["anime", "Anime"], ["episodes", "Temporadas y episodios"]];
const JOB_PHASE = { items: "títulos", episodes: "temporadas y episodios", finish: "cerrando" };
const JOB_END = { done: "terminada", failed: "falló", cancelled: "cancelada" };

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

function importState(src) {
  const job = src.activeJob, last = src.lastJob, c = src.counts || {};
  let line;
  if (job) {
    line = `en curso (trabajo #${job.id}, ${job.mode === "full" ? "completa" : "cambios"}): ${e(JOB_PHASE[job.phase] || job.phase)} · ${job.pages} páginas · ${job.seen} recibidos · ${job.created} nuevos · ${job.updated} actualizados · ${job.episodes} episodios`
      + (job.attempts ? ` · reintento ${job.attempts} a las ${dateText(job.nextRunAt)}` : "")
      + (job.lastError ? `<span class="provider-error">${e(job.lastError)}</span>` : "");
  } else if (last) {
    line = `${JOB_END[last.status] || last.status} el ${dateText(last.finishedAt)}` + (last.lastError ? `<span class="provider-error">${e(last.lastError)}</span>` : "");
  } else {
    line = "todavía no se hizo";
  }
  return `<div class="provider-status ${src.lastStatus === "error" ? "status-error" : ""}" role="status" aria-live="polite">
    <strong>Importación:</strong> ${line}
    <span>En el catálogo: ${c.movie || 0} películas · ${c.series || 0} series · ${c.anime || 0} anime · ${c.episodes || 0} episodios. Última sincronización completa: ${dateText(src.lastSyncAt)}.</span>
  </div>`;
}

// Formulario del propietario. Las credenciales guardadas nunca llegan acá: solo se sabe si están cargadas.
function sourceForm(ctx) {
  const st = ctx.state.source;
  if (!st || (st.loading && !st.data)) return `<div class="empty" role="status"><div class="xp-spinner"></div>Cargando la configuración…</div>`;
  if (st.error && !st.data) return `<p class="form-error" role="alert">${e(st.error)}</p>`;
  const src = st.data;
  const set = key => (src.secretsSet || []).includes(key);
  const secret = (key, label, help) => `<div class="field"><label for="src-${key}">${label}</label>
    <input id="src-${key}" name="${key}" type="password" autocomplete="new-password" spellcheck="false" placeholder="${set(key) ? "Guardada · dejá vacío para conservarla" : ""}" aria-describedby="src-${key}-help">
    ${set(key) ? `<label class="check"><input type="checkbox" name="__clear_${key}"> Borrar la guardada</label>` : ""}
    <small id="src-${key}-help">${help}</small></div>`;
  let spec = src.spec || "";
  try { if (spec) spec = JSON.stringify(JSON.parse(spec), null, 2); } catch { /* se muestra tal cual */ }
  const test = st.test || (src.lastTest ? { ok: src.lastTest.ok, message: src.lastTest.message, at: src.lastTest.at } : null);
  const confirmFull = ctx.state.confirm === "source-full";
  const busy = ctx.state.busy ? "disabled" : "";
  return `<form class="provider-form" data-form="source">
    <div class="field"><label for="src-label">Nombre de la fuente *</label><input id="src-label" name="label" value="${e(src.label || "")}" maxlength="60" required></div>
    <div class="field"><label for="src-base">Dirección base de la API *</label><input id="src-base" name="baseUrl" type="url" value="${e(src.baseUrl || "")}" placeholder="https://api.ejemplo.com/v1" spellcheck="false" aria-describedby="src-base-help">
      <small id="src-base-help">El servidor arma cada ruta a partir de esta dirección, según la especificación del adaptador.</small></div>
    ${secret("apiKey", "API Key", "Autentica las consultas al catálogo (títulos, temporadas, episodios). Solo se usa para eso.")}
    ${secret("playbackKey", "Credencial de autorización de reproducción", "Se usa únicamente para pedir o habilitar los enlaces de reproducción. Nunca se manda en las consultas del catálogo.")}
    <fieldset class="field"><legend>Categorías a importar</legend>
      ${CATEGORY_LABELS.map(([k, label]) => `<label class="check"><input type="checkbox" name="cat_${k}" ${(src.categories || []).includes(k) ? "checked" : ""}> ${label}</label>`).join("")}
    </fieldset>
    ${src.builtInSpec ? "" : `<details class="field" ${src.configured ? "" : "open"}><summary>Especificación de rutas del adaptador (JSON) *</summary>
      <textarea id="src-spec" name="spec" rows="14" spellcheck="false" class="code" aria-describedby="src-spec-help">${e(spec)}</textarea>
      <small id="src-spec-help">Rutas, paginación, campos y dónde va cada credencial ("auth" para la API Key, "playbackAuth" para la de reproducción). Formato en worker/README.md; se arma con la documentación técnica de la API.</small></details>`}
    <div class="provider-status ${test ? (test.ok ? "status-ok" : "status-error") : ""}" role="status">
      <strong>Estado de conexión:</strong> ${test ? `${test.ok ? "✔ Correcta" : "✖ Con problemas"}${test.at ? ` (${dateText(test.at)})` : ""}` : src.configured ? "sin probar" : "sin configurar"}
      ${test?.message ? `<span class="${test.ok ? "" : "provider-error"}">${e(test.message)}</span>` : ""}
    </div>
    <div class="form-actions">
      <button type="button" class="secondary" data-action="source-test" data-key="source-test" ${busy}>Probar conexión</button>
      <button type="submit" class="primary" ${busy}>Guardar configuración</button>
    </div>
    <p class="note">Al guardar se prueba la conexión. Si funciona, esta pasa a ser la única fuente activa y arranca la importación completa. Las credenciales se guardan cifradas en el servidor y nunca vuelven al navegador.</p>
  </form>
  ${src.configured ? importState(src) : ""}
  ${src.enabled ? `<div class="provider-actions">
    <button type="button" class="secondary" data-action="source-sync" data-mode="incremental" data-key="source-sync" ${busy}>Sincronizar cambios ahora</button>
    <button type="button" class="danger ${confirmFull ? "confirming" : ""}" data-action="source-sync" data-mode="full" data-key="source-full" ${busy}>${confirmFull ? "¿Importar todo de nuevo? Tocá otra vez" : "Importación completa"}</button>
    <a class="secondary" href="#/admin">Ver trabajos y registros</a>
  </div>` : ""}`;
}

function sourceSection(ctx) {
  return `<section class="settings-block" aria-labelledby="h-fuentes">
      <h2 id="h-fuentes">Fuentes de contenido</h2>
      ${catalogState(ctx)}
      ${ctx.account.isOwner && ctx.state.formError ? `<p class="form-error" role="alert">${e(ctx.state.formError)}</p>` : ""}
      ${ctx.account.isOwner && ctx.state.formMessage ? `<p class="note ok" role="status">${e(ctx.state.formMessage)}</p>` : ""}
      ${ctx.account.isOwner && ctx.state.busy ? `<p class="note" role="status">Procesando…</p>` : ""}
      ${ctx.account.isOwner ? sourceForm(ctx) : `<p class="note">El catálogo lo administra el propietario de Supat y es el mismo para todos los usuarios.</p>`}
    </section>`;
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
      if (!ctx.state.source) ctx.loadSource?.();
      const timer = setInterval(() => { if (ctx.state.source?.data?.activeJob && !document.hidden) ctx.loadSource?.({ quiet: true }); }, 15000);
      return () => clearInterval(timer);
    }
  };
}
