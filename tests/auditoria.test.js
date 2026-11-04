// Auditoría del sistema de fuentes: casos límite con una API SIMULADA genérica (no existe; no
// imita a ninguna real). Cada prueba documenta un escenario que el sistema debe manejar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, api, fakeNet } from "./helpers/api.js";
import { emptyForm } from "./helpers/fuentes-simuladas.js";

const OWNER = { uid: "dueno" };
const BASE = "https://api.c.ejemplo/v1";
const KEY = "clave-de-la-api-simulada-c";

// Formulario base de la fuente A para la API simulada "C".
const formC = over => ({
  ...emptyForm(), displayName: "Opción C", baseUrl: BASE, authType: "apiKeyQuery", apiKeyName: "key",
  "map.id": "id", "map.title": "name", ...over
});

async function setup(routes, form) {
  const env = makeEnv();
  const net = fakeNet(routes);
  const s = await api(env, "PUT", "/api/admin/sources/a", { ...OWNER, fetchImpl: net, body: { form, secrets: { apiKey: KEY } } });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const on = await api(env, "POST", "/api/admin/sources/a/enable", { ...OWNER, fetchImpl: net, body: { enabled: true } });
  assert.equal(on.status, 200, JSON.stringify(on.body));
  return { env, net };
}

async function importAll(env, net, mode = "full", extra = {}) {
  let job = (await api(env, "POST", "/api/admin/sources/a/import", { ...OWNER, fetchImpl: net, body: { mode, ...extra } })).body.job;
  for (let i = 0; i < 200 && ["queued", "running"].includes(job?.status); i++) job = (await api(env, "POST", `/api/admin/jobs/${job.id}/continue`, { ...OWNER, fetchImpl: net })).body.job;
  return job;
}

const list = async (env, kind) => (await api(env, "GET", `/api/catalog/titles?kind=${kind}&pageSize=200`, { uid: "ana" })).body.items;
const detail = async (env, id) => (await api(env, "GET", `/api/catalog/titles/${id}`, { uid: "ana" })).body;
const page = (u, all, param = "offset", size = 20) => {
  const start = Number(u.searchParams.get(param) || 0);
  return all.slice(start, start + size);
};

// ---------- series y episodios ----------

test("episodios con IDs repetidos entre series distintas no se mezclan", async () => {
  const eps = sid => ({ items: [{ id: "1", s: 1, n: 1, name: `Ep ${sid}-1` }, { id: "2", s: 1, n: 2, name: `Ep ${sid}-2` }] });
  const { env, net } = await setup({
    [`${BASE}/shows/10/episodes`]: () => eps("10"),
    [`${BASE}/shows/20/episodes`]: () => eps("20"),
    [`${BASE}/shows`]: () => ({ items: [{ id: "10", name: "Serie Diez" }, { id: "20", name: "Serie Veinte" }] })
  }, formC({ "cat.series": true, "cat.episodes": true, "ep.series.path": "/shows", "ep.series.items": "items",
    "ep.episodes.path": "/shows/{id}/episodes", "ep.episodes.items": "items", "epmap.id": "id", "epmap.season": "s", "epmap.number": "n", "epmap.title": "name" }));
  const job = await importAll(env, net);
  assert.equal(job.status, "done", job.lastError);
  for (const s of await list(env, "series")) {
    const sid = s.title === "Serie Diez" ? "10" : "20";
    const d = await detail(env, s.id);
    assert.deepEqual(d.seasons[0].episodes.map(e => e.title), [`Ep ${sid}-1`, `Ep ${sid}-2`], `episodios de ${s.title}`);
  }
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM episode_sources").get().n, 4);
});

test("una película y una serie con el mismo ID interno son títulos distintos", async () => {
  const { env, net } = await setup({
    [`${BASE}/movies`]: () => ({ items: [{ id: "7", name: "Película Siete" }] }),
    [`${BASE}/shows`]: () => ({ items: [{ id: "7", name: "Serie Siete" }] })
  }, formC({ "cat.movie": true, "cat.series": true, "ep.movie.path": "/movies", "ep.movie.items": "items", "ep.series.path": "/shows", "ep.series.items": "items" }));
  assert.equal((await importAll(env, net)).status, "done");
  assert.deepEqual((await list(env, "movie")).map(t => t.title), ["Película Siete"]);
  assert.deepEqual((await list(env, "series")).map(t => t.title), ["Serie Siete"]);
});

test("temporada especial (0), episodios sin imagen y una serie con 300 episodios paginados", async () => {
  const many = [
    { id: "sp1", s: 0, n: 1, name: "Especial" },
    ...Array.from({ length: 300 }, (_, i) => ({ id: `e${i}`, s: 1 + Math.floor(i / 100), n: (i % 100) + 1, name: `Episodio ${i}`, img: i % 2 ? "" : `/i/${i}.jpg` }))
  ];
  const { env, net } = await setup({
    [`${BASE}/shows/99/episodes`]: u => ({ items: page(u, many, "offset", 50), total: many.length }),
    [`${BASE}/shows`]: u => ({ items: page(u, [{ id: "99", name: "Serie Larga" }], "offset", 50), total: 1 })
  }, formC({ "cat.series": true, "cat.episodes": true, "ep.series.path": "/shows", "ep.series.items": "items",
    "ep.episodes.path": "/shows/{id}/episodes", "ep.episodes.items": "items",
    "page.type": "offset", "page.pageParam": "offset", "page.size": "50", "page.totalResultsPath": "total",
    "epmap.id": "id", "epmap.season": "s", "epmap.number": "n", "epmap.title": "name", "epmap.still": "img", "img.stillPrefix": "https://img.c.ejemplo" }));
  const job = await importAll(env, net);
  assert.equal(job.status, "done", job.lastError);
  assert.equal(job.episodes, 301);
  const s = (await list(env, "series"))[0];
  const d = await detail(env, s.id);
  assert.deepEqual(d.seasons.map(x => [x.number, x.episodes.length]), [[0, 1], [1, 100], [2, 100], [3, 100]]);
  const e1 = d.seasons[1].episodes;
  assert.equal(e1[0].still, "https://img.c.ejemplo/i/0.jpg");
  assert.equal(e1[1].still, "", "episodio sin imagen");
  assert.ok(e1.every((e, i) => e.number === i + 1));
});

// ---------- metadatos ----------

test("si la fuente deja de enviar un campo, el valor anterior se conserva", async () => {
  let withData = true;
  const { env, net } = await setup({
    [`${BASE}/movies`]: () => ({ items: [{ id: "1", name: "Película", info: withData ? { plot: "Sinopsis completa.", poster: "https://img.c.ejemplo/p.jpg", year: 2001, genres: [{ n: "Drama" }] } : { year: 2001 } }] })
  }, formC({ "cat.movie": true, "ep.movie.path": "/movies", "ep.movie.items": "items",
    "map.description": "info.plot", "map.poster": "info.poster", "map.year": "info.year", "map.categories": "info.genres[].n" }));
  await importAll(env, net);
  withData = false;
  assert.equal((await importAll(env, net, "full")).status, "done");
  const [m] = await list(env, "movie");
  assert.equal(m.description, "Sinopsis completa.");
  assert.equal(m.poster, "https://img.c.ejemplo/p.jpg");
  assert.deepEqual(m.categories, ["Drama"]);
});

// ---------- importación ----------

test("una importación completa interrumpida por una página vacía no oculta títulos válidos", async () => {
  const all = Array.from({ length: 100 }, (_, i) => ({ id: `m${i}`, name: `Película ${i}` }));
  let glitch = false;
  const { env, net } = await setup({
    [`${BASE}/movies`]: u => ({ items: glitch && Number(u.searchParams.get("offset")) >= 20 ? [] : page(u, all, "offset", 20) })
  }, formC({ "cat.movie": true, "ep.movie.path": "/movies", "ep.movie.items": "items", "page.type": "offset", "page.pageParam": "offset", "page.size": "20" }));
  assert.equal((await importAll(env, net)).created, 100);
  glitch = true; // la API devuelve una página vacía en el medio (falla temporal sin código de error)
  const job = await importAll(env, net, "full");
  assert.equal(job.status, "done");
  assert.equal((await list(env, "movie")).length, 100, "no se ocultaron los 80 títulos que no llegaron");
  const logs = (await api(env, "GET", "/api/admin/sources/a/errors", OWNER)).body.errors;
  assert.ok(logs.some(l => /no se marcaron/.test(l.message)), "queda registrado por qué no se dieron de baja");
  // Si las bajas son reales, el propietario las confirma al reiniciar la importación.
  const restart = await api(env, "POST", "/api/admin/sources/a/restart", { ...OWNER, fetchImpl: net, body: { confirm: true, allowRemovals: true } });
  assert.equal(restart.status, 200);
  let j = restart.body.source.activeJob;
  for (let i = 0; i < 50 && j && ["queued", "running"].includes(j.status); i++) j = (await api(env, "POST", `/api/admin/jobs/${j.id}/continue`, { ...OWNER, fetchImpl: net })).body.job;
  assert.equal((await list(env, "movie")).length, 20);
});

test("pocas bajas reales (dentro del margen) se marcan solas", async () => {
  let n = 30;
  const { env, net } = await setup({
    [`${BASE}/movies`]: () => ({ items: Array.from({ length: n }, (_, i) => ({ id: `m${i}`, name: `Película ${i}` })) })
  }, formC({ "cat.movie": true, "ep.movie.path": "/movies", "ep.movie.items": "items" }));
  await importAll(env, net);
  n = 28;
  await importAll(env, net, "full");
  assert.equal((await list(env, "movie")).length, 28);
});

test("paginación por cursor y por enlace siguiente, configuradas desde Ajustes", async () => {
  const all = Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, name: `Cursor ${i}` }));
  const { env, net } = await setup({
    [`${BASE}/movies`]: u => {
      const at = Number(u.searchParams.get("after") || 0);
      return { data: { results: all.slice(at, at + 3) }, paging: { next: at + 3 < all.length ? String(at + 3) : null } };
    },
    [`${BASE}/shows`]: u => {
      const p = Number(u.searchParams.get("p") || 1);
      return { results: [{ id: `s${p}`, name: `Show ${p}` }], links: { next: p < 3 ? `${BASE}/shows?p=${p + 1}` : null } };
    }
  }, formC({ "cat.movie": true, "cat.series": true, "ep.movie.path": "/movies", "ep.movie.items": "data.results",
    "ep.series.path": "/shows", "ep.series.items": "results",
    "page.type": "cursor", "page.pageParam": "after", "page.nextPath": "paging.next|links.next" }));
  // Cursor para películas y enlace para series no se pueden mezclar: la paginación es general.
  const job = await importAll(env, net);
  assert.equal(job.status, "done", job.lastError);
  assert.equal((await list(env, "movie")).length, 7, "cursor: todas las páginas");
  // LÍMITE CONOCIDO: el tipo de paginación es uno por fuente. Con "cursor", el enlace de series se
  // manda como cursor ("after=<enlace>"), la API devuelve otra vez la primera página y el corte por
  // página repetida evita el bucle: de series llega SOLO la primera página (1 de 3), sin error.
  assert.equal((await list(env, "series")).length, 1);
});

test("mapeo: JSON anidado, índices de arrays, listas y campos alternativos", async () => {
  const { env, net } = await setup({
    [`${BASE}/movies`]: () => ({ payload: { list: [
      { ids: { own: "x1", ext: [{ tmdb: 11 }] }, names: { es: "Título ES", en: "Title EN" }, dates: { release: "1999-12-31" }, media: { images: [{ url: "/a.jpg" }] }, tags: [{ label: "Acción" }, { label: "Drama" }], score: 7.5 },
      { ids: { own: "x2", ext: [] }, names: { en: "Only English" }, dates: { year: 2005 } }
    ] } })
  }, formC({ "cat.movie": true, "ep.movie.path": "/movies", "ep.movie.items": "payload.list",
    "map.id": "ids.own", "map.title": "names.es|names.en", "map.tmdb": "ids.ext[0].tmdb", "map.year": "dates.year", "map.releaseDate": "dates.release",
    "map.poster": "media.images[0].url", "img.posterPrefix": "https://img.c.ejemplo", "map.categories": "tags[].label", "map.rating": "score" }));
  assert.equal((await importAll(env, net)).status, "done");
  const items = await list(env, "movie");
  const a = items.find(t => t.title === "Título ES");
  assert.deepEqual([a.year, a.externalIds.tmdb, a.poster, a.categories, a.rating], [1999, 11, "https://img.c.ejemplo/a.jpg", ["Acción", "Drama"], 7.5]);
  const b = items.find(t => t.title === "Only English");
  assert.equal(b.year, 2005);
});

test("una respuesta vacía en un catálogo chico tampoco da de baja todo", async () => {
  let empty = false;
  const { env, net } = await setup({
    [`${BASE}/movies`]: () => ({ items: empty ? [] : Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, name: `Película ${i}` })) })
  }, formC({ "cat.movie": true, "ep.movie.path": "/movies", "ep.movie.items": "items" }));
  await importAll(env, net);
  empty = true;
  assert.equal((await importAll(env, net, "full")).status, "done");
  assert.equal((await list(env, "movie")).length, 5);
});

test("duplicados entre fuentes por IMDb (sin TMDb) y sin fusionar por título", async () => {
  const env = makeEnv();
  const netA = fakeNet({ [`${BASE}/movies`]: () => ({ items: [{ id: "a1", name: "Mismo Título", imdb: "tt1234567" }, { id: "a2", name: "Título Repetido" }] }) });
  const BASE_D = "https://api.d.ejemplo";
  const netD = fakeNet({ [`${BASE_D}/films`]: () => ({ rows: [{ code: "d1", label: "Otro nombre", ref: { imdb: "tt1234567" } }, { code: "d2", label: "Título Repetido" }] }) });
  const net = (url, init) => (String(url).startsWith(BASE_D) ? netD(url, init) : netA(url, init));
  const go = async (slot, form) => {
    await api(env, "PUT", `/api/admin/sources/${slot}`, { ...OWNER, fetchImpl: net, body: { form, secrets: { apiKey: KEY } } });
    await api(env, "POST", `/api/admin/sources/${slot}/enable`, { ...OWNER, fetchImpl: net, body: { enabled: true } });
    let j = (await api(env, "POST", `/api/admin/sources/${slot}/import`, { ...OWNER, fetchImpl: net, body: { mode: "full" } })).body.job;
    for (let i = 0; i < 20 && ["queued", "running"].includes(j.status); i++) j = (await api(env, "POST", `/api/admin/jobs/${j.id}/continue`, { ...OWNER, fetchImpl: net })).body.job;
    return j;
  };
  await go("a", formC({ "cat.movie": true, "ep.movie.path": "/movies", "ep.movie.items": "items", "map.imdb": "imdb" }));
  const j = await go("b", { ...emptyForm(), displayName: "Opción D", baseUrl: BASE_D, authType: "none", "cat.movie": true, "ep.movie.path": "/films", "ep.movie.items": "rows", "map.id": "code", "map.title": "label", "map.imdb": "ref.imdb" });
  assert.equal(j.merged, 1);
  const titles = (await list(env, "movie")).map(t => t.title).sort();
  assert.deepEqual(titles, ["Mismo Título", "Título Repetido", "Título Repetido"], "unidos por IMDb; el título igual sin ids NO se fusiona");
});
