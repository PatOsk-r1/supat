// Pantalla de reproducción. Pide la fuente al catálogo y se la pasa al reproductor.
import { escapeHtml as e } from "../../app/util.js";
import { hrefFor } from "../../app/router.js";
import { KINDS, findEpisode, nextEpisode, hasEpisodes } from "../../catalog/model.js";
import { createPlayer, playerMessage } from "../../player/player.js";
import { createEmbed } from "../../player/embed.js";
import { favButton, providerBadge, empty } from "../components.js";
import { resumeEpisode } from "./detail.js";

export function render(ctx, route) {
  const item = ctx.catalog.get(route.id);
  if (!item) return { title: "No encontrado", html: `<h1 class="sr-only" tabindex="-1">No encontrado</h1>` + empty("No encontramos este título.", "Puede que su proveedor esté desactivado o ya no lo incluya.", `<a class="primary" href="#/inicio">Volver al inicio</a>`) };

  const backHref = item.kind === "live" ? "#/tv" : hrefFor.detail(item);
  return {
    title: item.title,
    html: `<article class="watch">
      <div class="player" id="player"><div class="player-message" role="status"><div class="xp-spinner"></div><small>Preparando…</small></div></div>
      <div class="watch-info">
        <div><span class="eyebrow">${KINDS[item.kind].label.toUpperCase()}</span>
          <h1 tabindex="-1" id="watch-title">${e(item.title)}</h1>
          <div class="hero-meta"><span id="watch-sub">${[item.year, item.categories[0]].filter(Boolean).map(e).join(" · ")}</span> ${providerBadge(item)}</div>
          <p id="watch-desc">${e(item.description || "")}</p></div>
        <div class="watch-actions">${favButton(item, ctx, "fav-big")}<a class="secondary" href="${backHref}">${item.kind === "live" ? "Canales" : "Detalle"}</a></div>
      </div>
      <div id="sources"></div>
    </article>`,
    mount: view => mountWatch(view, ctx, item, route, backHref)
  };
}

function mountWatch(view, ctx, item, route, backHref) {
  let player = null;
  let alive = true;
  const box = view.querySelector("#player");

  (async () => {
    // Series y anime por episodios: averiguar qué episodio reproducir.
    let episode = null;
    if (hasEpisodes(item)) {
      const seasons = await ctx.catalog.seasons(item);
      episode = route.episodeId ? findEpisode(item, route.episodeId)?.episode : resumeEpisode(seasons, ctx);
      if (!episode) { playerMessage(box, "Esta serie no tiene episodios disponibles", "El proveedor no informó episodios para este título."); return; }
      view.querySelector("#watch-title").textContent = `${item.title}`;
      view.querySelector("#watch-sub").textContent = `T${findEpisode(item, episode.id).season.number} · E${episode.number} — ${episode.title}`;
      view.querySelector("#watch-desc").textContent = episode.description || item.description;
    }
    if (!alive) return;

    // Fuentes de todos los proveedores compatibles; el usuario puede elegir entre ellas.
    let source = null, option = null;
    try {
      const options = await ctx.catalog.sourcesFor(item, episode);
      if (!alive) return;
      const index = Math.min(ctx.state.sourceIndex || 0, Math.max(0, options.length - 1));
      option = options[index] || null;
      if (options.length > 1) {
        view.querySelector("#sources").innerHTML = `<div class="filters" role="group" aria-label="Fuente de reproducción"><span class="note">Fuente:</span>${options.map((o, i) =>
          `<button type="button" class="filter ${i === index ? "chosen" : ""}" data-action="source" data-index="${i}" data-key="source:${i}" aria-pressed="${i === index}">${e(o.label)}</button>`).join("")}</div>`;
      }
      source = option ? await option.resolve() : null;
    } catch (err) {
      if (alive) playerMessage(box, "No se pudo obtener la fuente de video", err.message || "El proveedor no respondió.");
      return;
    }
    if (!alive) return;
    if (!source) {
      playerMessage(box, "Este elemento no tiene una fuente de video", "La fuente de contenido no informó una dirección de video para este título.");
      return;
    }

    const playId = episode ? episode.id : item.id;
    const next = episode ? nextEpisode(item, episode.id) : null;
    const nextHref = next ? hrefFor.watch(item, next) : "";
    const restart = ctx.state.restartRequested;
    ctx.state.restartRequested = false;
    const seasonNumber = episode ? findEpisode(item, episode.id).season.number : 0;

    if (source.type === "embed") {
      // Reproductor externo del proveedor: la app no controla el video ni guarda el progreso.
      player = createEmbed(box, { url: source.url, title: item.title, allowedOrigins: option.embedOrigins });
      return;
    }
    player = createPlayer(box, {
      source,
      title: item.title,
      subtitle: episode ? `T${seasonNumber} · E${episode.number} — ${episode.title}` : item.kind === "live" ? "En vivo" : "",
      live: item.kind === "live",
      preference: ctx.settings.get("player"),
      startAt: !restart && ctx.settings.get("resume") ? ctx.progress.resumeTime(playId) : 0,
      backHref,
      next: next ? { label: "Siguiente", href: nextHref } : null,
      onProgress: (time, duration) => ctx.progress.save(playId, time, duration, {
        itemId: item.id,
        episodeId: episode?.id || null,
        episodeLabel: episode ? `T${seasonNumber} · E${episode.number} — ${episode.title}` : "",
        title: item.title,
        kind: item.kind,
        poster: item.poster || ""
      }),
      onEnded: () => { if (next && ctx.settings.get("autoplayNext")) location.hash = nextHref; }
    });
    player.root.focus({ preventScroll: true });
  })().catch(err => { if (alive) playerMessage(box, "No se pudo preparar la reproducción", err.message || ""); });

  return () => { alive = false; player?.destroy(); };
}
