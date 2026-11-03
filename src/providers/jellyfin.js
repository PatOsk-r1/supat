// Jellyfin: servidor multimedia libre y gratuito que instalás en tu PC para tu propia
// colección de películas y series. https://jellyfin.org · API: https://api.jellyfin.org
// La clave se crea en Jellyfin → Panel de control → Claves de API.
const TICKS_PER_SECOND = 1e7;

const base = config => config.server.trim().replace(/\/+$/, "");

function api(config, path, params = {}) {
  const url = new URL(base(config) + path);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  url.searchParams.set("api_key", config.apiKey.trim());
  return url.toString();
}

async function getJson(url) {
  let res;
  try { res = await fetch(url); } catch {
    throw new Error("No se pudo conectar con el servidor Jellyfin. Revisá la dirección y que el servidor esté encendido.");
  }
  if (res.status === 401) throw new Error("Jellyfin rechazó la clave de API.");
  if (!res.ok) throw new Error(`Jellyfin respondió con un error (${res.status}).`);
  return res.json();
}

const image = (config, id, type, size) => `${base(config)}/Items/${id}/Images/${type}?${size}`;

export default {
  type: "jellyfin",
  name: "Servidor Jellyfin",
  description: "Tu propia biblioteca de películas y series desde un servidor Jellyfin (gratuito, se instala aparte).",
  origin: "Tu servidor Jellyfin",
  license: "Tu propia colección",
  kinds: ["movie", "series"],
  multiple: true,
  ttl: 6 * 3600e3,
  defaults: { server: "", apiKey: "", userId: "", mode: "hls" },
  fields: [
    { key: "server", label: "Dirección del servidor", type: "url", placeholder: "http://localhost:8096", required: true },
    { key: "apiKey", label: "Clave de API", type: "password", required: true, help: "Jellyfin → Panel de control → Claves de API → +." },
    { key: "userId", label: "Id de usuario (opcional)", type: "text", help: "Solo si tu servidor lo pide para listar la biblioteca." },
    { key: "mode", label: "Modo de reproducción", type: "select", options: [["hls", "Convertir a HLS (más compatible)"], ["direct", "Archivo original (más liviano para el servidor)"]] }
  ],
  async load(config) {
    const path = config.userId?.trim() ? `/Users/${encodeURIComponent(config.userId.trim())}/Items` : "/Items";
    const data = await getJson(api(config, path, {
      Recursive: "true",
      IncludeItemTypes: "Movie,Series",
      Fields: "Overview,Genres,ProductionYear,CommunityRating",
      SortBy: "SortName"
    }));
    return {
      items: (data.Items || []).map(x => ({
        id: x.Id,
        kind: x.Type === "Series" ? "series" : "movie",
        title: x.Name,
        year: x.ProductionYear,
        description: x.Overview || "",
        categories: x.Genres?.length ? x.Genres : ["Mi biblioteca"],
        rating: x.CommunityRating || null,
        poster: x.ImageTags?.Primary ? image(config, x.Id, "Primary", "maxHeight=450") : "",
        backdrop: x.BackdropImageTags?.length ? image(config, x.Id, "Backdrop", "maxWidth=1280") : "",
        lazySeasons: x.Type === "Series",
        source: x.Type === "Series" ? null : { lazy: true }
      }))
    };
  },
  async loadSeasons(item, config) {
    const data = await getJson(api(config, `/Shows/${encodeURIComponent(item.rawId)}/Episodes`, { Fields: "Overview", UserId: config.userId?.trim() }));
    const seasons = new Map();
    for (const ep of data.Items || []) {
      const n = ep.ParentIndexNumber ?? 0;
      if (!seasons.has(n)) seasons.set(n, []);
      seasons.get(n).push({
        id: ep.Id,
        number: ep.IndexNumber ?? seasons.get(n).length + 1,
        title: ep.Name,
        description: ep.Overview || "",
        duration: ep.RunTimeTicks ? ep.RunTimeTicks / TICKS_PER_SECOND : 0,
        still: ep.ImageTags?.Primary ? image(config, ep.Id, "Primary", "maxWidth=400") : "",
        source: { lazy: true }
      });
    }
    return [...seasons.entries()].map(([number, episodes]) => ({ number, episodes }));
  },
  async resolveSource(item, episode, config) {
    const id = episode ? episode.rawId : item.rawId;
    if (config.mode === "direct") return { url: api(config, `/Videos/${id}/stream`, { static: "true" }), type: "" };
    return {
      url: api(config, `/Videos/${id}/master.m3u8`, { MediaSourceId: id, VideoCodec: "h264", AudioCodec: "aac,mp3", TranscodingMaxAudioChannels: "2" }),
      type: "application/x-mpegurl"
    };
  }
};
