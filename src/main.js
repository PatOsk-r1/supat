import "./style.css";
import { catalog, liveChannels, categories } from "./data.js";

const state = { page: "Inicio", query: "", category: "Todos", favorites: new Set(), active: null };
const app = document.querySelector("#app");
const nav = ["Inicio", "TV en vivo", "Películas", "Series", "Favoritos"];
const all = [...catalog, ...liveChannels];

function card(item) {
  const fav = state.favorites.has(item.id);
  return `<article class="card">
    <button class="poster ${item.color}" data-open="${item.id}" aria-label="Abrir ${item.title}">
      <span class="poster-mark">${item.type === "TV en vivo" ? "EN VIVO" : item.type.toUpperCase()}</span>
      <span class="poster-title">${item.title}</span>
    </button>
    <div class="card-meta"><div><strong>${item.title}</strong><small>${item.year || "Demostración"} · ${item.category}</small></div>
      <button class="fav ${fav ? "selected" : ""}" data-fav="${item.id}" title="Favorito">${fav ? "♥" : "♡"}</button>
    </div>
  </article>`;
}
function visibleItems() {
  let items = state.page === "TV en vivo" ? liveChannels :
    state.page === "Películas" ? catalog.filter(x => x.type === "Película") :
    state.page === "Series" ? catalog.filter(x => x.type === "Serie") :
    state.page === "Favoritos" ? all.filter(x => state.favorites.has(x.id)) : catalog;
  if (state.category !== "Todos" && state.page !== "TV en vivo") items = items.filter(x => x.category === state.category);
  if (state.query) items = items.filter(x => (x.title + " " + x.category + " " + x.description).toLowerCase().includes(state.query.toLowerCase()));
  return items;
}
function render() {
  app.innerHTML = `<header class="topbar">
    <a class="brand" href="#" data-page="Inicio"><span class="brand-icon">X</span> XUPER<span class="brand-light">WEB</span></a>
    <nav>${nav.map(n => `<button class="nav-item ${state.page === n ? "active" : ""}" data-page="${n}">${n}</button>`).join("")}</nav>
    <label class="search"><span>⌕</span><input id="search" placeholder="Buscar títulos..." value="${escapeHtml(state.query)}" /></label>
  </header>
  <main>
    <section class="hero">
      <div class="hero-content"><span class="eyebrow">TU ESPACIO DE ENTRETENIMIENTO</span>
        <h1>Todo lo que<br>querés ver.</h1>
        <p>Un prototipo web adaptable. El catálogo actual contiene contenido ficticio para probar el diseño.</p>
        <button class="primary" data-page="Películas">Explorar catálogo <span>→</span></button>
      </div><div class="hero-art"><div class="orb orb1"></div><div class="orb orb2"></div><div class="hero-x">X</div><div class="hero-caption">DESCUBRÍ ALGO NUEVO</div></div>
    </section>
    <section class="catalog-section">
      <div class="section-heading"><div><span class="eyebrow">CATÁLOGO</span><h2>${state.page}</h2></div>
        <div class="filters">${categories.map(c => `<button class="filter ${state.category === c ? "chosen" : ""}" data-category="${c}">${c}</button>`).join("")}</div>
      </div>
      <div class="grid">${visibleItems().map(card).join("") || `<p class="empty">No encontramos contenido con esos filtros.</p>`}</div>
      <p class="notice">Prototipo de interfaz · contenido de demostración · sin conexión a servicios de Xuper TV.</p>
    </section>
  </main>
  ${state.active ? modal(state.active) : ""}
  <footer> XUPER WEB <span>Prototipo independiente · Fuentes de contenido autorizadas</span></footer>`;
  document.querySelector("#search").addEventListener("input", e => { state.query = e.target.value; const p=e.target.selectionStart; render(); const i=document.querySelector("#search"); i.focus(); i.setSelectionRange(p,p); });
  app.querySelectorAll("[data-page]").forEach(b => b.addEventListener("click", () => { state.page=b.dataset.page; state.category="Todos"; render(); window.scrollTo({top:0,behavior:"smooth"}); }));
  app.querySelectorAll("[data-category]").forEach(b => b.addEventListener("click", () => { state.category=b.dataset.category; render(); }));
  app.querySelectorAll("[data-fav]").forEach(b => b.addEventListener("click", () => { const id=Number(b.dataset.fav); state.favorites.has(id)?state.favorites.delete(id):state.favorites.add(id); render(); }));
  app.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", () => { state.active=all.find(x=>x.id===Number(b.dataset.open)); render(); }));
  app.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => { state.active=null; render(); }));
}
function modal(item) {
  const source = item.source;
  return `<div class="overlay" data-close="1"><section class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(item.title)}" onclick="event.stopPropagation()">
    <button class="close" data-close="1">×</button><span class="eyebrow">${item.type}</span><h2>${item.title}</h2><p>${item.description || "Contenido de demostración."}</p>
    ${source ? `<video controls playsinline src="${escapeHtml(source)}"></video>` : `<div class="player-placeholder">▶<span>Reproductor preparado</span><small>Agregá una URL de video autorizada en src/data.js para probar reproducción.</small></div>`}
  </section></div>`;
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
render();
