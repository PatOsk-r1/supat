// Pruebas de la lógica que no depende de la pantalla.
// Se ejecutan con:  npm test   (usa el probador incluido en Node, sin instalar nada)
import test from "node:test";
import assert from "node:assert/strict";
import { loadCatalog, KINDS } from "../src/catalog/index.js";
import { demoItems } from "../src/catalog/demo-data.js";
import { escapeHtml } from "../src/util.js";

// Simula el almacenamiento del navegador para probar favoritos en Node.
function fakeStorage(initial = {}, { broken = false } = {}) {
  const data = { ...initial };
  globalThis.localStorage = {
    getItem: k => { if (broken) throw new Error("bloqueado"); return k in data ? data[k] : null; },
    setItem: (k, v) => { if (broken) throw new Error("bloqueado"); data[k] = String(v); }
  };
  return data;
}

test("el catálogo carga todos los elementos de demostración, marcados como demo", async () => {
  const { items, errors } = await loadCatalog();
  assert.equal(errors.length, 0);
  assert.equal(items.length, demoItems.length);
  assert.ok(items.every(x => x.isDemo && x.provider === "demo"));
  assert.ok(items.every(x => KINDS[x.kind]));
});

test("los ids no se repiten", async () => {
  const { items } = await loadCatalog();
  assert.equal(new Set(items.map(x => x.id)).size, items.length);
});

test("ningún elemento de demostración trae una fuente de video", async () => {
  const { items } = await loadCatalog();
  assert.ok(items.every(x => x.source === null));
});

test("hay contenido en las tres secciones y un destacado", async () => {
  const { items } = await loadCatalog();
  for (const kind of Object.keys(KINDS)) assert.ok(items.some(x => x.kind === kind), kind);
  assert.ok(items.some(x => x.featured));
});

test("escapeHtml neutraliza código HTML", () => {
  assert.equal(escapeHtml(`<img src=x onerror="alert(1)">`), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.equal(escapeHtml(null), "");
});

test("favoritos: agregar, quitar y recordar entre aperturas", async () => {
  const data = fakeStorage();
  const { createFavorites } = await import("../src/favorites.js");
  const fav = createFavorites();
  assert.equal(fav.toggle("demo:1"), true);
  assert.equal(fav.has("demo:1"), true);
  assert.deepEqual(JSON.parse(data["xuper-web:favoritos"]), ["demo:1"]);
  const reopened = createFavorites();
  assert.equal(reopened.has("demo:1"), true);
  assert.equal(reopened.toggle("demo:1"), false);
  assert.equal(reopened.size, 0);
});

test("favoritos: datos dañados no rompen la app", async () => {
  fakeStorage({ "xuper-web:favoritos": "{esto no es json" });
  const { createFavorites } = await import("../src/favorites.js");
  const fav = createFavorites();
  assert.equal(fav.size, 0);
});

test("favoritos: si el navegador bloquea el almacenamiento, avisa y sigue funcionando", async () => {
  fakeStorage({}, { broken: true });
  const { createFavorites } = await import("../src/favorites.js");
  const fav = createFavorites();
  assert.equal(fav.persistent, false);
  assert.equal(fav.toggle("demo:2"), true);
  assert.equal(fav.has("demo:2"), true);
});
