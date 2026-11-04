// Piezas de interfaz reutilizables. Todas devuelven HTML como texto,
// con los datos escapados (escapeHtml) para que ningún título pueda inyectar código.
import { escapeHtml as e } from "../app/util.js";
import { hrefFor } from "../app/router.js";
import { KINDS } from "../catalog/model.js";

// Adónde lleva tocar una tarjeta: los canales se reproducen directo; el resto abre el detalle.
export const openHref = item => (item.kind === "live" ? hrefFor.watch(item) : hrefFor.detail(item));

function img(src, cls = "") {
  return src ? `<img class="${cls}" src="${e(src)}" alt="" loading="lazy" decoding="async">` : "";
}

export function favButton(item, ctx, extraClass = "") {
  const on = ctx.favorites.has(item.id);
  return `<button type="button" class="fav ${extraClass} ${on ? "selected" : ""}" data-action="fav" data-id="${e(item.id)}" data-key="fav:${e(item.id)}"
    aria-pressed="${on}" aria-label="${on ? "Quitar de" : "Agregar a"} favoritos: ${e(item.title)}">${on ? "♥" : "♡"}</button>`;
}

export function providerBadge(item) {
  return `<span class="badge" title="Origen del contenido">${e(item.providerName)}</span>`;
}

export function posterCard(item, ctx) {
  const meta = [item.year, item.categories[0]].filter(Boolean).map(e).join(" · ");
  return `<article class="card">
    <a class="poster ${e(item.color)}" href="${openHref(item)}" data-key="open:${e(item.id)}" aria-label="${e(item.title)}">
      ${img(item.poster)}
      <span class="poster-mark">${KINDS[item.kind].mark}</span>
      ${item.poster ? "" : `<span class="poster-title">${e(item.title)}</span>`}
      ${item.rating ? `<span class="poster-rating">★ ${item.rating.toFixed(1)}</span>` : ""}
    </a>
    <div class="card-meta">
      <div><strong title="${e(item.title)}">${e(item.title)}</strong><small>${meta || KINDS[item.kind].label}</small></div>
      ${favButton(item, ctx)}
    </div>
  </article>`;
}

export function channelCard(item, ctx, now = null) {
  return `<article class="card channel-card">
    <a class="channel-logo ${e(item.color)}" href="${hrefFor.watch(item)}" data-key="open:${e(item.id)}" aria-label="Ver ${e(item.title)}">
      ${item.logo ? img(item.logo, "logo-img") : `<span>${e(item.title.slice(0, 2).toUpperCase())}</span>`}
      ${item.channelNumber ? `<span class="channel-number">${item.channelNumber}</span>` : ""}
    </a>
    <div class="card-meta">
      <div><strong title="${e(item.title)}">${e(item.title)}</strong><small>${now ? `Ahora: ${e(now.title)}` : e(item.categories[0])}</small></div>
      ${favButton(item, ctx)}
    </div>
  </article>`;
}

// Tarjeta ancha de "Seguir viendo", con barra de progreso.
export function continueCard(entry, item) {
  const pct = entry.duration ? Math.min(100, Math.round((entry.time / entry.duration) * 100)) : 0;
  const href = entry.episodeId ? hrefFor.watch(item, { id: entry.episodeId }) : hrefFor.watch(item);
  return `<article class="card wide-card">
    <a class="wide-thumb ${e(item.color)}" href="${href}" data-key="cont:${e(entry.id)}" aria-label="Seguir viendo ${e(item.title)}">
      ${img(entry.still || item.backdrop || item.poster)}
      <span class="wide-play" aria-hidden="true">▶</span>
      <span class="progress-bar"><span style="width:${pct}%"></span></span>
    </a>
    <div class="card-meta"><div><strong>${e(item.title)}</strong><small>${e(entry.episodeLabel || `${pct}% visto`)}</small></div></div>
  </article>`;
}

export function cardFor(item, ctx) {
  return item.kind === "live" ? channelCard(item, ctx, ctx.nowPlaying?.(item)) : posterCard(item, ctx);
}

// Fila horizontal deslizable, con flechas en PC.
export function row(title, cardsHtml, { moreHref = "", id = "" } = {}) {
  if (!cardsHtml) return "";
  return `<section class="row" ${id ? `id="${e(id)}"` : ""}>
    <div class="row-head"><h2>${e(title)}</h2>
      <div class="row-tools">
        ${moreHref ? `<a href="${moreHref}" class="see-all">Ver todo</a>` : ""}
        <button type="button" class="row-arrow" data-action="scroll-row" data-dir="-1" aria-label="Anterior en ${e(title)}">‹</button>
        <button type="button" class="row-arrow" data-action="scroll-row" data-dir="1" aria-label="Siguiente en ${e(title)}">›</button>
      </div>
    </div>
    <div class="row-track">${cardsHtml}</div>
  </section>`;
}

export function grid(cardsHtml, emptyHtml) {
  return cardsHtml ? `<div class="grid">${cardsHtml}</div>` : `<div class="empty">${emptyHtml}</div>`;
}

export function heading(eyebrow, title) {
  return `<div class="section-title"><span class="eyebrow">${e(eyebrow)}</span><h1 tabindex="-1">${e(title)}</h1></div>`;
}

export function chips(name, options, selected, label) {
  return `<div class="filters" role="group" aria-label="${e(label)}">${options.map(([value, text]) =>
    `<button type="button" class="filter ${selected === value ? "chosen" : ""}" data-action="filter" data-name="${e(name)}" data-value="${e(value)}"
      data-key="${e(name)}:${e(value)}" aria-pressed="${selected === value}">${e(text)}</button>`).join("")}</div>`;
}

export function select(name, options, selected, label) {
  return `<label class="select"><span class="sr-only">${e(label)}</span>
    <select data-action="filter-select" data-name="${e(name)}" data-key="sel:${e(name)}" aria-label="${e(label)}">
      ${options.map(([value, text]) => `<option value="${e(value)}" ${selected === value ? "selected" : ""}>${e(text)}</option>`).join("")}
    </select></label>`;
}

// Qué mostrar cuando no hay títulos: sin contenido de relleno, con el motivo real.
export function catalogEmpty(ctx, what = "títulos") {
  const st = ctx.catalog.status("central");
  const a = ctx.account;
  if (st.state === "loading" || (!a.ready && st.state !== "ok")) return `<div class="empty" role="status"><div class="xp-spinner"></div>Cargando el catálogo…</div>`;
  if (!a.signedIn) return empty("Iniciá sesión para ver el catálogo.", "El catálogo de Supat es para usuarios registrados.", `<a class="primary" href="#/cuenta">Ingresar</a>`);
  if (!a.verified) return empty("Verificá tu correo para ver el catálogo.", "Tocá el enlace del mail que te enviamos y después \"Ya lo verifiqué\" en tu perfil.", `<a class="primary" href="#/perfil">Ir a mi perfil</a>`);
  if (st.state === "error") return empty("El catálogo no está disponible.", st.error || "Probá de nuevo en unos minutos.", a.isOwner ? `<a class="primary" href="#/ajustes">Ir a Fuentes de contenido</a>` : "");
  return empty(`Todavía no hay ${what} en el catálogo.`, a.isOwner ? "Revisá la fuente de contenido y la importación en Ajustes." : "Volvé a mirar más tarde.");
}

export function empty(title, detail = "", actionHtml = "") {
  return `<div class="empty"><strong>${e(title)}</strong>${detail ? `<span>${e(detail)}</span>` : ""}${actionHtml}</div>`;
}
