// Internet Archive (archive.org): películas de dominio público o con licencia abierta.
// API pública y gratuita, sin clave: https://archive.org/developers/
//  - Búsqueda: advancedsearch.php
//  - Archivos de cada título: /metadata/<identificador>
const SEARCH = "https://archive.org/advancedsearch.php";
const META = "https://archive.org/metadata/";

const DEFAULT_QUERY = 'collection:(feature_films) AND mediatype:(movies) AND format:(MPEG4 OR "h.264") AND NOT subject:(sex OR nudity OR exploitation)';

// Géneros en inglés de archive.org → categorías en español.
const GENRES = [
  [/comed/i, "Comedia"], [/drama|melodrama/i, "Drama"], [/horror|terror/i, "Terror"], [/western/i, "Western"],
  [/sci-?fi|science fiction/i, "Ciencia ficción"], [/crime|gangster|detective/i, "Policial"], [/noir/i, "Cine negro"],
  [/romance|romantic/i, "Romance"], [/adventure/i, "Aventura"], [/myster/i, "Misterio"], [/thriller|suspense/i, "Suspenso"],
  [/war\b|world war/i, "Bélica"], [/animat|cartoon/i, "Animación"], [/documentar/i, "Documental"], [/musical|music/i, "Musical"],
  [/silent/i, "Cine mudo"], [/action/i, "Acción"], [/fantasy/i, "Fantasía"], [/family|children/i, "Familiar"]
];

export function genresFrom(subjects) {
  const text = [].concat(subjects || []).join(" | ");
  const found = GENRES.filter(([re]) => re.test(text)).map(([, name]) => name);
  return found.length ? found.slice(0, 3) : ["Clásicos"];
}

export function stripHtml(s) {
  return String([].concat(s || "")[0] || "")
    .replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim().slice(0, 500);
}

// Elige el mejor archivo de video que un navegador puede reproducir.
const FORMAT_PRIORITY = ["h.264 HD", "h.264", "MPEG4", "512Kb MPEG4", "h.264 IA", "Ogg Video"];
export function pickVideoFile(files) {
  const candidates = (files || []).filter(f => FORMAT_PRIORITY.includes(f.format) || /\.mp4$/i.test(f.name));
  candidates.sort((a, b) => {
    const pa = FORMAT_PRIORITY.indexOf(a.format), pb = FORMAT_PRIORITY.indexOf(b.format);
    return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb);
  });
  return candidates[0] || null;
}

async function getJson(url, what) {
  let res;
  try { res = await fetch(url); } catch { throw new Error(`No se pudo conectar con Internet Archive (${what}).`); }
  if (!res.ok) throw new Error(`Internet Archive respondió con un error (${res.status}).`);
  return res.json();
}

export default {
  type: "archive",
  name: "Internet Archive",
  description: "Películas clásicas de dominio público o con licencia abierta, alojadas en archive.org. No necesita configuración.",
  origin: "archive.org (API pública)",
  license: "Dominio público o licencias abiertas; verificá cada título en archive.org",
  kinds: ["movie"],
  multiple: true,
  ttl: 24 * 3600e3,
  defaults: { query: DEFAULT_QUERY, rows: "150", sort: "downloads desc" },
  fields: [
    { key: "query", label: "Búsqueda en archive.org", type: "textarea", help: "Usa la sintaxis de búsqueda avanzada de archive.org. Por defecto: largometrajes con video MP4." },
    { key: "rows", label: "Cantidad máxima de títulos", type: "number", help: "Entre 20 y 500." },
    { key: "sort", label: "Orden", type: "select", options: [["downloads desc", "Más vistos"], ["year asc", "Más antiguos"], ["year desc", "Más recientes"], ["titleSorter asc", "Título A-Z"]] }
  ],
  async load(config) {
    const rows = Math.min(500, Math.max(20, parseInt(config.rows, 10) || 150));
    const url = new URL(SEARCH);
    url.searchParams.set("q", config.query || DEFAULT_QUERY);
    for (const f of ["identifier", "title", "year", "description", "subject"]) url.searchParams.append("fl[]", f);
    url.searchParams.set("rows", rows);
    url.searchParams.set("sort[]", config.sort || "downloads desc");
    url.searchParams.set("output", "json");
    const data = await getJson(url, "búsqueda");
    const docs = data?.response?.docs || [];
    return {
      items: docs.map(d => ({
        id: d.identifier,
        kind: "movie",
        title: [].concat(d.title || d.identifier)[0],
        year: d.year,
        description: stripHtml(d.description),
        categories: genresFrom(d.subject),
        poster: `https://archive.org/services/img/${encodeURIComponent(d.identifier)}`,
        source: { lazy: true }
      }))
    };
  },
  // La dirección del archivo se busca recién al reproducir (una consulta por título).
  async resolveSource(item) {
    const meta = await getJson(META + encodeURIComponent(item.rawId), "archivos");
    const file = pickVideoFile(meta.files);
    if (!file) throw new Error("Este título de Internet Archive no tiene un archivo de video compatible con el navegador.");
    return {
      url: `https://archive.org/download/${encodeURIComponent(item.rawId)}/${file.name.split("/").map(encodeURIComponent).join("/")}`,
      type: file.format === "Ogg Video" ? "video/ogg" : "video/mp4"
    };
  }
};
