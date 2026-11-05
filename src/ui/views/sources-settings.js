// Ajustes → Fuentes de contenido: Fuente A y Fuente B (solo el propietario).
// Los campos salen del esquema compartido (src/shared/fuente-esquema.js) y empiezan vacíos.
// Las credenciales guardadas nunca llegan acá: solo se sabe si están configuradas.
import { escapeHtml as e } from "../../app/util.js";
import { SECTIONS, SLOTS } from "../../shared/fuente-esquema.js";

const JOB_PHASE = { items: "títulos", episodes: "temporadas y episodios", finish: "cerrando" };
const JOB_END = { done: "terminada", failed: "FALLIDA", cancelled: "cancelada" };
const OUTCOME = { complete: "Completada", warnings: "Completada con advertencias", partial: "PARCIAL (no completa)" };
const KIND_LABEL = { movie: "Películas", series: "Series", anime: "Anime", episodes: "Episodios" };

const dateText = ts => (ts ? new Date(ts).toLocaleString("es", { dateStyle: "short", timeStyle: "short" }) : "nunca");

function field(slot, f, src) {
  const id = `src-${slot}-${f.key.replace(/\W/g, "-")}`;
  const value = src.form?.[f.key];
  const help = f.help ? `<small id="${id}-h">${e(f.help)}</small>` : "";
  const desc = f.help ? `aria-describedby="${id}-h"` : "";
  const label = `<label for="${id}">${e(f.label)}${f.required ? " *" : ""}</label>`;
  if (f.type === "check") {
    return `<label class="check"><input type="checkbox" id="${id}" name="${e(f.key)}" ${value ? "checked" : ""}> ${e(f.label)}</label>`;
  }
  if (f.type === "secret") {
    const set = src.secretsSet?.includes(f.key);
    return `<div class="field">${label}<input id="${id}" name="secret:${e(f.key)}" type="password" autocomplete="new-password" spellcheck="false"
      placeholder="${set ? "Configurada · dejá vacío para conservarla" : "Sin configurar"}" ${desc}>
      ${set ? `<label class="check"><input type="checkbox" name="clear:${e(f.key)}"> Borrar la guardada</label>` : ""}${help}</div>`;
  }
  if (f.type === "secretkv") {
    const names = src.customSecretNames?.[f.key] || [];
    return `<div class="field">${label}<textarea id="${id}" name="secret:${e(f.key)}" rows="3" spellcheck="false" class="code" autocomplete="off"
      placeholder="${names.length ? `Configurados: ${e(names.join(", "))} (valores ocultos) · dejá vacío para conservarlos` : "Sin configurar"}" ${desc}></textarea>
      ${names.length ? `<label class="check"><input type="checkbox" name="clear:${e(f.key)}"> Borrar los guardados</label>` : ""}${help}</div>`;
  }
  if (f.type === "select") {
    return `<div class="field">${label}<select id="${id}" name="${e(f.key)}" ${desc}>${f.options.map(([v, t]) =>
      `<option value="${e(v)}" ${String(value ?? f.options[0][0]) === v ? "selected" : ""}>${e(t)}</option>`).join("")}</select>${help}</div>`;
  }
  if (f.type === "kv" || f.type === "list") {
    return `<div class="field">${label}<textarea id="${id}" name="${e(f.key)}" rows="3" spellcheck="false" class="code" ${desc}>${e(value ?? "")}</textarea>${help}</div>`;
  }
  const type = f.type === "number" ? "number" : f.type === "url" ? "url" : "text";
  return `<div class="field">${label}<input id="${id}" name="${e(f.key)}" type="${type}" value="${e(value ?? "")}" placeholder="${e(f.placeholder || "")}" autocomplete="off" spellcheck="false" ${desc}>${help}</div>`;
}

function jobLine(src) {
  const job = src.activeJob, last = src.lastJob;
  if (job) {
    const state = job.paused ? "<strong>Pausada</strong>" : job.status === "queued" ? "Pendiente" : job.nextRunAt > Date.now() + 5000 ? `En espera hasta ${dateText(job.nextRunAt)}` : "En curso";
    return `${state} (trabajo #${job.id}, ${job.mode === "full" ? "completa" : "cambios"}): ${e(JOB_PHASE[job.phase] || job.phase)} · ${job.pages} páginas · ${job.seen} recibidos · ${job.created} nuevos · ${job.merged} unidos · ${job.updated} actualizados · ${job.episodes} episodios`
      + (job.attempts ? ` · reintento ${job.attempts} a las ${dateText(job.nextRunAt)}` : "")
      + (job.lastError ? `<span class="provider-error">${e(job.lastError)}</span>` : "");
  }
  if (last) {
    const label = last.status === "done" ? OUTCOME[last.outcome] || "Terminada" : JOB_END[last.status] || last.status;
    const detail = last.status === "done" ? last.outcomeDetail : last.lastError;
    return `<strong>${label}</strong> el ${dateText(last.finishedAt)}${detail ? `<span class="${last.outcome === "partial" || last.status === "failed" ? "provider-error" : ""}">${e(detail)}</span>` : ""}`;
  }
  return "todavía no se hizo";
}

function result(r) {
  if (!r) return "";
  return `<p class="note ${r.ok ? "ok" : "form-error"}" role="status">${r.ok ? "✔" : "✖"} ${e(r.message)}${r.sample?.length ? ` · Ejemplos: ${e(r.sample.join(", "))}` : ""}${r.coverage ? `<br><small>Campos encontrados (de ${r.total}): ${Object.entries(r.coverage).map(([k, n]) => `${e(k)} ${n}`).join(" · ")}</small>` : ""}</p>`;
}

// Resultado de "Detectar": qué encontró, la prueba con el código real de importación y los avisos.
function detection(slot, d, busy) {
  if (!d) return "";
  if (!d.ok) return `<p class="note form-error" role="alert">✖ ${e(d.message)}</p>`;
  const r = d.report;
  const KIND = { movie: "Películas", series: "Series", episodes: "Episodios" };
  const checks = Object.entries(r.check).map(([k, c]) => `<li><strong>${KIND[k]}:</strong> ${c.valid} de ${c.received} válidos${c.samples.length ? ` · ${e(c.samples.join(", "))}` : ""}${r.coverage[k] ? `<br><small>Con dato: ${Object.entries(r.coverage[k]).map(([f, n]) => `${e(f)} ${n}`).join(" · ")}</small>` : ""}</li>`).join("");
  const lists = Object.entries(r.lists).map(([k, l]) => `<li>${KIND[k]}: lista en <code>${e(l.path)}</code> · ${e(l.paging)}</li>`).join("");
  const ok = Object.values(r.check).some(c => c.valid > 0);
  return `<div class="detect-result" role="status">
    <p class="note ${ok ? "ok" : "form-error"}">${ok ? "✔ Detectado." : "✖ Se leyó la respuesta, pero ningún título quedó válido."} ${e(r.auth)}</p>
    <ul class="detect-list">${checks}</ul>
    <details><summary>Ver qué se detectó</summary>
      <ul class="detect-list">${lists}
        <li>Campos: ${r.fields.map(f => `${e(f.label)} = <code>${e(f.path)}</code>`).join(" · ")}</li>
        ${r.episodes ? `<li>Episodios: <code>${e(r.episodes.path)}</code> · ${e(r.episodes.fields.join(" · "))}</li>` : ""}
        <li>Reproducción: ${e(r.playback)}</li>
      </ul></details>
    ${d.notes?.length ? `<ul class="detect-list">${d.notes.map(n => `<li>${e(n)}</li>`).join("")}</ul>` : ""}
    ${d.warnings?.length ? `<ul class="detect-list detect-warn">${d.warnings.map(w => `<li>⚠ ${e(w)}</li>`).join("")}</ul>` : ""}
    ${ok ? `<div class="form-actions"><button type="button" class="primary" data-action="src-detect-use" data-slot="${slot}" ${busy}>Usar esta configuración</button></div>
      <p class="note">Se guarda la configuración (la API Key, cifrada). Después: "Probar reproducción", "Activar" e "Iniciar importación".</p>` : ""}
  </div>`;
}

function simpleForm(slot, src, res, busy) {
  const f = src.form || {};
  const keySet = src.secretsSet?.includes("apiKey") || src.secretsSet?.includes("token");
  const input = (name, label, value, help, extra = "") => `<div class="field"><label for="simple-${slot}-${name}">${label}</label>
    <input id="simple-${slot}-${name}" name="${name}" type="text" value="${e(value || "")}" autocomplete="off" spellcheck="false" ${help ? `aria-describedby="simple-${slot}-${name}-h"` : ""} ${extra}>
    ${help ? `<small id="simple-${slot}-${name}-h">${help}</small>` : ""}</div>`;
  return `<form class="provider-form source-simple" data-form="source-simple" data-slot="${slot}" novalidate>
    <p class="note">Pegá las direcciones tal como las usás con tu API Key (por ejemplo la que probaste en PowerShell) y tocá "Detectar". Supat busca solo dónde están los títulos, qué es cada dato y cómo se pasa de página.</p>
    ${input("displayName", "Nombre visible *", f.displayName, "Lo ven los usuarios al elegir la fuente.")}
    ${input("movieUrl", "Dirección de películas", f["simple.movieUrl"], "Completa, con https://. Puede incluir la clave: se saca de la dirección y se guarda cifrada.")}
    ${input("seriesUrl", "Dirección de series (opcional)", f["simple.seriesUrl"], "")}
    ${input("episodesUrl", "Dirección de episodios de una serie (opcional)", f["simple.episodesUrl"], "La dirección de los episodios de UNA serie, con su ID real. Supat reconoce qué parte es la serie.")}
    <div class="field"><label for="simple-${slot}-apiKey">API Key</label>
      <input id="simple-${slot}-apiKey" name="apiKey" type="password" autocomplete="new-password" spellcheck="false" placeholder="${keySet ? "Configurada · dejá vacío para conservarla" : "Pegala acá (o dentro de la dirección)"}"></div>
    <details><summary>¿La clave va en un encabezado especial?</summary>
      ${input("keyHeader", "Nombre del encabezado", f.authType === "apiKeyHeader" ? f.apiKeyName : "", "Solo si la documentación lo indica (por ejemplo X-Api-Key). Vacío = Supat lo prueba solo.")}
    </details>
    <div class="form-actions"><button type="submit" class="primary" ${busy}>Detectar</button></div>
  </form>
  ${detection(slot, res.detect, busy)}`;
}

function card(ctx, slot) {
  const st = ctx.state.sources;
  const src = st.data[slot];
  const res = st.results?.[slot] || {};
  const confirm = ctx.state.confirm;
  const busy = ctx.state.busy ? "disabled" : "";
  const job = src.activeJob;
  const caps = src.capabilities || [];
  const c = src.counts || {};
  const act = (action, text, extra = "", cls = "secondary") => `<button type="button" class="${cls}" data-action="src-act" data-slot="${slot}" data-act="${action}" data-key="src:${slot}:${action}" ${extra} ${busy}>${text}</button>`;
  const restartKey = `src-restart:${slot}`;
  const removalsKey = `src-removals:${slot}`;
  const errors = st.errors?.[slot];
  return `<article class="provider source-card ${src.enabled ? "" : "is-off"}" aria-labelledby="h-src-${slot}">
    <header class="provider-head"><div>
      <h3 id="h-src-${slot}">${e(SLOTS[slot].label)}${src.form?.displayName ? ` · ${e(src.form.displayName)}` : ""}
        ${src.enabled ? `<span class="badge badge-on">Activa</span>` : `<span class="badge badge-off">Inactiva</span>`}</h3>
      <p class="provider-origin">${src.configured ? `Última sincronización completa: ${dateText(src.lastSyncAt)} · ${c.movie || 0} películas · ${c.series || 0} series · ${c.anime || 0} anime · ${c.episodes || 0} episodios` : "Sin configurar: pegá la dirección y la API Key abajo y tocá \"Detectar\"."}</p>
      ${src.configured ? `<div class="genres provider-caps">${caps.map(cp => `<span class="genre ${cp.supported ? "cap" : "cap-off"}" title="${cp.supported ? "Configurado" : "No soportado o sin configurar"}">${cp.supported ? "✔" : "—"} ${e(cp.label)}</span>`).join("")}</div>` : ""}
    </div></header>

    ${src.configured && src.missingToActivate?.length ? `<p class="note">Para activar e importar falta: ${e(src.missingToActivate.join(", "))}.</p>` : ""}
    ${src.configured && src.playbackProblems?.length ? `<p class="note">Reproducción: ${e(src.playbackProblems.join(" "))}</p>` : ""}

    <div class="provider-status ${src.lastTest ? (src.lastTest.ok ? "status-ok" : "status-error") : ""}" role="status">
      <strong>Conexión:</strong> ${src.lastTest ? `${src.lastTest.ok ? "✔ correcta" : "✖ con problemas"} (${dateText(src.lastTest.at)})<span>${e(src.lastTest.message)}</span>` : "sin probar"}
    </div>
    <div class="provider-status ${["error", "partial"].includes(src.lastStatus) ? "status-error" : ""}" role="status" aria-live="polite"><strong>Importación:</strong> ${jobLine(src)}</div>

    ${src.configured ? `<div class="provider-actions source-tools">
      ${act("test-connection", "Probar conexión")}
      <span class="tool-group">${act("test-catalog", "Probar catálogo")}<select data-src-kind="${slot}" aria-label="Categoría a probar" ${busy}>${["movie", "series", "anime", "episodes"].map(k => `<option value="${k}">${KIND_LABEL[k]}</option>`).join("")}</select></span>
      <span class="tool-group">${act("test-playback", "Probar reproducción")}<select data-src-play="${slot}" aria-label="Qué reproducir" ${busy}><option value="movie">Película</option><option value="episode">Episodio</option></select></span>
      ${src.enabled ? act("disable", "Desactivar") : act("enable", "Activar", "", "primary")}
      ${src.enabled && !job ? act("import", "Iniciar importación", "", "primary") + act("import-incremental", "Sincronizar cambios") : ""}
      ${job && !job.paused ? act("pause", "Pausar importación") : ""}
      ${job && job.paused ? act("resume", "Reanudar importación", "", "primary") : ""}
      ${src.enabled ? `<button type="button" class="danger ${confirm === restartKey ? "confirming" : ""}" data-action="src-act" data-slot="${slot}" data-act="restart" data-key="${restartKey}" ${busy}>${confirm === restartKey ? "¿Reiniciar desde cero? Tocá de nuevo" : "Reiniciar importación"}</button>` : ""}
      ${src.enabled ? `<button type="button" class="danger ${confirm === removalsKey ? "confirming" : ""}" data-action="src-act" data-slot="${slot}" data-act="restart-removals" data-key="${removalsKey}" ${busy}
        title="Usalo si la fuente realmente quitó muchos títulos: una importación completa normal no los oculta por precaución.">${confirm === removalsKey ? "¿Confirmar bajas y reiniciar? Tocá de nuevo" : "Reiniciar y confirmar bajas"}</button>` : ""}
      ${act("errors", errors ? "Actualizar errores" : "Ver errores")}
    </div>` : ""}
    ${result(res.connection)}${result(res.catalog)}${result(res.playback)}
    ${errors ? `<div class="source-errors"><strong>Errores y avisos recientes</strong>${errors.length ? `<ul class="history logs">${errors.map(l => `<li class="log-${e(l.level)}"><span>${e(l.message)}</span><small>${dateText(l.at)} · ${e(l.scope)}${l.jobId ? ` · trabajo ${l.jobId}` : ""}</small></li>`).join("")}</ul>` : `<p class="note">No hay errores registrados.</p>`}</div>` : ""}

    ${simpleForm(slot, src, res, busy)}

    <details class="source-advanced"><summary>Configuración avanzada (opcional)</summary>
    <p class="note">Todos los campos que completó la detección, para corregir algo puntual o para fuentes que no se detectan solas.</p>
    <form class="provider-form source-form" data-form="source-slot" data-slot="${slot}" novalidate>
      ${SECTIONS.filter(sec => !sec.simple).map(sec => `<details class="source-section"><summary>${e(sec.title)}</summary>
        ${sec.fields.map(f => field(slot, f, src)).join("")}
        ${(sec.groups || []).map(g => `<fieldset class="source-group"><legend>${e(g.title)}</legend>${g.fields.map(f => field(slot, f, src)).join("")}</fieldset>`).join("")}
      </details>`).join("")}
      <div class="form-actions"><button type="submit" class="primary" ${busy}>Guardar configuración</button></div>
      <p class="note">Las credenciales se guardan cifradas en el servidor y nunca vuelven al navegador. Guardá antes de usar las pruebas.</p>
    </form>
    </details>
  </article>`;
}

export function sourcesSection(ctx) {
  const st = ctx.state.sources;
  if (!st || (st.loading && !st.data)) return `<div class="empty" role="status"><div class="xp-spinner"></div>Cargando las fuentes…</div>`;
  if (st.error && !st.data) return `<p class="form-error" role="alert">${e(st.error)}</p>`;
  return `<p class="note">Dos fuentes independientes. Cada una tiene su configuración, sus credenciales y su importación; si una falla, la otra sigue funcionando. Un mismo título puede estar en las dos: el reproductor deja elegir.</p>
    ${Object.keys(SLOTS).map(slot => card(ctx, slot)).join("")}`;
}
