// Dos fuentes INVENTADAS para las pruebas automáticas (no existen ni imitan a ninguna real), con
// APIs deliberadamente distintas, configuradas como se haría desde Ajustes:
//   Fuente A: API Key en encabezado, paginación por página, temporadas + episodios por temporada,
//             reproducción pidiendo la URL a un endpoint con la credencial en un encabezado.
//   Fuente B: token Bearer, paginación por offset con total de resultados, episodios en una sola
//             lista, reproducción armando la URL con una plantilla (videos públicos, sin credencial).
import { fakeNet } from "./api.js";
import { BASE, KEY, PLAY_KEY, providerNet } from "./proveedor-simulado.js";
import { FORM_KEYS } from "../../src/shared/fuente-esquema.js";

export const BASE_B = "https://api.otra.ejemplo/v2";
export const VIDEO_B = "https://video.otra.ejemplo";
export const TOKEN_B = "token-de-la-fuente-b-789";
export const PLAY_KEY_B = "credencial-reproduccion-b-012";

// Formulario completo con todos los campos vacíos (como lo muestra Ajustes al principio).
export const emptyForm = () => Object.fromEntries(FORM_KEYS.map(k => [k, k.startsWith("cat.") ? false : ""]));

export const FORM_A = () => ({
  ...emptyForm(),
  internalName: "prueba-a", displayName: "Opción 1", baseUrl: BASE, httpMethod: "GET", timeoutSec: "10", retryMax: "5",
  authType: "apiKeyHeader", apiKeyName: "X-Api-Key",
  "cat.movie": true, "cat.series": true, "cat.episodes": true,
  "ep.movie.path": "/movies", "ep.movie.items": "results",
  "ep.series.path": "/series", "ep.series.items": "data",
  "ep.seasons.path": "/series/{data.slug}/seasons", "ep.seasons.items": "seasons",
  "ep.episodes.path": "/series/{data.slug}/seasons/{season}/episodes", "ep.episodes.items": "episodes", "ep.episodes.page.type": "none",
  "page.type": "page", "page.pageParam": "page", "page.start": "1", "page.totalPagesPath": "total_pages", "page.sinceParam": "changed_since",
  "map.id": "id", "map.title": "title|name", "map.description": "overview", "map.poster": "poster_path", "map.year": "release_date|first_air_date",
  "map.tmdb": "ids.tmdb|tmdb_id", "map.imdb": "ids.imdb", "map.categories": "genres[].name", "map.extra": "slug=slug",
  "img.posterPrefix": "https://img.prov.ejemplo/w500",
  "season.number": "season_number",
  "epmap.id": "id", "epmap.number": "episode_number", "epmap.title": "name",
  "play.mode": "api", "play.apiPath": "/play/{id}", "play.urlPath": "stream.url", "play.typePath": "stream.type",
  "play.keyIn": "header", "play.keyName": "X-Play-Token", "play.contentType": "video",
  "play.domains": "https://cdn.prov.ejemplo"
});
export const SECRETS_A = { apiKey: KEY, playbackKey: PLAY_KEY };

export const FORM_B = () => ({
  ...emptyForm(),
  internalName: "prueba-b", displayName: "Opción 2", baseUrl: BASE_B, httpMethod: "GET",
  authType: "bearer",
  "cat.movie": true, "cat.series": true, "cat.episodes": true,
  "ep.movie.path": "/catalog/films", "ep.movie.items": "items",
  "ep.series.path": "/catalog/shows", "ep.series.items": "items",
  "ep.episodes.path": "/catalog/shows/{id}/episodes", "ep.episodes.items": "items",
  "page.type": "offset", "page.pageParam": "start", "page.sizeParam": "count", "page.size": "3", "page.infoPath": "meta", "page.totalResultsPath": "total",
  "map.id": "key", "map.title": "name", "map.description": "overview", "map.poster": "img", "map.releaseDate": "released",
  "map.tmdb": "external.tmdb", "map.imdb": "external.imdb", "img.posterPrefix": "https://img.otra.ejemplo",
  "epmap.id": "key", "epmap.season": "season", "epmap.number": "episode", "epmap.title": "name",
  "play.mode": "template", "play.baseUrl": VIDEO_B, "play.movieTemplate": `${VIDEO_B}/m/{id}.mp4`, "play.episodeTemplate": "/e/{seriesId}/{season}/{episode}.m3u8",
  "play.domains": VIDEO_B, "play.contentType": "video", "play.expiresSec": "600"
});
export const SECRETS_B = { token: TOKEN_B };

const FILMS_B = [
  { key: "b1", name: "La Película Uno (versión B)", released: "1999-05-01", img: "/p/b1.jpg", external: { tmdb: 101 } },   // misma que A (TMDb 101)
  { key: "b2", name: "Película solo de B", released: "2020-01-01", external: { tmdb: 900, imdb: "tt0000900" } },
  { key: "b3", name: "Otra de B", released: "2021" },
  { key: "b4", name: "Cuarta de B", released: "2022" }
];

export function sourceBNet(state = {}) {
  const s = { failAll: false, calls: 0, ...state };
  const auth = init => (init.headers?.Authorization === `Bearer ${TOKEN_B}` ? null : { __status: 401, body: { error: "unauthorized" } });
  const page = (u, list) => {
    const start = Number(u.searchParams.get("start") || 0), count = Number(u.searchParams.get("count") || 10);
    return { items: list.slice(start, start + count), meta: { total: list.length } };
  };
  const net = fakeNet({
    [`${BASE_B}/catalog/films`]: (u, init) => {
      s.calls++;
      if (s.failAll) return { __status: 503, body: { error: "caída" } };
      return auth(init) || page(u, s.films || FILMS_B);
    },
    [`${BASE_B}/catalog/shows/show-1/episodes`]: (u, init) => auth(init) || page(u, [
      { key: "b-e1", season: 1, episode: 1, name: "Uno de B" },
      { key: "b-e2", season: 2, episode: 1, name: "Vuelta (B)" }
    ]),
    [`${BASE_B}/catalog/shows`]: (u, init) => {
      if (s.failAll) return { __status: 503, body: { error: "caída" } };
      return auth(init) || page(u, [{ key: "show-1", name: "Serie de B", external: { tmdb: 501 } }]);
    },
    // "Video" de la fuente B: responde al primer KB (para "Probar reproducción").
    [`${VIDEO_B}/`]: (u) => (u.searchParams.has("t") ? { __status: 400, body: "no" } : { __status: 206, body: "x" })
  });
  net.state = s;
  return net;
}

// Las dos fuentes a la vez (cada pedido va a su simulador según el servidor).
export function bothNets(stateA = {}, stateB = {}) {
  const a = providerNet(stateA), b = sourceBNet(stateB);
  const cdnA = fakeNet({ "https://cdn.prov.ejemplo/": () => ({ __status: 206, body: "x" }) });
  const net = async (url, init) => {
    const u = String(url);
    if (u.startsWith(BASE_B) || u.startsWith(VIDEO_B)) return b(url, init);
    if (u.startsWith("https://cdn.prov.ejemplo/")) return cdnA(url, init);
    return a(url, init);
  };
  net.a = a; net.b = b;
  net.calls = { get a() { return a.calls; }, get b() { return b.calls; } };
  return net;
}
