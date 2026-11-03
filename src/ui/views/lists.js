// Favoritos y resultados de búsqueda.
import { escapeHtml as e } from "../../app/util.js";
import { cardFor, grid, heading, empty } from "../components.js";
import { spaceTabs, signInPrompt, verifyPrompt } from "./account.js";

// Quita acentos y pasa a minúsculas, para que "accion" encuentre "Acción".
export const fold = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function searchItems(items, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored = [];
  for (const x of items) {
    const title = fold(x.title);
    const haystack = `${title} ${fold(x.categories.join(" "))} ${fold(x.description)} ${x.year || ""}`;
    if (!words.every(w => haystack.includes(w))) continue;
    // Primero los que coinciden en el título, y antes si empiezan igual.
    const score = (title.startsWith(words[0]) ? 0 : 1) + (words.every(w => title.includes(w)) ? 0 : 2);
    scored.push([score, x]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1].title.localeCompare(b[1].title, "es")).map(([, x]) => x);
}

export function renderFavorites(ctx) {
  const head = `<div class="section-heading">${heading("MI ESPACIO", "Favoritos")}${spaceTabs("favoritos")}</div>`;
  const a = ctx.account;
  if (!a.ready) return { title: "Favoritos", html: head + `<div class="empty" role="status"><div class="xp-spinner"></div>Conectando con tu cuenta…</div>` };
  if (!a.signedIn) return { title: "Favoritos", html: head + signInPrompt("guardar tus favoritos") };
  if (a.suspended) return { title: "Favoritos", html: head + empty("Tu cuenta está suspendida.", "No podés guardar ni ver tus datos. Escribinos si creés que es un error.") };
  if (!a.verified) return { title: "Favoritos", html: head + verifyPrompt(ctx) };
  const items = ctx.catalog.all().filter(x => ctx.favorites.has(x.id));
  const missing = ctx.favorites.size - items.length;
  const note = missing > 0 ? `<p class="note">${missing} favorito(s) pertenecen a proveedores desactivados o que no cargaron.</p>` : "";
  return {
    title: "Favoritos",
    html: `${head}${note}
      ${grid(items.map(x => cardFor(x, ctx)).join(""), `<strong>Todavía no tenés favoritos.</strong><span>Tocá el corazón ♡ de cualquier título para guardarlo acá.</span><a class="primary" href="#/inicio">Explorar el catálogo</a>`)}`
  };
}

export function renderSearch(ctx) {
  const q = ctx.state.query.trim();
  const results = searchItems(ctx.catalog.all(), q);
  const groups = [["live", "TV en vivo"], ["movie", "Películas"], ["series", "Series"], ["anime", "Anime"]]
    .map(([kind, label]) => [label, results.filter(x => x.kind === kind)])
    .filter(([, list]) => list.length);
  // Resultados del catálogo central completo (búsqueda en el servidor) que no estén ya arriba.
  const r = ctx.state.remote?.q === q ? ctx.state.remote : null;
  const shown = new Set(results.map(x => x.id));
  const remote = (r?.items || []).filter(x => !shown.has(x.id));
  const remoteHtml = r ? `<h2 class="group-title">En todo el catálogo central ${remote.length ? `<small>${remote.length}${r.hasMore ? "+" : ""}</small>` : ""}</h2>
    ${remote.length ? grid(remote.map(x => cardFor(x, ctx)).join(""), "") : ""}
    ${r.loading ? `<div class="empty" role="status"><div class="xp-spinner"></div>Buscando en el catálogo central…</div>` : ""}
    ${r.error ? `<p class="note" role="status">${e(r.error)}</p>` : ""}
    ${!r.loading && !r.error && !remote.length ? `<p class="note">No hay más resultados en el catálogo central.</p>` : ""}
    ${r.hasMore && !r.loading ? `<div class="more"><button type="button" class="secondary" data-action="remote-more" data-key="remote-more">Ver más resultados</button></div>` : ""}` : "";
  const body = (groups.length
    ? groups.map(([label, list]) => `<h2 class="group-title">${e(label)} <small>${list.length}</small></h2>${grid(list.slice(0, 60).map(x => cardFor(x, ctx)).join(""), "")}`).join("")
    : remote.length || r?.loading ? "" : empty(`No encontramos nada con “${q}”.`, "Probá con otro nombre, categoría o año.")) + remoteHtml;
  return {
    title: `Buscar: ${q}`,
    html: `<div class="section-heading">${heading(`${results.length} RESULTADOS`, `“${q}”`)}
      <button type="button" class="filter" data-action="clear-search" data-key="clear-search">Borrar búsqueda ✕</button></div>${body}`
  };
}
