// Internet Archive en el servidor: el mismo origen que el adaptador del navegador
// (src/providers/internet-archive.js, que sigue igual), pero paginado e importado al catálogo central.
// API pública y gratuita, sin clave: https://archive.org/developers/
import { genresFrom, stripHtml, pickVideoFile } from "../../../src/providers/internet-archive.js";
import { ProviderError, readJsonBody } from "./contract.js";

const SEARCH = "https://archive.org/advancedsearch.php";
const META = "https://archive.org/metadata/";
const DEFAULT_QUERY = 'collection:(feature_films) AND mediatype:(movies) AND format:(MPEG4 OR "h.264") AND NOT subject:(sex OR nudity OR exploitation)';

export default {
  id: "archive",
  name: "Internet Archive",
  description: "Películas de dominio público o con licencia abierta de archive.org. Sin credenciales.",
  kinds: ["movie"],
  fields: [
    { key: "query", label: "Búsqueda en archive.org", type: "textarea", help: "Sintaxis de búsqueda avanzada de archive.org. Vacío = largometrajes con video MP4." },
    { key: "rows", label: "Títulos por página", type: "number", help: "Entre 10 y 100." },
    { key: "maxPages", label: "Páginas máximas", type: "number", help: "Tope de páginas por importación (cada página = una consulta)." }
  ],
  validate(config) {
    const rows = Number(config.rows || 50);
    return rows >= 10 && rows <= 100 ? [] : ["\"Títulos por página\" tiene que estar entre 10 y 100."];
  },
  supportsIncremental: () => false,

  async test(ctx) {
    const page = await this.listPage(ctx, { kind: "movie", cursor: null });
    return { message: `Conexión correcta: ${page.items.length} título(s) en la primera página.`, sample: page.items.slice(0, 3).map(i => i.title) };
  },

  async listPage(ctx, { cursor }) {
    const rows = Math.min(100, Math.max(10, parseInt(ctx.config.rows, 10) || 50));
    const maxPages = Math.min(1000, Math.max(1, parseInt(ctx.config.maxPages, 10) || 20));
    const page = cursor?.page || 1;
    const url = new URL(SEARCH);
    url.searchParams.set("q", ctx.config.query?.trim() || DEFAULT_QUERY);
    for (const f of ["identifier", "title", "year", "description", "subject"]) url.searchParams.append("fl[]", f);
    url.searchParams.set("rows", rows);
    url.searchParams.set("page", page);
    url.searchParams.set("sort[]", "downloads desc");
    url.searchParams.set("output", "json");
    const data = await readJsonBody(await ctx.fetch(url.toString()));
    const docs = data?.response?.docs;
    if (!Array.isArray(docs)) throw new ProviderError("Internet Archive devolvió una respuesta sin lista de resultados.");
    const total = Number(data.response.numFound) || 0;
    const items = docs.map(d => ({
      id: d.identifier,
      kind: "movie",
      title: [].concat(d.title || d.identifier)[0],
      year: d.year,
      description: stripHtml(d.description),
      categories: genresFrom(d.subject),
      poster: `https://archive.org/services/img/${encodeURIComponent(d.identifier)}`,
      playback: { lazy: true },
      data: { id: d.identifier }
    }));
    const more = docs.length === rows && page * rows < total && page < maxPages;
    return { items, next: more ? { page: page + 1 } : null };
  },

  async resolve(ctx, { source }) {
    const id = source.data?.id || source.externalId;
    const meta = await readJsonBody(await ctx.fetch(META + encodeURIComponent(id)));
    const file = pickVideoFile(meta.files);
    if (!file) throw new ProviderError("Este título de Internet Archive no tiene un archivo de video compatible con el navegador.");
    return {
      url: `https://archive.org/download/${encodeURIComponent(id)}/${file.name.split("/").map(encodeURIComponent).join("/")}`,
      type: file.format === "Ogg Video" ? "video/ogg" : "video/mp4"
    };
  }
};
