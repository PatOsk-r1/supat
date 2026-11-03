// Detalle de una película o serie: imagen de fondo, datos, botones y temporadas/episodios.
import { escapeHtml as e } from "../../app/util.js";
import { hrefFor } from "../../app/router.js";
import { KINDS, hasEpisodes } from "../../catalog/model.js";
import { formatTime } from "../../player/player.js";
import { favButton, providerBadge, empty, posterCard, row } from "../components.js";

function episodeRow(item, ep, ctx) {
  const p = ctx.progress.get(ep.id);
  const pct = p?.finished ? 100 : p?.duration ? Math.round((p.time / p.duration) * 100) : 0;
  const playable = Boolean(ep.source);
  return `<li class="episode ${playable ? "" : "no-source"}">
    <a href="${hrefFor.watch(item, ep)}" class="episode-link" data-key="ep:${e(ep.id)}" aria-label="Episodio ${ep.number}: ${e(ep.title)}${playable ? "" : " (sin fuente de video)"}">
      <span class="episode-thumb ${e(item.color)}">${ep.still ? `<img src="${e(ep.still)}" alt="" loading="lazy">` : `<span>${ep.number}</span>`}
        ${pct ? `<span class="progress-bar"><span style="width:${pct}%"></span></span>` : ""}</span>
      <span class="episode-info">
        <strong>${ep.number}. ${e(ep.title)}</strong>
        <small>${[ep.duration ? formatTime(ep.duration) : "", p?.finished ? "Visto" : pct ? `${pct}% visto` : "", playable ? "" : "Sin fuente de video"].filter(Boolean).map(e).join(" · ")}</small>
        ${ep.description ? `<span class="episode-desc">${e(ep.description)}</span>` : ""}
      </span>
    </a>
  </li>`;
}

// "Dónde verla": plataformas legales del país elegido en Ajustes (TMDb + JustWatch).
function watchHtml(watch) {
  return `<section class="watch-where" aria-labelledby="h-where"><h2 id="h-where">Dónde verla</h2>
    ${watch.groups.map(g => `<div class="where-group"><span>${e(g.label)}</span><ul>${g.providers.map(p =>
      `<li title="${e(p.name)}">${p.logo ? `<img src="${e(p.logo)}" alt="${e(p.name)}" loading="lazy">` : e(p.name)}</li>`).join("")}</ul></div>`).join("")}
    ${watch.link ? `<a class="see-all" href="${e(watch.link)}" target="_blank" rel="noopener noreferrer">Ver opciones en TMDb ↗</a>` : ""}
    <p class="attribution">Datos de disponibilidad de JustWatch.</p>
  </section>`;
}

export function seasonsHtml(item, seasons, ctx) {
  if (!seasons.length) return empty("Este proveedor no informó temporadas ni episodios.");
  const selected = Math.min(ctx.state.season || 0, seasons.length - 1);
  const tabs = seasons.length > 1 ? `<div class="filters season-tabs" role="group" aria-label="Temporadas">${seasons.map((s, i) =>
    `<button type="button" class="filter ${i === selected ? "chosen" : ""}" data-action="season" data-index="${i}" data-key="season:${i}" aria-pressed="${i === selected}">${e(s.title)}</button>`).join("")}</div>` : `<h3>${e(seasons[0].title)}</h3>`;
  return `${tabs}<ol class="episodes">${seasons[selected].episodes.map(ep => episodeRow(item, ep, ctx)).join("")}</ol>`;
}

// Primer episodio a reproducir: el que se estaba viendo o el primero.
export function resumeEpisode(seasons, ctx) {
  const all = seasons.flatMap(s => s.episodes);
  return all.find(ep => ctx.progress.resumeTime(ep.id)) || all.find(ep => !ctx.progress.isFinished(ep.id)) || all[0] || null;
}

export function render(ctx, route) {
  const item = ctx.catalog.get(route.id);
  if (!item) return { title: "No encontrado", html: `<h1 class="sr-only" tabindex="-1">No encontrado</h1>` + empty("No encontramos este título.", "Puede que su proveedor esté desactivado o ya no lo incluya.", `<a class="primary" href="#/inicio">Volver al inicio</a>`) };

  const info = ctx.enrichment?.(item) || {};
  const backdrop = info.backdrop || item.backdrop;
  const poster = info.poster || item.poster;
  const description = info.description || item.description;
  const rating = info.rating || item.rating;
  const genres = info.genres?.length ? info.genres : item.categories;
  const resume = !hasEpisodes(item) ? ctx.progress.resumeTime(item.id) : 0;
  const episodic = hasEpisodes(item);
  const playLabel = episodic ? "▶ Reproducir" : resume ? `▶ Seguir desde ${formatTime(resume)}` : "▶ Reproducir";

  const related = ctx.catalog.all()
    .filter(x => x.kind === item.kind && x.id !== item.id && x.categories.some(c => item.categories.includes(c)))
    .slice(0, 18);

  const html = `<article class="detail">
    <div class="detail-backdrop ${e(item.color)}" aria-hidden="true">${backdrop ? `<img src="${e(backdrop)}" alt="">` : ""}</div>
    <a href="#" class="back" data-action="back" data-key="back">← Volver</a>
    <div class="detail-main">
      <div class="detail-poster poster ${e(item.color)}">${poster ? `<img src="${e(poster)}" alt="Póster de ${e(item.title)}">` : `<span class="poster-title">${e(item.title)}</span>`}</div>
      <div class="detail-info">
        <span class="eyebrow">${KINDS[item.kind].label.toUpperCase()}${item.isDemo ? " · DEMOSTRACIÓN" : ""}</span>
        <h1 tabindex="-1">${e(item.title)}</h1>
        ${info.originalTitle && info.originalTitle !== item.title ? `<p class="original-title">${e(info.originalTitle)}</p>` : ""}
        <div class="hero-meta">${[item.year || info.year, info.runtime ? `${info.runtime} min` : "", rating ? `★ ${Number(rating).toFixed(1)}` : "", info.seasonCount ? `${info.seasonCount} temporada(s)` : ""].filter(Boolean).map(e).join("<span>•</span>")} ${providerBadge(item)}</div>
        <div class="genres">${genres.map(g => `<span class="genre">${e(g)}</span>`).join("")}</div>
        <p class="synopsis">${e(description || "Sin descripción disponible.")}</p>
        <div class="hero-actions">
          <a class="primary" href="${hrefFor.watch(item)}" data-action="play-detail" data-key="play">${playLabel}</a>
          ${resume ? `<a class="secondary" href="${hrefFor.watch(item)}" data-action="play-restart" data-key="restart">Empezar de nuevo</a>` : ""}
          ${favButton(item, ctx, "fav-big")}
        </div>
        ${info.cast?.length ? `<p class="cast"><strong>Reparto:</strong> ${info.cast.map(e).join(", ")}</p>` : ""}
        ${info.watch ? watchHtml(info.watch) : ""}
        ${info.attribution ? `<p class="attribution">${info.attribution}</p>` : ""}
      </div>
    </div>
    ${episodic ? `<section class="seasons" aria-label="Temporadas y episodios"><h2>Episodios</h2><div id="seasons">${item.seasons ? seasonsHtml(item, item.seasons, ctx) : `<p class="note" role="status">Cargando episodios…</p>`}</div></section>` : ""}
    ${row("Títulos similares", related.map(x => posterCard(x, ctx)).join(""))}
  </article>`;

  return {
    title: item.title,
    html,
    mount(view) {
      let alive = true;
      const box = () => view.querySelector("#seasons");
      const show = seasons => { if (alive && box()) box().innerHTML = seasonsHtml(item, seasons, ctx); };
      if (episodic) {
        const seasonsReady = item.seasons ? Promise.resolve(item.seasons) : ctx.catalog.seasons(item);
        seasonsReady.then(seasons => {
          if (!box()?.querySelector(".episodes, .empty")) show(seasons); // reemplaza el "Cargando episodios…"
          // Con TMDb configurado, completar los episodios de la temporada elegida.
          const selected = seasons[Math.min(ctx.state.season || 0, seasons.length - 1)];
          Promise.resolve(ctx.requestEnrichment?.(item))
            .then(() => ctx.enrichSeason?.(item, selected))
            .then(changed => { if (changed) show(seasons); })
            .catch(() => {});
        }).catch(err => { if (alive && box()) box().innerHTML = empty("No se pudieron cargar los episodios.", err.message); });
      } else {
        ctx.requestEnrichment?.(item);
      }
      return () => { alive = false; };
    }
  };
}
