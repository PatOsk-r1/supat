// Pruebas del catálogo, los proveedores, favoritos y búsqueda.
import test from "node:test";
import assert from "node:assert/strict";

// Solo el proveedor de demostración: las pruebas no deben depender de internet.
const data = { "supat:ajustes": JSON.stringify({ providers: [{ id: "demo", type: "demo", enabled: true }] }) };
globalThis.localStorage = {
  getItem: k => (k in data ? data[k] : null),
  setItem: (k, v) => { data[k] = String(v); },
  removeItem: k => { delete data[k]; }
};

const { catalog } = await import("../src/catalog/store.js");
const { KINDS, normalizeItem, findEpisode, nextEpisode } = await import("../src/catalog/model.js");
const registry = await import("../src/providers/registry.js");
const { demoItems } = await import("../src/providers/demo-data.js");
const { escapeHtml } = await import("../src/app/util.js");
const { createFavorites } = await import("../src/app/favorites.js");
const { searchItems, fold } = await import("../src/ui/views/lists.js");
const { sortItems } = await import("../src/ui/views/browse.js");

test("el catálogo carga los elementos de demostración, marcados como demo y con su origen", async () => {
  await catalog.load();
  const items = catalog.all();
  assert.equal(items.length, demoItems.length);
  assert.ok(items.every(x => x.isDemo && x.providerId === "demo" && x.providerName === "Demostración"));
  assert.ok(items.every(x => KINDS[x.kind]));
  assert.equal(catalog.status("demo").state, "ok");
});

test("los ids no se repiten y ningún elemento demo trae fuente de video", () => {
  const items = catalog.all();
  assert.equal(new Set(items.map(x => x.id)).size, items.length);
  assert.ok(items.every(x => x.source === null));
});

test("series con temporadas y episodios; siguiente episodio", async () => {
  const serie = catalog.get("demo:2");
  const seasons = await catalog.seasons(serie);
  assert.equal(seasons.length, 2);
  assert.equal(seasons[0].episodes[0].id, "demo:2/s1e1");
  assert.equal(findEpisode(serie, "demo:2/s1e3").season.number, 1);
  assert.equal(nextEpisode(serie, "demo:2/s1e3").id, "demo:2/s2e1");
  assert.equal(nextEpisode(serie, "demo:2/s2e2"), null);
});

test("categorías por tipo, ordenadas por cantidad", () => {
  assert.deepEqual(catalog.categories("movie").slice(0, 1), ["Acción"]);
  assert.ok(catalog.categories("live").includes("Noticias"));
});

test("desactivar un proveedor lo saca del catálogo", async () => {
  registry.updateInstance("demo", { enabled: false });
  await catalog.load();
  assert.equal(catalog.all().length, 0);
  assert.equal(catalog.status("demo").state, "disabled");
  registry.updateInstance("demo", { enabled: true });
  await catalog.load();
  assert.equal(catalog.all().length, demoItems.length);
});

test("normalizar descarta elementos inválidos y completa valores", () => {
  const inst = { id: "p", label: "P" };
  assert.equal(normalizeItem({ id: 1, kind: "otro", title: "x" }, inst, {}), null);
  assert.equal(normalizeItem({ id: 1, kind: "movie", title: "  " }, inst, {}), null);
  const x = normalizeItem({ id: 7, kind: "movie", title: "Peli", year: "1950", source: { url: " https://a/b.mp4 " } }, inst, {});
  assert.equal(x.id, "p:7");
  assert.equal(x.year, 1950);
  assert.deepEqual(x.categories, ["Sin categoría"]);
  assert.equal(x.source.url, "https://a/b.mp4");
});

test("búsqueda sin acentos, por varias palabras y título primero", () => {
  const items = catalog.all();
  assert.equal(fold("Acción"), "accion");
  assert.deepEqual(searchItems(items, "codigo").map(x => x.title), ["Código Azul"]);
  assert.ok(searchItems(items, "accion").length >= 2);
  assert.deepEqual(searchItems(items, "canal 2").map(x => x.title), ["Canal de demostración 2"]);
  assert.equal(searchItems(items, "   ").length, 0);
});

test("ordenar por año y título", () => {
  const movies = catalog.all().filter(x => x.kind === "movie");
  assert.equal(sortItems(movies, "recientes")[0].year, 2025);
  assert.equal(sortItems(movies, "antiguos")[0].year, 2023);
  assert.equal(sortItems(movies, "titulo")[0].title, "Horizonte");
});

test("escapeHtml neutraliza código HTML", () => {
  assert.equal(escapeHtml(`<img src=x onerror="alert(1)">`), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.equal(escapeHtml(null), "");
});

test("favoritos: agregar, quitar y recordar entre aperturas", () => {
  const fav = createFavorites();
  assert.equal(fav.toggle("demo:1"), true);
  assert.equal(createFavorites().has("demo:1"), true);
  assert.equal(fav.toggle("demo:1"), false);
  assert.equal(createFavorites().size, 0);
});

test("favoritos: datos dañados no rompen la app", () => {
  data["supat:favoritos"] = "{esto no es json";
  assert.equal(createFavorites().size, 0);
});

test("proveedores: agregar, validar campos obligatorios y quitar", () => {
  assert.deepEqual(registry.validateConfig(registry.getInstance("demo")), []);
  const jf = registry.addInstance("jellyfin");
  assert.equal(jf.enabled, false);
  assert.equal(registry.validateConfig(jf).length, 2);
  const m3u = registry.addInstance("m3u");
  assert.match(registry.validateConfig(m3u)[0], /dirección de la lista/);
  assert.equal(registry.validateConfig(registry.updateInstance(m3u.id, { config: { url: "https://x/l.m3u" } })).length, 0);
  registry.removeInstance(jf.id);
  registry.removeInstance(m3u.id);
  assert.deepEqual(registry.getInstances().map(i => i.id), ["demo"]);
  // Internet Archive viene activado por defecto para quien no configuró nada.
  assert.deepEqual(registry.defaultInstances().map(i => [i.id, i.enabled]), [["archive", true], ["demo", true]]);
});
