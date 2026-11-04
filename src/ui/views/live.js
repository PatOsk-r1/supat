// TV en vivo al estilo de las apps de IPTV: categorías, lista de canales con la
// programación actual y una vista previa con el reproductor.
import { escapeHtml as e } from "../../app/util.js";
import { hrefFor } from "../../app/router.js";
import { createPlayer, playerMessage } from "../../player/player.js";
import { favButton, providerBadge, empty, heading } from "../components.js";

const PAGE = 200;
const time = ts => new Date(ts).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });

function programPct(p, now = Date.now()) {
  return p ? Math.max(0, Math.min(100, Math.round(((now - p.start) / (p.stop - p.start)) * 100))) : 0;
}

function channelRow(item, ctx, selected) {
  const { now } = ctx.catalog.nowNext(item);
  return `<li class="ch ${selected ? "selected" : ""}">
    <a class="ch-link" href="${hrefFor.watch(item)}" data-action="live-select" data-id="${e(item.id)}" data-key="ch:${e(item.id)}" aria-current="${selected}" aria-label="${e(item.title)}${now ? `, ahora: ${e(now.title)}` : ""}">
      <span class="ch-num">${item.channelNumber || ""}</span>
      <span class="ch-logo ${e(item.color)}">${item.logo ? `<img src="${e(item.logo)}" alt="" loading="lazy">` : e(item.title.slice(0, 2).toUpperCase())}</span>
      <span class="ch-text"><strong>${e(item.title)}</strong>
        <small>${now ? `${time(now.start)} · ${e(now.title)}` : e(item.categories[0])}</small>
        ${now ? `<span class="ch-progress"><span style="width:${programPct(now)}%"></span></span>` : ""}</span>
    </a>
    ${favButton(item, ctx)}
  </li>`;
}

function previewInfo(item, ctx) {
  const { now, next } = ctx.catalog.nowNext(item);
  const upcoming = ctx.catalog.schedule(item).filter(p => p.stop > Date.now()).slice(0, 6);
  return `<div class="preview-info">
    <div class="preview-head"><div><span class="eyebrow">CANAL ${item.channelNumber || ""}</span><h2>${e(item.title)}</h2></div>
      <a class="secondary" href="${hrefFor.watch(item)}">⛶ Pantalla completa</a></div>
    <div class="hero-meta">${e(item.categories.join(" · "))} ${providerBadge(item)}</div>
    ${now ? `<p class="now"><strong>Ahora:</strong> ${e(now.title)} <small>${time(now.start)}–${time(now.stop)}</small></p>${now.description ? `<p class="note">${e(now.description)}</p>` : ""}` : ""}
    ${next ? `<p class="next"><strong>Después:</strong> ${e(next.title)} <small>${time(next.start)}</small></p>` : ""}
    ${!now && !next ? `<p class="note">${e(item.description || "Sin guía de programación para este canal.")}</p>` : ""}
    ${upcoming.length > 2 ? `<ol class="schedule">${upcoming.map(p => `<li><span>${time(p.start)}</span>${e(p.title)}</li>`).join("")}</ol>` : ""}
  </div>`;
}

export function render(ctx, section) {
  const all = ctx.catalog.all().filter(x => x.kind === "live")
    .sort((a, b) => (a.channelNumber || 1e9) - (b.channelNumber || 1e9) || a.title.localeCompare(b.title, "es"));
  if (!all.length) {
    return { title: section.label, html: `<div class="section-heading">${heading("CANALES", section.label)}</div>` + empty("Todavía no hay canales.", "Agregá una lista de canales (M3U) en Ajustes.", `<a class="primary" href="#/ajustes">Ir a Ajustes</a>`) };
  }
  const f = ctx.state.filters;
  const categories = ctx.catalog.categories("live");
  const favCount = all.filter(x => ctx.favorites.has(x.id)).length;
  if (f.category !== "Todos" && f.category !== "★" && !categories.includes(f.category)) f.category = "Todos";
  const list = f.category === "Todos" ? all : f.category === "★" ? all.filter(x => ctx.favorites.has(x.id)) : all.filter(x => x.categories.includes(f.category));
  const shown = list.slice(0, f.limit || PAGE);
  const selected = ctx.catalog.get(ctx.state.liveSelected) || null;

  const catButton = (value, label, count) => `<li><button type="button" class="cat ${f.category === value ? "chosen" : ""}" data-action="filter" data-name="category" data-value="${e(value)}" data-key="category:${e(value)}" aria-pressed="${f.category === value}">
    <span>${e(label)}</span><small>${count}</small></button></li>`;

  const html = `<div class="section-heading">${heading(`${all.length} CANALES`, section.label)}</div>
  <div class="live">
    <nav class="live-cats" aria-label="Categorías de canales"><ul>
      ${catButton("Todos", "Todos", all.length)}
      ${favCount ? catButton("★", "Favoritos", favCount) : ""}
      ${categories.map(c => catButton(c, c, all.filter(x => x.categories.includes(c)).length)).join("")}
    </ul></nav>
    <div class="live-list">
      ${shown.length ? `<ul class="channels">${shown.map(x => channelRow(x, ctx, selected?.id === x.id)).join("")}</ul>` : empty("No hay canales en esta categoría.")}
      ${list.length > shown.length ? `<div class="more"><button type="button" class="secondary" data-action="more" data-key="more">Mostrar más (${list.length - shown.length})</button></div>` : ""}
    </div>
    <aside class="live-preview" aria-label="Vista previa">
      ${selected ? `<div class="player" id="preview-player"></div>${previewInfo(selected, ctx)}`
        : `<div class="player"><div class="player-message"><span class="player-icon" aria-hidden="true">◉</span><strong>Elegí un canal</strong><small>Se reproduce acá. Para verlo grande, usá "Pantalla completa".</small></div></div>`}
    </aside>
  </div>`;

  return {
    title: section.label,
    html,
    mount(view) {
      if (!selected) return () => {};
      let player = null, alive = true;
      const box = view.querySelector("#preview-player");
      ctx.catalog.resolveSource(selected).then(source => {
        if (!alive) return;
        if (!source) {
          playerMessage(box, "Este canal no tiene una fuente de video", "La fuente de contenido no informó una dirección para este canal.");
          return;
        }
        player = createPlayer(box, { source, title: selected.title, subtitle: "En vivo", live: true, preference: ctx.settings.get("player") });
      }).catch(err => { if (alive) playerMessage(box, "No se pudo obtener la fuente", err.message || ""); });
      return () => { alive = false; player?.destroy(); };
    }
  };
}
