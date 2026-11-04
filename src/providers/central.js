// Catálogo central de Supat: el catálogo compartido que arma el servidor (Cloudflare Worker + D1)
// con los proveedores que administra el propietario. Para el resto de la app es un proveedor más.
// Necesita sesión con el correo verificado. Las fuentes las resuelve el servidor al reproducir.
import { api, apiAvailable, ApiError } from "../app/api.js";
import { getFirebase } from "../app/firebase.js";

const PAGE_SIZE = 200;
const MAX_PAGES_PER_KIND = 5; // hasta 1000 títulos por tipo en la carga inicial; el resto, con la búsqueda

// Título del servidor → elemento crudo del contrato de proveedores (src/catalog/model.js).
export function toRawItem(t) {
  return {
    id: String(t.id),
    kind: t.kind,
    title: t.title,
    year: t.year,
    description: t.description,
    poster: t.poster,
    backdrop: t.backdrop,
    categories: t.categories,
    rating: t.rating,
    externalIds: { tmdb: t.externalIds?.tmdb, imdb: t.externalIds?.imdb },
    lazySeasons: Boolean(t.hasEpisodes),
    source: t.hasEpisodes ? null : { lazy: true }
  };
}

async function ensureSession() {
  const { auth } = await getFirebase();
  await auth.authStateReady?.();
  if (!auth.currentUser) throw new ApiError("Iniciá sesión para ver el catálogo central.", 401, "auth");
  if (!auth.currentUser.emailVerified) throw new ApiError("Verificá tu correo para ver el catálogo central.", 403, "verify");
}

export default {
  type: "central",
  name: "Catálogo de Supat",
  description: "Películas, series y anime de la fuente de contenido que configura el propietario, compartidos con todos los usuarios. Necesita iniciar sesión.",
  origin: "Servidor de Supat",
  kinds: ["movie", "series", "anime", "live"],
  multiple: false,
  ttl: 3600e3,
  defaults: {},
  fields: [],
  available: apiAvailable,

  async load(config, { signal }) {
    await ensureSession();
    // Estado claro cuando no hay catálogo (sin datos de relleno).
    const status = await api.get("/api/catalog/status", { signal });
    if (!status.configured) throw new ApiError("El catálogo no está disponible: todavía no se configuró la fuente de contenido.", 0, "unconfigured");
    if (!status.available) {
      throw new ApiError(status.importing ? "El catálogo se está importando. Volvé en unos minutos."
        : !status.enabled ? "El catálogo no está disponible: la fuente de contenido no pasó la prueba de conexión."
          : "El catálogo no está disponible por el momento.", 0, status.importing ? "importing" : "unavailable");
    }
    const items = [];
    for (const kind of this.kinds) {
      for (let page = 1; page <= MAX_PAGES_PER_KIND; page++) {
        const res = await api.get(`/api/catalog/titles?kind=${kind}&page=${page}&pageSize=${PAGE_SIZE}`, { signal });
        items.push(...res.items.map(toRawItem));
        if (!res.hasMore) break;
      }
    }
    return { items, warning: status.failing ? "La última sincronización tuvo problemas; se muestra lo importado hasta entonces." : "" };
  },

  async loadSeasons(item, config, { signal }) {
    const detail = await api.get(`/api/catalog/titles/${encodeURIComponent(item.rawId)}`, { signal });
    return (detail.seasons || []).map(s => ({
      number: s.number,
      episodes: s.episodes.map(e => ({ id: String(e.id), number: e.number, title: e.title, description: e.description, still: e.still, duration: e.duration, source: { lazy: true } }))
    }));
  },

  // Fuente elegida (sourceId) o la primera que funcione. Puede traer subtítulos y vencimiento.
  async resolveSource(item, episode, config, { signal, sourceId = null } = {}) {
    const params = new URLSearchParams();
    if (episode) params.set("episode", episode.rawId);
    if (sourceId) params.set("source", sourceId);
    const res = await api.get(`/api/catalog/titles/${encodeURIComponent(item.rawId)}/play${params.size ? `?${params}` : ""}`, { signal });
    return { url: res.url, type: res.type, subtitles: res.subtitles || [], expiresAt: res.expiresAt || null, embedOrigins: res.embedOrigins || [] };
  },

  // Qué fuentes ofrecen este título o episodio (solo el nombre visible que eligió el propietario).
  async listSources(item, episode, config, { signal } = {}) {
    const query = episode ? `?episode=${encodeURIComponent(episode.rawId)}` : "";
    return (await api.get(`/api/catalog/titles/${encodeURIComponent(item.rawId)}/sources${query}`, { signal })).sources || [];
  }
};

// Búsqueda en todo el catálogo central (no solo en lo ya cargado), paginada.
export async function searchCentral(q, page = 1, { signal } = {}) {
  await ensureSession();
  const res = await api.get(`/api/catalog/search?q=${encodeURIComponent(q)}&page=${page}&pageSize=30`, { signal });
  return { items: res.items.map(toRawItem), hasMore: res.hasMore, page };
}
