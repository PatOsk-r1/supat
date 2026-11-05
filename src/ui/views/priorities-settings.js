// Ajustes → Prioridad de datos entre fuentes (solo propietario).
// Para cada campo se elige qué fuente manda. Guardar NO cambia datos; la vista previa muestra qué
// cambiaría; aplicar pide confirmación y recalcula el catálogo por tandas (se puede reanudar).
import { escapeHtml as e } from "../../app/util.js";

const LABEL = { titles: "Títulos", episodes: "Episodios" };

export function prioritiesSection(ctx) {
  const st = ctx.state.priorities;
  if (!st || (st.loading && !st.data)) return `<div class="empty" role="status"><div class="xp-spinner"></div>Cargando prioridades…</div>`;
  if (st.error && !st.data) return `<p class="form-error" role="alert">${e(st.error)}</p>`;
  const { fields, sources, active, pending, job } = st.data;
  const shown = pending || active;
  const busy = ctx.state.busy ? "disabled" : "";
  const confirmKey = "prio-apply";
  const confirm = ctx.state.confirm === confirmKey;
  const p = st.preview;
  const row = ([field, label]) => {
    const first = shown[field]?.[0] || sources[0].id;
    const differs = pending && JSON.stringify(pending[field]) !== JSON.stringify(active[field]);
    return `<tr><th scope="row">${e(label)}${differs ? ` <span class="badge">sin aplicar</span>` : ""}</th>
      <td><select name="${e(field)}" aria-label="Fuente preferida para ${e(label)}">${sources.map(s => `<option value="${e(s.id)}" ${first === s.id ? "selected" : ""}>${e(s.label)} primero</option>`).join("")}</select></td></tr>`;
  };
  return `<p class="note">Para cada campo, la fuente elegida manda; si no tiene ese dato, se usa la otra. Un dato vacío nunca borra uno existente. Los títulos se siguen uniendo solo por TMDb e IMDb.</p>
    <form class="provider-form" data-form="priorities">
      ${Object.entries(fields).map(([group, list]) => `<div class="table-wrap"><table class="admin-table"><caption>${e(LABEL[group])}</caption><tbody>${list.map(row).join("")}</tbody></table></div>`).join("")}
      <div class="form-actions">
        <button type="submit" class="secondary" ${busy}>Guardar prioridades (sin aplicar)</button>
        <button type="button" class="secondary" data-action="prio-preview" data-key="prio-preview" ${busy}>Vista previa</button>
        ${pending ? `<button type="button" class="danger ${confirm ? "confirming" : ""}" data-action="prio-apply" data-key="${confirmKey}" ${busy}>${confirm ? "¿Actualizar todo el catálogo? Tocá de nuevo" : "Aplicar a todo el catálogo"}</button>` : ""}
      </div>
    </form>
    ${p ? `<div class="provider-status" role="status"><strong>Vista previa:</strong>
      ${p.changedTitles} de ${p.evaluatedTitles} títulos evaluados cambiarían${p.totalMultiTitles > p.evaluatedTitles ? ` (hay ${p.totalMultiTitles} títulos con datos de las dos fuentes; se evaluaron los primeros ${p.evaluatedTitles})` : ""} · ${p.changedEpisodes} de ${p.evaluatedEpisodes} episodios.
      ${Object.keys(p.fieldCounts).length ? `<span>Por campo: ${Object.entries(p.fieldCounts).map(([f, n]) => `${e(f)} ${n}`).join(" · ")}</span>` : ""}
      ${p.examples.length ? `<ul class="history">${p.examples.map(x => `<li><strong>${e(x.title)}</strong> ${Object.entries(x.changes).map(([f, [a, b]]) => `<span>${e(f)}: “${e(a)}” → “${e(b)}”</span>`).join(" ")}</li>`).join("")}</ul>` : ""}</div>` : ""}
    ${job ? `<div class="provider-status ${job.status === "running" ? "" : job.status === "done" ? "status-ok" : "status-error"}" role="status" aria-live="polite">
      <strong>Actualización del catálogo #${job.id}:</strong> ${job.status === "running" ? `en curso (${job.phase === "episodes" ? "episodios" : "títulos"}) · ${job.processed} revisados · ${job.changed} con cambios` : job.status === "done" ? `terminada · ${job.processed} revisados · ${job.changed} con cambios` : e(job.status)}
      ${job.lastError ? `<span class="provider-error">${e(job.lastError)}</span>` : ""}
      ${job.status === "running" ? `<button type="button" class="secondary" data-action="prio-continue" data-key="prio-continue" ${busy}>Continuar</button>` : ""}</div>` : ""}`;
}
