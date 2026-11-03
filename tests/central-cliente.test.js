// Catálogo central del lado del navegador: conversión de títulos y datos del panel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toRawItem } from "../src/providers/central.js";
import { normalizeItem } from "../src/catalog/model.js";
import { maskEmail } from "../src/ui/views/central-admin.js";
import { validateProviderDef } from "../src/providers/contract.js";
import central from "../src/providers/central.js";

test("el adaptador del catálogo central cumple el contrato de proveedores", () => {
  assert.deepEqual(validateProviderDef(central), []);
});

test("un título del servidor se convierte en un elemento normal del catálogo", () => {
  const movie = toRawItem({ id: 7, kind: "movie", title: "Uno", year: 1999, categories: ["Drama"], externalIds: { tmdb: 101, tmdbType: "movie", imdb: "tt0000101" }, hasEpisodes: false });
  const item = normalizeItem(movie, { id: "central", label: "Catálogo central" }, central);
  assert.equal(item.id, "central:7");
  assert.deepEqual(item.source, { lazy: true }); // la fuente la resuelve el servidor al reproducir
  assert.deepEqual(item.externalIds, { tmdb: 101, imdb: "tt0000101" });
  const series = normalizeItem(toRawItem({ id: 8, kind: "series", title: "Serie", hasEpisodes: true }), { id: "central" }, central);
  assert.equal(series.lazySeasons, true);
  assert.equal(series.source, null);
});

test("el panel muestra el correo enmascarado", () => {
  assert.equal(maskEmail("ana.perez@correo.com"), "an•••@correo.com");
  assert.equal(maskEmail(""), "—");
});
