// Modelo del catálogo: la forma única que tiene cada título en la app,
// venga del proveedor que venga.
//
// Elemento:
//   id ("<proveedor>:<id>"), rawId, providerId, providerName, kind ("live" | "movie" | "series"),
//   title, categories[], year, description, poster, backdrop, logo, color, featured, rating,
//   source: { url, type } | { lazy: true } | null      (lazy = el proveedor la busca al reproducir)
//   seasons: [{ number, title, episodes: [{ id, number, title, description, still, duration, source }] }] | null
//   lazySeasons (el proveedor las carga al abrir el detalle), tvgId, channelNumber, isDemo
export const KINDS = {
  live: { label: "TV en vivo", mark: "EN VIVO" },
  movie: { label: "Película", mark: "PELÍCULA" },
  series: { label: "Serie", mark: "SERIE" }
};

const COLORS = ["poster-a", "poster-b", "poster-c", "poster-d", "poster-e", "poster-f"];

const text = v => (v == null ? "" : String(v).trim());
const yearOf = v => {
  const n = parseInt(v, 10);
  return n > 1800 && n < 2200 ? n : null;
};

function normalizeSource(src) {
  if (!src) return null;
  if (src.lazy) return { lazy: true };
  const url = text(src.url);
  return url ? { url, type: text(src.type) } : null;
}

// Color estable a partir del título, para los títulos sin imagen.
function colorFor(title) {
  let h = 0;
  for (const c of title) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function normalizeEpisode(raw, itemId, seasonNumber, index) {
  const rawId = text(raw.id) || `s${seasonNumber}e${raw.number ?? index + 1}`;
  return {
    id: `${itemId}/${rawId}`,
    rawId,
    number: Number(raw.number) || index + 1,
    title: text(raw.title) || `Episodio ${Number(raw.number) || index + 1}`,
    description: text(raw.description),
    still: text(raw.still),
    duration: Number(raw.duration) || 0,
    source: normalizeSource(raw.source)
  };
}

export function normalizeSeasons(seasons, itemId) {
  if (!Array.isArray(seasons)) return null;
  return seasons
    .map(s => {
      const number = Number(s.number) || 0;
      return {
        number,
        title: text(s.title) || (number ? `Temporada ${number}` : "Especiales"),
        episodes: (s.episodes || []).map((e, i) => normalizeEpisode(e, itemId, number, i)).sort((a, b) => a.number - b.number)
      };
    })
    .filter(s => s.episodes.length)
    .sort((a, b) => (a.number || 999) - (b.number || 999));
}

// Convierte un elemento crudo de un proveedor en un elemento del catálogo, o null si es inválido.
export function normalizeItem(raw, instance, provider) {
  if (!raw || raw.id == null || !text(raw.title) || !KINDS[raw.kind]) return null;
  const id = `${instance.id}:${raw.id}`;
  const categories = [].concat(raw.categories || raw.category || []).map(text).filter(Boolean);
  const title = text(raw.title);
  return {
    id,
    rawId: String(raw.id),
    providerId: instance.id,
    providerName: instance.label || provider.name,
    kind: raw.kind,
    title,
    categories: categories.length ? [...new Set(categories)] : ["Sin categoría"],
    year: yearOf(raw.year),
    description: text(raw.description),
    poster: text(raw.poster || raw.image),
    backdrop: text(raw.backdrop),
    logo: text(raw.logo),
    color: raw.color || colorFor(title),
    featured: Boolean(raw.featured),
    rating: Number(raw.rating) || null,
    source: normalizeSource(raw.source),
    seasons: normalizeSeasons(raw.seasons, id),
    lazySeasons: Boolean(raw.lazySeasons),
    tvgId: text(raw.tvgId),
    channelNumber: Number(raw.channelNumber) || null,
    extra: raw.extra || null, // datos propios del proveedor (p. ej. id interno para pedir la fuente)
    isDemo: Boolean(provider.isDemo)
  };
}

// Busca un episodio por id dentro de un elemento con temporadas.
export function findEpisode(item, episodeId) {
  for (const season of item?.seasons || []) {
    const index = season.episodes.findIndex(e => e.id === episodeId);
    if (index >= 0) return { season, episode: season.episodes[index], index };
  }
  return null;
}

// Episodio siguiente (en la misma temporada o la próxima), o null.
export function nextEpisode(item, episodeId) {
  const seasons = item?.seasons || [];
  for (let s = 0; s < seasons.length; s++) {
    const i = seasons[s].episodes.findIndex(e => e.id === episodeId);
    if (i >= 0) return seasons[s].episodes[i + 1] || seasons[s + 1]?.episodes[0] || null;
  }
  return null;
}
