import "./style.css";
import { loadCatalog, KINDS } from "./catalog/index.js";
import { createFavorites } from "./app/favorites.js";
import { mountPlayer } from "./player/player.js";
import { escapeHtml as e } from "./app/util.js";

// Secciones del menú. `kind` indica qué tipo de contenido muestra cada una.
const SECTIONS = [
  { id: "inicio", label: "Inicio", icon: "⌂" },
  { id: "tv", label: "TV en vivo", icon: "◉", kind: "live" },
  { id: "peliculas", label: "Películas", icon: "▣", kind: "movie" },
  { id: "series", label: "Series", icon: "▤", kind: "series" },
  { id: "favoritos", label: "Favoritos", icon: "♥" }
];

const state = { route: { name: "inicio" }, query: "", category: "Todos", items: [], errors: [], loading: true };
const favorites = createFavorites();
let cleanupPlayer = () => {};

const app = document.querySelector("#app");

// ---------- Rutas (la dirección después de # decide qué vista se ve) ----------
function parseRoute() {
  const [, name = "inicio", param] = location.hash.split("/");
  if (name === "ver" && param) return { name: "ver", id: decodeURIComponent(param) };
  return SECTIONS.some(s => s.id === name) ? { name } : { name: "inicio" };
}
const playHref = item => `#/ver/${encodeURIComponent(item.id)}`;

// ---------- Piezas de interfaz ----------
function posterContent(item) {
  return `${item.image ? `<img src="${e(item.image)}" alt="" loading="lazy">` : ""}
    <span class="poster-mark">${KINDS[item.kind].mark}${item.isDemo ? " · DEMO" : ""}</span>
    <span class="poster-title">${e(item.title)}</span>`;
}

function favButton(item, extraClass = "") {
  const on = favorites.has(item.id);
  return `<button type="button" class="fav ${extraClass} ${on ? "selected" : ""}" data-fav="${e(item.id)}" data-key="fav:${e(item.id)}"
    aria-pressed="${on}" aria-label="${on ? "Quitar de" : "Agregar a"} favoritos: ${e(item.title)}">${on ? "♥" : "♡"}</button>`;
}

function card(item) {
  return `<article class="card">
    <a class="poster ${e(item.color)}" href="${playHref(item)}" data-key="open:${e(item.id)}" aria-label="Ver ${e(item.title)}">${posterContent(item)}</a>
    <div class="card-meta">
      <div><strong>${e(item.title)}</strong><small>${item.year || KINDS[item.kind].label} · ${e(item.category)}</small>
        ${item.description ? `<p>${e(item.description)}</p>` : ""}</div>
      ${favButton(item)}
    </div>
  </article>`;
}

function grid(items, emptyHtml) {
  return items.length ? `<div class="grid">${items.map(card).join("")}</div>` : `<div class="empty">${emptyHtml}</div>`;
}

function heading(eyebrow, title) {
  return `<div class="section-title"><span class="eyebrow">${e(eyebrow)}</span><h1 tabindex="-1">${e(title)}</h1></div>`;
}

function filters(categories) {
  return `<div class="filters" role="group" aria-label="Filtrar por categoría">${categories.map(c =>
    `<button type="button" class="filter ${state.category === c ? "chosen" : ""}" data-category="${e(c)}" data-key="cat:${e(c)}" aria-pressed="${state.category === c}">${e(c)}</button>`
  ).join("")}</div>`;
}

const matches = (item, q) => `${item.title} ${item.category} ${item.description}`.toLowerCase().includes(q);

// ---------- Vistas ----------
function homeView() {
  const featured = state.items.find(x => x.featured) || state.items.find(x => x.kind !== "live");
  const hero = featured ? `<section class="hero" aria-label="Destacado">
      <div class="hero-content"><span class="eyebrow">DESTACADO${featured.isDemo ? " · DEMOSTRACIÓN" : ""}</span>
        <h1 tabindex="-1">${e(featured.title)}</h1>
        <p>${e(featured.description || "Sin descripción disponible.")}</p>
        <div class="hero-actions"><a class="primary" href="${playHref(featured)}">▶ Ver ahora</a>${favButton(featured, "fav-big")}</div>
      </div>
      <div class="hero-art ${e(featured.color)}" aria-hidden="true">${featured.image ? `<img src="${e(featured.image)}" alt="">` : `<div class="hero-x">X</div>`}</div>
    </section>` : heading("INICIO", "Inicio");

  const rows = SECTIONS.filter(s => s.kind).map(s => {
    const items = state.items.filter(x => x.kind === s.kind).slice(0, 6);
    if (!items.length) return "";
    return `<section class="row"><div class="row-head"><h2>${s.label}</h2><a href="#/${s.id}" class="see-all">Ver todo →</a></div>${grid(items, "")}</section>`;
  }).join("");
  return hero + (rows || `<div class="empty">Todavía no hay contenido en el catálogo.</div>`);
}

function sectionView(section) {
  const all = state.items.filter(x => x.kind === section.kind);
  const categories = ["Todos", ...new Set(all.map(x => x.category))];
  if (!categories.includes(state.category)) state.category = "Todos";
  const items = state.category === "Todos" ? all : all.filter(x => x.category === state.category);
  return `<div class="section-heading">${heading("CATÁLOGO", section.label)}${all.length > 1 ? filters(categories) : ""}</div>
    ${grid(items, all.length ? "No hay contenido en esta categoría." : `Todavía no hay contenido de ${section.label.toLowerCase()}.`)}`;
}

function favoritesView() {
  const items = state.items.filter(x => favorites.has(x.id));
  const warning = favorites.persistent ? "" : `<p class="warning">Tu navegador no permite guardar datos: los favoritos se perderán al cerrar la página.</p>`;
  return `<div class="section-heading">${heading("TU LISTA", "Favoritos")}</div>${warning}
    ${grid(items, `<strong>Todavía no tenés favoritos.</strong><span>Tocá el corazón ♡ de cualquier título para guardarlo acá.</span><a class="primary" href="#/inicio">Explorar el catálogo</a>`)}`;
}

function searchView() {
  const q = state.query.trim().toLowerCase();
  const items = state.items.filter(x => matches(x, q));
  return `<div class="section-heading">${heading("BÚSQUEDA", `Resultados para “${state.query.trim()}”`)}
    <button type="button" class="filter" data-clear-search data-key="clear-search">Borrar búsqueda ✕</button></div>
    ${grid(items, `<strong>No encontramos nada con “${e(state.query.trim())}”.</strong><span>Probá con otro nombre o categoría.</span>`)}`;
}

function playerView(item) {
  if (!item) return `<div class="empty"><strong>No encontramos este título.</strong><span>Puede que ya no esté en el catálogo.</span><a class="primary" href="#/inicio">Volver al inicio</a></div>`;
  return `<article class="watch">
    <button type="button" class="back" data-back data-key="back">← Volver</button>
    <div class="player" id="player"></div>
    <div class="watch-info">
      <div><span class="eyebrow">${KINDS[item.kind].label.toUpperCase()}${item.isDemo ? " · DEMOSTRACIÓN" : ""}</span>
        <h1 tabindex="-1">${e(item.title)}</h1>
        <small>${[item.year, item.category].filter(Boolean).map(e).join(" · ")}</small>
        <p>${e(item.description || "Sin descripción disponible.")}</p></div>
      ${favButton(item, "fav-big")}
    </div>
  </article>`;
}

// ---------- Dibujo ----------
function renderShell() {
  app.innerHTML = `<a class="skip" href="#view" data-skip>Saltar al contenido</a>
  <aside class="sidebar">
    <a class="brand" href="#/inicio"><span class="brand-icon">X</span><span>XUPER<span class="brand-light">WEB</span></span></a>
    <nav aria-label="Secciones">${SECTIONS.map(s =>
      `<a class="nav-item" href="#/${s.id}" data-nav="${s.id}"><span class="nav-icon" aria-hidden="true">${s.icon}</span><span>${s.label}</span></a>`).join("")}
    </nav>
    <p class="sidebar-note">Prototipo independiente, no oficial. Sin relación con Xuper TV.</p>
  </aside>
  <div class="content">
    <header class="topbar">
      <a class="brand brand-mobile" href="#/inicio"><span class="brand-icon">X</span><span>XUPER<span class="brand-light">WEB</span></span></a>
      <label class="search"><span aria-hidden="true">⌕</span><span class="sr-only">Buscar por nombre</span>
        <input id="search" type="search" placeholder="Buscar títulos…" aria-keyshortcuts="/" autocomplete="off"></label>
    </header>
    <main id="view" tabindex="-1"></main>
    <footer>XUPER WEB <span>Prototipo independiente · contenido de demostración · solo fuentes autorizadas</span></footer>
  </div>`;

  const search = app.querySelector("#search");
  search.addEventListener("input", () => { state.query = search.value; renderView(); });
  search.addEventListener("keydown", ev => { if (ev.key === "Escape") { search.value = ""; state.query = ""; renderView(); } });
  app.querySelector("#view").addEventListener("click", onViewClick);
  // El enlace de salto solo mueve el foco; no debe cambiar de sección.
  app.querySelector("[data-skip]").addEventListener("click", ev => { ev.preventDefault(); app.querySelector("#view").focus(); });
  // Si una imagen del catálogo no carga, se quita y queda el degradado de respaldo.
  app.querySelector("#view").addEventListener("error", ev => { if (ev.target.tagName === "IMG") ev.target.remove(); }, true);
}

function renderView({ focusHeading = false } = {}) {
  const view = app.querySelector("#view");
  const focusKey = view.contains(document.activeElement) ? document.activeElement.dataset.key : null;
  cleanupPlayer();
  cleanupPlayer = () => {};

  const { route } = state;
  app.querySelectorAll("[data-nav]").forEach(a => {
    const current = a.dataset.nav === route.name && !state.query;
    a.classList.toggle("active", current);
    current ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current");
  });

  let html;
  let item = null;
  if (state.loading) html = `<div class="empty" role="status">Cargando catálogo…</div>`;
  else if (state.query.trim() && route.name !== "ver") html = searchView();
  else if (route.name === "ver") html = playerView(item = state.items.find(x => x.id === route.id));
  else if (route.name === "favoritos") html = favoritesView();
  else if (route.name === "inicio") html = homeView();
  else html = sectionView(SECTIONS.find(s => s.id === route.name));

  const errors = state.errors.map(msg => `<p class="warning" role="alert">${e(msg)}</p>`).join("");
  view.innerHTML = errors + html;
  document.title = `${route.name === "ver" && item ? item.title : (SECTIONS.find(s => s.id === route.name)?.label || "Inicio")} · Xuper Web`;

  if (item) cleanupPlayer = mountPlayer(view.querySelector("#player"), item);

  // Mantener el foco del teclado donde estaba, o llevarlo al título al cambiar de vista.
  const again = focusKey && view.querySelector(`[data-key="${CSS.escape(focusKey)}"]`);
  if (again) again.focus();
  else if (focusHeading) (view.querySelector("h1") || view).focus({ preventScroll: true });
}

function onViewClick(ev) {
  const fav = ev.target.closest("[data-fav]");
  if (fav) { favorites.toggle(fav.dataset.fav); renderView(); return; }
  const cat = ev.target.closest("[data-category]");
  if (cat) { state.category = cat.dataset.category; renderView(); return; }
  if (ev.target.closest("[data-clear-search]")) { clearSearch(); app.querySelector("#search").focus(); return; }
  if (ev.target.closest("[data-back]")) { (history.state?.depth ?? 0) > 0 ? history.back() : (location.hash = "#/inicio"); }
}

function clearSearch() {
  state.query = "";
  app.querySelector("#search").value = "";
  renderView();
}

// Cada entrada del historial guarda su "profundidad" dentro de la app.
// Así "Volver" solo retrocede si la página anterior también es de la app.
let depth = 0;
window.addEventListener("hashchange", () => {
  if (history.state?.depth == null) history.replaceState({ depth: depth + 1 }, "");
  depth = history.state.depth;
  const previous = state.route.name;
  state.route = parseRoute();
  if (state.route.name !== previous) state.category = "Todos";
  if (state.query) { state.query = ""; app.querySelector("#search").value = ""; }
  renderView({ focusHeading: true });
  window.scrollTo({ top: 0 });
});

// Atajo: "/" enfoca la búsqueda (como en muchos sitios de video).
document.addEventListener("keydown", ev => {
  if (ev.key === "/" && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) {
    ev.preventDefault();
    app.querySelector("#search").focus();
  }
});

// ---------- Inicio ----------
history.replaceState({ depth: history.state?.depth ?? 0 }, "");
depth = history.state.depth;
state.route = parseRoute();
renderShell();
renderView();
loadCatalog()
  .then(({ items, errors }) => { state.items = items; state.errors = errors; })
  .catch(() => { state.errors = ["No se pudo cargar el catálogo."]; })
  .finally(() => { state.loading = false; renderView(); });
