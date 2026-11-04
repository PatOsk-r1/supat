// Un proveedor INVENTADO para las pruebas (no existe): películas paginadas por número de página,
// series paginadas por cursor, temporadas, episodios y fuente pedida al reproducir.
import { fakeNet } from "./api.js";

export const BASE = "https://api.prov.ejemplo/v1";
export const KEY = "clave-super-secreta-123";
export const PLAY_KEY = "credencial-de-reproduccion-456";

export const SPEC = {
  auth: [{ in: "header", name: "X-Api-Key", value: "{apiKey}" }],
  playbackAuth: [{ in: "header", name: "X-Play-Token", value: "{playbackKey}" }],
  catalog: {
    movie: {
      path: "/movies", query: { page: "{page}", changed_since: "{since}" }, items: "results",
      pagination: { type: "page", start: 1, totalPages: "total_pages" },
      map: { id: "id", title: "title", year: "release_date", description: "overview", poster: "poster_path", categories: "genres[].name", tmdb: "ids.tmdb", imdb: "ids.imdb" },
      prefix: { poster: "https://img.prov.ejemplo/w500" }
    },
    series: {
      path: "/series", query: { cursor: "{cursor}" }, items: "data",
      pagination: { type: "cursor", next: "meta.next" },
      map: { id: "id", title: "name", year: "first_air_date", tmdb: "tmdb_id", "data.slug": "slug" }
    }
  },
  seasons: { path: "/series/{data.slug}/seasons", items: "seasons", map: { number: "season_number" } },
  episodes: {
    path: "/series/{data.slug}/seasons/{season}/episodes", items: "episodes",
    map: { id: "id", number: "episode_number", title: "name", "playback.url": "stream" }, playbackType: "hls"
  },
  resolve: { path: "/play/{id}", url: "stream.url", type: "stream.type" },
  embedOrigins: ["https://reproductor.prov.ejemplo"]
};

export function movies(page) {
  const all = [
    { id: "m1", title: "La Película Uno", release_date: "1999-05-01", overview: "Primera.", poster_path: "/uno.jpg", genres: [{ name: "Drama" }], ids: { tmdb: 101, imdb: "tt0000101" } },
    { id: "m2", title: "Canción de Otoño", release_date: "2001", genres: [{ name: "Romance" }, { name: "Drama" }], ids: { tmdb: 102 } },
    { id: "m3", title: "Ñandú Veloz", release_date: "2010-01-01", ids: { imdb: "tt0000103" } },
    { id: "m4", title: "", release_date: "2010" } // incompleto: se descarta
  ];
  return page === 1 ? all.slice(0, 2) : page === 2 ? all.slice(2) : [];
}

// Estado del "servidor" simulado; las pruebas lo cambian para simular fallas.
export function providerNet(state = {}) {
  const s = { failMovies: 0, pages: {}, playKeyLeaks: 0, ...state };
  // La credencial de reproducción NO debe llegar a las consultas del catálogo.
  const auth = init => {
    if (init.headers?.["X-Play-Token"]) s.playKeyLeaks++;
    return init.headers?.["X-Api-Key"] === KEY ? null : { __status: 401, body: { error: "bad key" } };
  };
  const net = fakeNet({
    [`${BASE}/movies`]: (u, init) => {
      if (auth(init)) return auth(init);
      if (s.failMovies > 0) { s.failMovies--; return { __status: 503, body: { error: "temporal" } }; }
      if (s.fatal) return { __status: 400, body: { error: "mal" } };
      const page = Number(u.searchParams.get("page"));
      s.pages.movies = (s.pages.movies || 0) + 1;
      return { results: s.moviesFn ? s.moviesFn(page) : movies(page), total_pages: 2 };
    },
    [`${BASE}/series/serie-a/seasons/1/episodes`]: () => ({ episodes: [{ id: "a-1-1", episode_number: 1, name: "Piloto", stream: "https://cdn.prov.ejemplo/a/1/1.m3u8" }, { id: "a-1-2", episode_number: 2, name: "Dos", stream: "https://cdn.prov.ejemplo/a/1/2.m3u8" }] }),
    [`${BASE}/series/serie-a/seasons/2/episodes`]: () => ({ episodes: [{ id: "a-2-1", episode_number: 1, name: "Vuelta", stream: "https://cdn.prov.ejemplo/a/2/1.m3u8" }] }),
    [`${BASE}/series/serie-a/seasons`]: () => ({ seasons: [{ season_number: 1 }, { season_number: 2 }] }),
    [`${BASE}/series`]: (u, init) => {
      if (u.pathname !== "/v1/series") return { __status: 404, body: { error: "no existe" } };
      if (auth(init)) return auth(init);
      const page = u.searchParams.get("page");
      if (page) return Number(page) === 1
        ? { data: [{ id: "s1", name: "Serie A", slug: "serie-a", first_air_date: "2015-02-02", tmdb_id: 501 }], total_pages: 2 }
        : { data: Number(page) === 2 ? [{ id: "s2", name: "Serie B", slug: "serie-b", tmdb_id: 502 }] : [], total_pages: 2 };
      const cursor = u.searchParams.get("cursor");
      if (!cursor) return { data: [{ id: "s1", name: "Serie A", slug: "serie-a", first_air_date: "2015-02-02", tmdb_id: 501 }], meta: { next: "pagina2" } };
      return { data: [{ id: "s2", name: "Serie B", slug: "serie-b", tmdb_id: 502 }], meta: { next: null } };
    },
    [`${BASE}/play/`]: (u, init) => {
      if (init.headers?.["X-Api-Key"] !== KEY) return { __status: 401, body: { error: "bad key" } };
      if (init.headers?.["X-Play-Token"] !== PLAY_KEY) return { __status: 403, body: { error: "playback not authorized" } };
      const id = u.pathname.split("/").pop();
      if (id === "m2") return { stream: { url: `https://cdn.prov.ejemplo/m2.mp4?token=${PLAY_KEY}`, type: "mp4" } }; // filtra la credencial: no se entrega
      if (id === "m3") return { stream: { url: "https://otro.ejemplo/embed/m3", type: "embed" } };      // iframe de un origen no declarado
      return { stream: { url: `https://cdn.prov.ejemplo/${id}.m3u8`, type: "hls" } };
    }
  });
  net.state = s;
  return net;
}
