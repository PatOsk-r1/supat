// Pruebas del cliente de TMDb con respuestas simuladas (sin conexión real ni clave).
import test from "node:test";
import assert from "node:assert/strict";
import { buildRequest, cleanTitle, lookup, seasonEpisodes, testKey, TmdbError, mapWatchProviders } from "../src/catalog/tmdb.js";

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const path = new URL(url).pathname.replace("/3", "");
    const body = routes[path];
    if (body === 401) return { ok: false, status: 401 };
    if (!body) return { ok: false, status: 404 };
    return { ok: true, status: 200, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

test("clave v3 va en la dirección; token v4 va en la cabecera", () => {
  const v3 = buildRequest("/search/movie", { query: "Nosferatu" }, "abc123", "es-ES");
  assert.match(v3.url, /api_key=abc123/);
  assert.match(v3.url, /language=es-ES/);
  const v4 = buildRequest("/configuration", {}, "eyJhbGciOi.token", "es-ES");
  assert.doesNotMatch(v4.url, /api_key/);
  assert.equal(v4.headers.Authorization, "Bearer eyJhbGciOi.token");
});

test("limpia títulos para buscar", () => {
  assert.equal(cleanTitle("Nosferatu (1922) [HD]"), "Nosferatu");
});

test("busca una película, pide detalles y arma los metadatos", async () => {
  const fetchFn = fakeFetch({
    "/search/movie": { results: [{ id: 653 }] },
    "/movie/653": { id: 653, title: "Nosferatu", original_title: "Nosferatu, eine Symphonie des Grauens", overview: "Un vampiro…", poster_path: "/p.jpg", backdrop_path: "/b.jpg", vote_average: 7.66, vote_count: 900, release_date: "1922-03-04", genres: [{ name: "Terror" }], runtime: 94, credits: { cast: [{ name: "Max Schreck" }] } }
  });
  const info = await lookup({ kind: "movie", title: "Nosferatu (1922)", year: 1922 }, { key: "k", language: "es-ES", fetchFn });
  assert.equal(info.tmdbId, 653);
  assert.equal(info.poster, "https://image.tmdb.org/t/p/w342/p.jpg");
  assert.equal(info.backdrop, "https://image.tmdb.org/t/p/w1280/b.jpg");
  assert.equal(info.rating, 7.7);
  assert.equal(info.year, 1922);
  assert.deepEqual(info.genres, ["Terror"]);
  assert.deepEqual(info.cast, ["Max Schreck"]);
  assert.match(fetchFn.calls[0].url, /year=1922/);
});

test("si no encuentra con año, reintenta sin año; si no hay nada devuelve null", async () => {
  const fetchFn = fakeFetch({ "/search/tv": { results: [] } });
  const info = await lookup({ kind: "series", title: "Serie inexistente", year: 1990 }, { key: "k", language: "es-ES", fetchFn });
  assert.equal(info, null);
  assert.equal(fetchFn.calls.length, 2);
  assert.doesNotMatch(fetchFn.calls[1].url, /first_air_date_year/);
});

test("episodios de una temporada", async () => {
  const fetchFn = fakeFetch({ "/tv/9/season/1": { episodes: [{ episode_number: 1, name: "Piloto", overview: "…", still_path: "/s.jpg", runtime: 42 }] } });
  const eps = await seasonEpisodes(9, 1, { key: "k", language: "es-ES", fetchFn });
  assert.deepEqual(eps[0], { number: 1, title: "Piloto", description: "…", still: "https://image.tmdb.org/t/p/w300/s.jpg", duration: 2520 });
});

test("clave rechazada da un mensaje claro", async () => {
  const fetchFn = fakeFetch({ "/configuration": 401 });
  await assert.rejects(testKey({ key: "mala", language: "es-ES", fetchFn }), err => err instanceof TmdbError && /rechazó la clave/.test(err.message));
});

test("Dónde verla: agrupa por tipo para el país pedido y descarta países sin datos", () => {
  const data = { results: { UY: { link: "https://www.themoviedb.org/movie/1/watch?locale=UY", flatrate: [{ provider_name: "Plataforma A", logo_path: "/a.png" }], rent: [{ provider_name: "Tienda B", logo_path: "/b.png" }] } } };
  const w = mapWatchProviders(data, "UY");
  assert.deepEqual(w.groups.map(g => g.label), ["Incluida en suscripción", "Alquiler"]);
  assert.equal(w.groups[0].providers[0].logo, "https://image.tmdb.org/t/p/w92/a.png");
  assert.match(w.link, /locale=UY/);
  assert.equal(mapWatchProviders(data, "AR"), null);
  assert.equal(mapWatchProviders(undefined, "UY"), null);
});

test("Dónde verla: se pide junto con los detalles y se usa el país de los ajustes", async () => {
  const calls = [];
  const fetchFn = async url => {
    calls.push(url);
    const path = new URL(url).pathname.replace("/3", "");
    const body = path === "/search/movie" ? { results: [{ id: 5 }] } : { id: 5, title: "X", "watch/providers": { results: { UY: { free: [{ provider_name: "Gratis C", logo_path: "/c.png" }] } } } };
    return { ok: true, status: 200, json: async () => body };
  };
  const info = await lookup({ kind: "movie", title: "Otra", year: 1931 }, { key: "k", language: "es-ES", region: "UY", fetchFn });
  assert.match(decodeURIComponent(calls[1]), /append_to_response=credits,watch\/providers/);
  assert.equal(info.watch.groups[0].label, "Gratis");
});
