// Películas y Series: grilla con filtros por categoría, proveedor y orden.
import { cardFor, chips, select, grid, heading, empty } from "../components.js";

const SORTS = [["destacados", "Destacados"], ["recientes", "Más recientes"], ["antiguos", "Más antiguos"], ["titulo", "Título A-Z"], ["puntaje", "Mejor puntuados"]];
const MAX_CHIPS = 10;
const PAGE = 60;

export function sortItems(list, sort) {
  const copy = [...list];
  const byTitle = (a, b) => a.title.localeCompare(b.title, "es");
  if (sort === "recientes") return copy.sort((a, b) => (b.year || 0) - (a.year || 0) || byTitle(a, b));
  if (sort === "antiguos") return copy.sort((a, b) => (a.year || 9999) - (b.year || 9999) || byTitle(a, b));
  if (sort === "titulo") return copy.sort(byTitle);
  if (sort === "puntaje") return copy.sort((a, b) => (b.rating || 0) - (a.rating || 0) || byTitle(a, b));
  return copy.sort((a, b) => Number(b.featured) - Number(a.featured));
}

export function render(ctx, section) {
  const f = ctx.state.filters;
  const all = ctx.catalog.all().filter(x => x.kind === section.kind);
  const categories = ctx.catalog.categories(section.kind);
  const providers = [...new Map(all.map(x => [x.providerId, x.providerName])).entries()];
  if (f.category !== "Todos" && !categories.includes(f.category)) f.category = "Todos";
  if (f.provider !== "todos" && !providers.some(([id]) => id === f.provider)) f.provider = "todos";

  let list = all;
  if (f.category !== "Todos") list = list.filter(x => x.categories.includes(f.category));
  if (f.provider !== "todos") list = list.filter(x => x.providerId === f.provider);
  list = sortItems(list, f.sort);
  const shown = list.slice(0, f.limit || PAGE);

  const chipCats = categories.slice(0, MAX_CHIPS);
  if (f.category !== "Todos" && !chipCats.includes(f.category)) chipCats.push(f.category);
  const tools = all.length > 1 ? `<div class="toolbar">
      ${chips("category", [["Todos", "Todos"], ...chipCats.map(c => [c, c])], f.category, "Filtrar por categoría")}
      <div class="toolbar-selects">
        ${categories.length > MAX_CHIPS ? select("category", [["Todos", "Todas las categorías"], ...categories.map(c => [c, c])], f.category, "Categoría") : ""}
        ${providers.length > 1 ? select("provider", [["todos", "Todos los proveedores"], ...providers], f.provider, "Proveedor") : ""}
        ${section.kind === "live" ? "" : select("sort", SORTS, f.sort, "Ordenar")}
      </div>
    </div>` : "";

  const more = list.length > shown.length
    ? `<div class="more"><button type="button" class="secondary" data-action="more" data-key="more">Mostrar más (${list.length - shown.length} restantes)</button></div>` : "";

  const emptyHtml = all.length
    ? empty("No hay títulos con estos filtros.", "Probá con otra categoría o proveedor.")
    : empty(`Todavía no hay ${section.label.toLowerCase()}.`, "Activá o configurá un proveedor en Ajustes.", `<a class="primary" href="#/ajustes">Ir a Ajustes</a>`);

  return {
    title: section.label,
    html: `<div class="section-heading">${heading(`${all.length} TÍTULOS`, section.label)}</div>${tools}
      ${shown.length ? grid(shown.map(x => cardFor(x, ctx)).join(""), "") : emptyHtml}${more}`
  };
}
