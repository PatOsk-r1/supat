// Inicio: carrusel de destacados y filas por tipo y categoría.
import { escapeHtml as e } from "../../app/util.js";
import { hrefFor } from "../../app/router.js";
import { KINDS, hasEpisodes } from "../../catalog/model.js";
import { cardFor, continueCard, favButton, row, catalogEmpty, providerBadge } from "../components.js";

const ROW_SIZE = 18;

function featured(items) {
  const candidates = items.filter(x => x.kind !== "live");
  const picked = [
    ...candidates.filter(x => x.featured),
    ...candidates.filter(x => !x.featured && x.backdrop)
  ];
  return (picked.length ? picked : candidates).slice(0, 6);
}

function hero(list, ctx) {
  if (!list.length) return "";
  const slides = list.map((item, i) => `<article class="hero-slide ${i === 0 ? "active" : ""}" data-slide="${i}" ${i ? 'aria-hidden="true"' : ""}>
      <div class="hero-art ${e(item.color)}" aria-hidden="true">${item.backdrop || item.poster ? `<img src="${e(item.backdrop || item.poster)}" alt="" ${i ? 'loading="lazy"' : ""}>` : `<div class="hero-x">S</div>`}</div>
      <div class="hero-content">
        <span class="eyebrow">DESTACADO · ${KINDS[item.kind].label.toUpperCase()}</span>
        <h${i === 0 ? "1 tabindex=\"-1\"" : "2"} class="hero-title">${e(item.title)}</h${i === 0 ? 1 : 2}>
        <div class="hero-meta">${[item.year, item.categories.slice(0, 2).join(" · "), item.rating ? `★ ${item.rating.toFixed(1)}` : ""].filter(Boolean).map(e).join("<span>•</span>")} ${providerBadge(item)}</div>
        <p>${e(item.description || "Sin descripción disponible.")}</p>
        <div class="hero-actions">
          <a class="primary" href="${hasEpisodes(item) ? hrefFor.detail(item) : hrefFor.watch(item)}" ${i ? 'tabindex="-1"' : ""}>▶ ${hasEpisodes(item) ? "Ver episodios" : "Reproducir"}</a>
          <a class="secondary" href="${hrefFor.detail(item)}" ${i ? 'tabindex="-1"' : ""}>Más información</a>
          ${favButton(item, ctx, "fav-big")}
        </div>
      </div>
    </article>`).join("");
  const dots = list.length > 1 ? `<div class="hero-dots" role="group" aria-label="Elegir destacado">${list.map((item, i) =>
    `<button type="button" class="hero-dot ${i === 0 ? "active" : ""}" data-action="hero-go" data-index="${i}" aria-label="Destacado ${i + 1}: ${e(item.title)}" aria-pressed="${i === 0}"></button>`).join("")}</div>` : "";
  return `<section class="hero" aria-roledescription="carrusel" aria-label="Destacados">${slides}${dots}</section>`;
}

export function render(ctx) {
  const items = ctx.catalog.all();
  if (!items.length) {
    return { title: "Inicio", html: `<h1 class="sr-only" tabindex="-1">Inicio</h1>` + catalogEmpty(ctx) };
  }
  const cards = list => list.slice(0, ROW_SIZE).map(x => cardFor(x, ctx)).join("");

  const continuing = ctx.progress.recent(ROW_SIZE)
    .map(entry => ({ entry, item: ctx.catalog.get(entry.itemId || entry.id) }))
    .filter(x => x.item);
  const favs = items.filter(x => ctx.favorites.has(x.id));
  const live = items.filter(x => x.kind === "live");
  const movies = items.filter(x => x.kind === "movie");
  const series = items.filter(x => x.kind === "series");
  const anime = items.filter(x => x.kind === "anime");

  const categoryRows = ctx.catalog.categories("movie").slice(0, 4)
    .map(cat => [cat, movies.filter(x => x.categories.includes(cat))])
    .filter(([, list]) => list.length >= 3)
    .map(([cat, list]) => row(`Películas · ${cat}`, cards(list), { moreHref: "#/peliculas" }));

  const html = hero(featured(items), ctx)
    + row("Seguir viendo", continuing.map(x => continueCard(x.entry, x.item)).join(""))
    + row("Tus favoritos", cards(favs), { moreHref: "#/favoritos" })
    + row("TV en vivo", cards(live), { moreHref: "#/tv" })
    + row("Películas", cards(movies), { moreHref: "#/peliculas" })
    + row("Series", cards(series), { moreHref: "#/series" })
    + row("Anime", cards(anime), { moreHref: "#/anime" })
    + categoryRows.join("");

  return { title: "Inicio", html, mount: mountHero };
}

// Rota el carrusel cada 8 s; se detiene con el mouse encima, con foco adentro o con "reducir movimiento".
function mountHero(view) {
  const heroEl = view.querySelector(".hero");
  const slides = heroEl ? [...heroEl.querySelectorAll(".hero-slide")] : [];
  if (slides.length < 2) return () => {};
  let index = 0, paused = false;
  const go = i => {
    index = (i + slides.length) % slides.length;
    slides.forEach((s, n) => {
      const on = n === index;
      s.classList.toggle("active", on);
      on ? s.removeAttribute("aria-hidden") : s.setAttribute("aria-hidden", "true");
      s.querySelectorAll("a, button").forEach(el => on ? el.removeAttribute("tabindex") : el.setAttribute("tabindex", "-1"));
    });
    heroEl.querySelectorAll(".hero-dot").forEach((d, n) => { d.classList.toggle("active", n === index); d.setAttribute("aria-pressed", n === index); });
  };
  const onClick = ev => { const dot = ev.target.closest('[data-action="hero-go"]'); if (dot) go(+dot.dataset.index); };
  heroEl.addEventListener("click", onClick);
  heroEl.addEventListener("pointerenter", () => { paused = true; });
  heroEl.addEventListener("pointerleave", () => { paused = false; });
  heroEl.addEventListener("focusin", () => { paused = true; });
  heroEl.addEventListener("focusout", () => { paused = false; });
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const timer = reduce ? 0 : setInterval(() => { if (!paused && !document.hidden) go(index + 1); }, 8000);
  return () => clearInterval(timer);
}
