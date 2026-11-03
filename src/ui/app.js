// Controlador de la interfaz: arma el marco (menú, buscador), elige la pantalla según la
// ruta, atiende los clics y mantiene el foco del teclado en su lugar.
import { escapeHtml as e } from "../app/util.js";
import { SECTIONS, parseRoute } from "../app/router.js";
import { settings } from "../app/settings.js";
import { progress } from "../app/progress.js";
import { createFavorites } from "../app/favorites.js";
import { cacheClear, cacheSet } from "../app/cache.js";
import { catalog } from "../catalog/store.js";
import * as enrich from "../catalog/enrich.js";
import { addInstance, updateInstance, removeInstance, getInstance, validateConfig } from "../providers/registry.js";
import * as home from "./views/home.js";
import * as browse from "./views/browse.js";
import * as live from "./views/live.js";
import * as detail from "./views/detail.js";
import * as watch from "./views/watch.js";
import * as settingsView from "./views/settings.js";
import { renderFavorites, renderSearch } from "./views/lists.js";

const defaultFilters = () => ({ category: "Todos", provider: "todos", sort: "destacados", limit: 0 });

export function startApp(app, extensions = {}) {
  const favorites = createFavorites();
  const state = { route: parseRoute(location.hash), query: "", filters: defaultFilters(), season: 0, confirm: null, restartRequested: false, tmdbStatus: "" };
  const ctx = { catalog, favorites, progress, settings, state, ...extensions };
  let cleanup = () => {};
  let depth = 0;
  let renderQueued = false;

  // ---------- marco ----------
  const brand = `<span class="brand-icon">X</span><span class="brand-text">XUPER<span class="brand-light">WEB</span></span>`;
  app.innerHTML = `<a class="skip" href="#view" data-skip>Saltar al contenido</a>
  <aside class="sidebar">
    <a class="brand" href="#/inicio" aria-label="Xuper Web, inicio">${brand}</a>
    <nav aria-label="Secciones">${SECTIONS.map(s =>
      `<a class="nav-item" href="#/${s.id}" data-nav="${s.id}"><span class="nav-icon" aria-hidden="true">${s.icon}</span><span class="nav-label">${s.label}</span></a>`).join("")}
    </nav>
    <p class="sidebar-note">Prototipo independiente, no oficial. Sin relación con Xuper TV.</p>
  </aside>
  <div class="content">
    <header class="topbar">
      <a class="brand brand-mobile" href="#/inicio" aria-label="Xuper Web, inicio">${brand}</a>
      <label class="search"><span aria-hidden="true">⌕</span><span class="sr-only">Buscar por nombre</span>
        <input id="search" type="search" placeholder="Buscar películas, series y canales…" autocomplete="off" aria-keyshortcuts="/"></label>
    </header>
    <main id="view" tabindex="-1"></main>
    <footer>XUPER WEB <span>Prototipo independiente · solo fuentes autorizadas · metadatos de TMDb cuando está configurado</span></footer>
  </div>`;
  const view = app.querySelector("#view");
  const search = app.querySelector("#search");

  // ---------- dibujo ----------
  function pickView() {
    const { route } = state;
    if (state.query.trim()) return renderSearch(ctx);
    if (route.name === "inicio") return home.render(ctx);
    if (route.name === "favoritos") return renderFavorites(ctx);
    if (route.name === "ajustes") return settingsView.render(ctx);
    if (route.name === "titulo") return detail.render(ctx, route);
    if (route.name === "ver") return watch.render(ctx, route);
    const section = SECTIONS.find(s => s.id === route.name);
    return section.kind === "live" ? live.render(ctx, section) : browse.render(ctx, section);
  }

  function render({ focusHeading = false } = {}) {
    const focusKey = view.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    cleanup();
    cleanup = () => {};

    app.querySelectorAll("[data-nav]").forEach(a => {
      const current = a.dataset.nav === state.route.name && !state.query;
      a.classList.toggle("active", current);
      current ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current");
    });

    const loadingFirst = catalog.loading && !catalog.all().length;
    const result = loadingFirst && state.route.name !== "ajustes"
      ? { title: "Cargando", html: `<div class="empty" role="status"><div class="xp-spinner"></div>Cargando catálogo…</div>` }
      : pickView();
    view.innerHTML = result.html;
    document.title = `${result.title} · Xuper Web`;
    if (result.mount) cleanup = result.mount(view, ctx) || (() => {});

    const again = focusKey && view.querySelector(`[data-key="${CSS.escape(focusKey)}"]`);
    if (again) again.focus({ preventScroll: true });
    else if (focusHeading) (view.querySelector("h1") || view).focus({ preventScroll: true });
  }
  ctx.render = render;

  // Redibuja como mucho una vez por cuadro. En la pantalla de reproducción no se redibuja
  // por cambios de catálogo, para no cortar el video.
  function queueRender() {
    if (renderQueued || (view.querySelector(".xp") && !state.query)) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; render(); });
  }
  catalog.subscribe(queueRender);
  ctx.queueRender = queueRender;

  // ---------- TMDb ----------
  ctx.enrichment = enrich.enrichment;
  ctx.enrichSeason = enrich.enrichSeason;
  ctx.testTmdb = async () => {
    const result = await enrich.checkKey();
    enrich.enrichInBackground(catalog.all(), queueRender);
    return result;
  };
  ctx.requestEnrichment = item => enrich.request(item, done => {
    if (state.route.name === "titulo" && state.route.id === done.id && !state.query) render();
  });

  // ---------- acciones ----------
  function toggleFavorite(id) {
    const on = favorites.toggle(id);
    if (["favoritos", "inicio"].includes(state.route.name) && !state.query) { render(); return; }
    // En el resto de las pantallas se actualizan los botones en su lugar (sin cortar el video).
    app.querySelectorAll(`[data-action="fav"][data-id="${CSS.escape(id)}"]`).forEach(b => {
      b.classList.toggle("selected", on);
      b.textContent = on ? "♥" : "♡";
      b.setAttribute("aria-pressed", on);
      b.setAttribute("aria-label", `${on ? "Quitar de" : "Agregar a"} favoritos: ${b.getAttribute("aria-label").split(": ").slice(1).join(": ")}`);
    });
  }

  async function clearData(what) {
    if (what === "cache" || what === "all") await cacheClear();
    if (what === "progress" || what === "all") progress.clear();
    if (what === "favorites" || what === "all") favorites.clear();
    if (what === "all") { settings.reset(); location.hash = "#/inicio"; location.reload(); return; }
    if (what === "cache") await catalog.load({ force: true });
    render();
  }

  const clickActions = {
    fav: el => toggleFavorite(el.dataset.id),
    filter: el => { state.filters[el.dataset.name] = el.dataset.value; state.filters.limit = 0; render(); },
    more: () => { state.filters.limit = (state.filters.limit || 60) + 60; render(); },
    "clear-search": () => { search.value = ""; state.query = ""; render({ focusHeading: true }); search.focus(); },
    back: (el, ev) => { ev.preventDefault(); (history.state?.depth ?? 0) > 0 ? history.back() : (location.hash = "#/inicio"); },
    "scroll-row": el => {
      const track = el.closest(".row").querySelector(".row-track");
      track.scrollBy({ left: Number(el.dataset.dir) * track.clientWidth * 0.85, behavior: "smooth" });
    },
    season: el => { state.season = Number(el.dataset.index); render(); },
    "play-restart": () => { state.restartRequested = true; },
    // En PC el canal se reproduce en la vista previa; en el celular abre la pantalla de reproducción.
    "live-select": (el, ev) => {
      if (window.matchMedia("(max-width: 720px)").matches) return;
      ev.preventDefault();
      state.liveSelected = el.dataset.id;
      render();
    },
    "provider-refresh": async el => { await catalog.load({ only: el.dataset.id }); render(); },
    "provider-remove": el => {
      const key = `remove:${el.dataset.id}`;
      if (state.confirm !== key) { state.confirm = key; render(); return; }
      state.confirm = null;
      catalog.clearCache(el.dataset.id);
      removeInstance(el.dataset.id);
      catalog.load().then(render);
    },
    "provider-add": () => {
      const type = app.querySelector("#add-type")?.value;
      if (!type) return;
      const instance = addInstance(type);
      render();
      view.querySelector(`[data-form="provider"][data-id="${CSS.escape(instance.id)}"] input:not([type=hidden])`)?.focus();
    },
    "data-clear": el => {
      const what = el.dataset.what;
      if (state.confirm !== what) { state.confirm = what; render(); return; }
      state.confirm = null;
      clearData(what);
    },
    "tmdb-remove": () => { settings.set("tmdbKey", ""); state.tmdbStatus = "Clave quitada."; render(); }
  };

  app.addEventListener("click", ev => {
    const el = ev.target.closest("[data-action]");
    const action = el?.dataset.action;
    // Cualquier otro clic cancela una confirmación pendiente ("¿Seguro? Tocá de nuevo").
    if (state.confirm && !["provider-remove", "data-clear"].includes(action)) { state.confirm = null; if (state.route.name === "ajustes") render(); }
    if (el?.dataset.skip !== undefined && ev.target.closest("[data-skip]")) { ev.preventDefault(); view.focus(); return; }
    if (action && clickActions[action] && el.type !== "checkbox" && el.tagName !== "SELECT" && el.type !== "file") clickActions[action](el, ev);
  });

  app.addEventListener("change", async ev => {
    const el = ev.target;
    if (el.dataset.action === "filter-select") { state.filters[el.dataset.name] = el.value; state.filters.limit = 0; render(); return; }
    if (el.dataset.setting) { settings.set(el.dataset.setting, el.type === "checkbox" ? el.checked : el.value); return; }
    if (el.dataset.action === "provider-toggle") {
      updateInstance(el.dataset.id, { enabled: el.checked });
      render();
      await catalog.load();
      render();
      return;
    }
    if (el.dataset.action === "provider-file" && el.files?.[0]) {
      const file = el.files[0];
      const content = await file.text();
      await cacheSet(`archivo:${el.dataset.id}`, content);
      updateInstance(el.dataset.id, { config: { [el.dataset.field]: `${file.name} (${Math.round(file.size / 1024)} kB, ${new Date().toLocaleDateString("es")})` } });
      await catalog.load({ only: el.dataset.id });
      render();
    }
  });

  app.addEventListener("submit", async ev => {
    const form = ev.target;
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    if (form.dataset.form === "provider") {
      const id = form.dataset.id;
      const { __label, ...config } = data;
      const current = getInstance(id);
      const updated = updateInstance(id, { label: __label?.trim() || current.label, config });
      if (!validateConfig(updated).length && !updated.enabled) updateInstance(id, { enabled: true });
      render();
      await catalog.load({ only: id });
      render();
    } else if (form.dataset.form === "tmdb") {
      settings.set("tmdbKey", (data.tmdbKey || "").trim());
      settings.set("language", data.language);
      state.tmdbStatus = data.tmdbKey ? "Probando la clave…" : "Sin clave: no se completarán imágenes ni información.";
      render();
      if (data.tmdbKey && ctx.testTmdb) {
        state.tmdbStatus = await ctx.testTmdb();
        render();
      } else if (data.tmdbKey) {
        state.tmdbStatus = "Clave guardada.";
        render();
      }
    }
  });

  // ---------- búsqueda ----------
  let searchTimer = 0;
  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = search.value; render(); }, 120);
  });
  search.addEventListener("keydown", ev => {
    if (ev.key === "Escape") { search.value = ""; state.query = ""; render(); }
  });
  document.addEventListener("keydown", ev => {
    if (ev.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      ev.preventDefault();
      search.focus();
    } else if (ev.key.startsWith("Arrow") && !ev.altKey && !ev.ctrlKey && document.activeElement.matches(SPATIAL_FROM)) {
      if (moveFocus(ev.key)) ev.preventDefault();
    }
  });

  // Navegación con flechas entre tarjetas, como con el control remoto de una app de TV:
  // busca el elemento más cercano en la dirección de la flecha.
  const SPATIAL_FROM = ".poster, .channel-logo, .wide-thumb, .ch-link, .episode-link, .nav-item, .cat";
  const SPATIAL_TO = SPATIAL_FROM + ", #view .primary, #view .secondary, #view .filter, #view .see-all";
  function moveFocus(key) {
    const current = document.activeElement.getBoundingClientRect();
    const cx = current.left + current.width / 2, cy = current.top + current.height / 2;
    const horizontal = key === "ArrowLeft" || key === "ArrowRight";
    let best = null, bestScore = Infinity;
    for (const el of app.querySelectorAll(SPATIAL_TO)) {
      if (el === document.activeElement || !el.offsetParent) continue;
      const r = el.getBoundingClientRect();
      const dx = r.left + r.width / 2 - cx, dy = r.top + r.height / 2 - cy;
      const along = { ArrowRight: dx, ArrowLeft: -dx, ArrowDown: dy, ArrowUp: -dy }[key];
      if (along <= 4) continue;
      const score = along + (horizontal ? Math.abs(dy) : Math.abs(dx)) * 3;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (!best) return false;
    best.focus({ preventScroll: true });
    best.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    return true;
  }

  // ---------- rutas ----------
  // Cada entrada del historial guarda su "profundidad" dentro de la app,
  // así "Volver" solo retrocede si la página anterior también es de la app.
  history.replaceState({ depth: history.state?.depth ?? 0 }, "");
  depth = history.state.depth;
  window.addEventListener("hashchange", () => {
    if (history.state?.depth == null) history.replaceState({ depth: depth + 1 }, "");
    depth = history.state.depth;
    const previous = state.route;
    state.route = parseRoute(location.hash);
    if (state.route.name !== previous.name || state.route.id !== previous.id) {
      state.filters = defaultFilters();
      if (state.route.id !== previous.id) state.season = 0;
    }
    state.confirm = null;
    if (state.query) { state.query = ""; search.value = ""; }
    render({ focusHeading: state.route.name !== "ver" });
    window.scrollTo({ top: 0 });
  });

  // Si una imagen no carga, se quita y queda el degradado de respaldo.
  view.addEventListener("error", ev => { if (ev.target.tagName === "IMG") ev.target.remove(); }, true);

  render();
  catalog.load().then(() => {
    render();
    enrich.enrichInBackground(catalog.all(), queueRender);
  });
  return ctx;
}
