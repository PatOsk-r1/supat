// Pruebas de las piezas de src/app: rutas, ajustes, progreso y caché.
import test from "node:test";
import assert from "node:assert/strict";

// Almacenamiento falso (en Node no existe localStorage). Se crea antes de importar los módulos.
const data = {};
globalThis.localStorage = {
  getItem: k => (k in data ? data[k] : null),
  setItem: (k, v) => { data[k] = String(v); },
  removeItem: k => { delete data[k]; }
};

const { parseRoute, hrefFor } = await import("../src/app/router.js");
const { settings, DEFAULT_SETTINGS } = await import("../src/app/settings.js");
const { progress } = await import("../src/app/progress.js");
const { cacheGet, cacheSet, cacheDelete } = await import("../src/app/cache.js");

test("rutas: secciones, detalle, reproducción y episodios", () => {
  assert.deepEqual(parseRoute(""), { name: "inicio" });
  assert.deepEqual(parseRoute("#/tv"), { name: "tv" });
  assert.deepEqual(parseRoute("#/cualquiera"), { name: "inicio" });
  assert.deepEqual(parseRoute("#/titulo/demo%3A1"), { name: "titulo", id: "demo:1" });
  assert.deepEqual(parseRoute("#/ver/demo%3A2"), { name: "ver", id: "demo:2", episodeId: null });
  assert.deepEqual(parseRoute("#/ver/a%3A1/a%3A1%2Fs1e2"), { name: "ver", id: "a:1", episodeId: "a:1/s1e2" });
  assert.equal(parseRoute("#/ver/%E0%A4%A").name, "ver"); // dirección mal codificada: no rompe
});

test("rutas: los enlaces generados se leen igual", () => {
  const item = { id: "m3u:canal/1" };
  assert.deepEqual(parseRoute(hrefFor.watch(item, { id: "x y" })), { name: "ver", id: "m3u:canal/1", episodeId: "x y" });
  assert.deepEqual(parseRoute(hrefFor.detail(item)), { name: "titulo", id: "m3u:canal/1" });
});

test("ajustes: valores por defecto, cambios guardados y aviso a los suscriptores", () => {
  assert.equal(settings.get("player"), DEFAULT_SETTINGS.player);
  let notified = null;
  const off = settings.onChange((k, v) => { notified = [k, v]; });
  settings.set("language", "es-AR");
  assert.deepEqual(notified, ["language", "es-AR"]);
  assert.equal(JSON.parse(data["xuper-web:ajustes"]).language, "es-AR");
  off();
  settings.reset();
  assert.equal(settings.get("language"), "es-ES");
});

test("progreso: guarda, retoma, ignora lo muy corto y marca terminado", () => {
  progress.save("a", 5, 100);
  assert.equal(progress.get("a"), null);
  progress.save("a", 42.7, 1000, { title: "Peli" });
  assert.equal(progress.resumeTime("a"), 42);
  assert.equal(progress.recent()[0].title, "Peli");
  progress.save("a", 980, 1000);
  assert.equal(progress.isFinished("a"), true);
  assert.equal(progress.resumeTime("a"), 0);
  assert.equal(progress.recent().length, 0);
});

test("caché: guarda y borra (en Node usa memoria)", async () => {
  await cacheSet("k", { n: 1 });
  assert.deepEqual(await cacheGet("k"), { n: 1 });
  await cacheDelete("k");
  assert.equal(await cacheGet("k"), undefined);
});
