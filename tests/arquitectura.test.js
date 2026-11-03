// Pruebas de la arquitectura de proveedores con adaptadores SIMULADOS (no existen fuera de
// este archivo): registro, configuración, activación, consultas, respuestas incompletas,
// errores, tiempos de espera, fuentes, reproductor externo, credenciales e independencia.
import test from "node:test";
import assert from "node:assert/strict";

const data = { "supat:ajustes": JSON.stringify({ providers: [] }) };
globalThis.localStorage = {
  getItem: k => (k in data ? data[k] : null),
  setItem: (k, v) => { data[k] = String(v); },
  removeItem: k => { delete data[k]; }
};

const registry = await import("../src/providers/registry.js");
const { catalog, checkSource } = await import("../src/catalog/store.js");
const { LIMITS, validateProviderDef, capabilitiesOf, redact } = await import("../src/providers/contract.js");
const { validateEmbedUrl } = await import("../src/player/embed.js");

LIMITS.timeoutMs = 80;      // para que la prueba de tiempo de espera sea rápida
LIMITS.minRefreshMs = 0;

const SECRET = "clave-super-secreta-123";
const calls = { catalogo: 0 };

const mockCatalog = {
  type: "simulado-catalogo", name: "Catálogo simulado", description: "", origin: "prueba",
  kinds: ["movie", "series"], multiple: true, ttl: 0,
  fields: [{ key: "token", label: "Token", type: "password", required: true }],
  defaults: { token: "" },
  async load(config) {
    calls.catalogo++;
    if (config.token !== SECRET) throw new Error(`Token rechazado: ${config.token}`);
    return {
      items: [
        { id: 1, kind: "movie", title: "Película completa", tmdbId: 550, source: { url: "https://cdn.prueba.test/p.mp4" } },
        { id: 2, kind: "movie", title: "" },                 // incompleta: sin título
        { id: 3, kind: "anime", title: "No declarado" },     // tipo que el proveedor no declaró
        null,                                                // basura
        { id: 4, kind: "series", title: "Serie", imdbId: "tt0944947", seasons: [{ number: 1, episodes: [{ number: 1, title: "Uno" }] }] }
      ]
    };
  }
};

const mockRoto = {
  type: "simulado-roto", name: "Roto", description: "", origin: "prueba", kinds: ["movie"], ttl: 0, fields: [], defaults: {},
  async load() { throw new TypeError("Failed to fetch"); }
};

const mockLento = {
  type: "simulado-lento", name: "Lento", description: "", origin: "prueba", kinds: ["movie"], ttl: 0, fields: [], defaults: {},
  load: () => new Promise(resolve => setTimeout(() => resolve({ items: [] }), 1000))
};

const mockFormato = {
  type: "simulado-formato", name: "Formato raro", description: "", origin: "prueba", kinds: ["movie"], ttl: 0, fields: [], defaults: {},
  async load() { return { resultados: "no es una lista" }; }
};

const mockFuentes = {
  type: "simulado-fuentes", name: "Fuentes simuladas", description: "", origin: "prueba",
  kinds: ["movie"], ttl: 0, fields: [], defaults: {},
  embedOrigins: ["https://reproductor.prueba.test"],
  async findSources(query) {
    if (query.externalIds.tmdb !== 550) return [];
    return [
      { type: "embed", url: "https://reproductor.prueba.test/v?id=550", label: "HD" },
      { type: "embed", url: "https://otro-sitio.test/v?id=550" },   // origen no permitido
      { type: "embed", url: "http://reproductor.prueba.test/v" },   // sin https
      { url: "javascript:alert(1)" }                                // esquema peligroso
    ];
  }
};

const mockFuentesRoto = {
  type: "simulado-fuentes-roto", name: "Fuentes rotas", description: "", origin: "prueba",
  kinds: ["movie"], ttl: 0, fields: [], defaults: {},
  async findSources() { throw new Error("caído"); }
};

test("el contrato rechaza adaptadores inválidos y acepta los válidos", () => {
  assert.ok(validateProviderDef({ type: "X mayúscula", name: "", kinds: ["peliculas"], fields: "no" }).length >= 4);
  assert.match(validateProviderDef({ ...mockCatalog, load: undefined }).join(" "), /al menos/);
  assert.match(validateProviderDef({ ...mockFuentes, embedOrigins: ["http://inseguro.test"] }).join(" "), /iframe inválido/);
  assert.equal(registry.registerProviderType({ type: "malo" }), false);
  assert.equal(registry.PROVIDER_TYPES.malo, undefined);
  for (const def of [mockCatalog, mockRoto, mockLento, mockFormato, mockFuentes, mockFuentesRoto]) {
    assert.deepEqual(validateProviderDef(def), [], def.type);
    assert.equal(registry.registerProviderType(def), true);
  }
  assert.deepEqual(capabilitiesOf(mockFuentes), ["sources", "embed"]);
  assert.deepEqual(capabilitiesOf(mockCatalog), ["catalog"]);
});

let ids = {};
test("registro y configuración: campos obligatorios y activación", async () => {
  for (const def of [mockCatalog, mockRoto, mockLento, mockFormato, mockFuentes, mockFuentesRoto]) ids[def.type] = registry.addInstance(def.type).id;
  const inst = registry.getInstance(ids["simulado-catalogo"]);
  assert.equal(inst.enabled, false);
  assert.match(registry.validateConfig(inst)[0], /Token/);
  registry.updateInstance(inst.id, { config: { token: SECRET }, enabled: true });
  await catalog.load();
  assert.equal(catalog.status(inst.id).state, "ok");
  assert.equal(catalog.all().length, 2);
});

test("respuestas incompletas o de tipos no declarados se descartan con aviso", () => {
  const titles = catalog.all().map(x => x.title).sort();
  assert.deepEqual(titles, ["Película completa", "Serie"]);
  assert.match(catalog.status(ids["simulado-catalogo"]).warning, /descartaron 3/);
  assert.deepEqual(catalog.get(`${ids["simulado-catalogo"]}:1`).externalIds, { tmdb: 550 });
  assert.deepEqual(catalog.get(`${ids["simulado-catalogo"]}:4`).externalIds, { imdb: "tt0944947" });
});

test("independencia: un proveedor roto, lento o con formato inválido no afecta a los demás", async () => {
  for (const t of ["simulado-roto", "simulado-lento", "simulado-formato"]) registry.updateInstance(ids[t], { enabled: true });
  await catalog.load({ force: true });
  assert.equal(catalog.all().length, 2);
  assert.equal(catalog.status(ids["simulado-catalogo"]).state, "ok");
  assert.match(catalog.status(ids["simulado-roto"]).error, /Failed to fetch/);
  assert.match(catalog.status(ids["simulado-lento"]).error, /no respondió/);
  assert.match(catalog.status(ids["simulado-formato"]).error, /formato inválido/);
});

test("desactivar un proveedor saca sus títulos; reactivarlo los vuelve a traer", async () => {
  registry.updateInstance(ids["simulado-catalogo"], { enabled: false });
  await catalog.load();
  assert.equal(catalog.all().length, 0);
  assert.equal(catalog.status(ids["simulado-catalogo"]).state, "disabled");
  registry.updateInstance(ids["simulado-catalogo"], { enabled: true });
  await catalog.load();
  assert.equal(catalog.all().length, 2);
});

test("credenciales: no aparecen en errores, avisos ni en los datos del catálogo", async () => {
  registry.updateInstance(ids["simulado-catalogo"], { config: { token: "otro-secreto-456" } });
  await catalog.load({ force: true, only: ids["simulado-catalogo"] });
  const st = catalog.status(ids["simulado-catalogo"]);
  assert.match(st.error, /Token rechazado: ••••/);
  assert.doesNotMatch(JSON.stringify(st), /otro-secreto-456/);
  registry.updateInstance(ids["simulado-catalogo"], { config: { token: SECRET } });
  await catalog.load({ force: true, only: ids["simulado-catalogo"] });
  assert.doesNotMatch(JSON.stringify(catalog.all()), new RegExp(SECRET));
  assert.equal(redact(`url?token=${SECRET}`, mockCatalog, { token: SECRET }), "url?token=••••");
});

test("límite de consultas: dos actualizaciones seguidas no consultan dos veces", async () => {
  LIMITS.minRefreshMs = 60000;
  const before = calls.catalogo;
  await catalog.load({ force: true, only: ids["simulado-catalogo"] });
  await catalog.load({ force: true, only: ids["simulado-catalogo"] });
  assert.equal(calls.catalogo - before, 0, "la actualización anterior fue hace menos de un minuto");
  LIMITS.minRefreshMs = 0;
});

test("fuentes: se combinan la propia y las de otros proveedores, validadas y aisladas", async () => {
  registry.updateInstance(ids["simulado-fuentes"], { enabled: true });
  registry.updateInstance(ids["simulado-fuentes-roto"], { enabled: true });
  const peli = catalog.get(`${ids["simulado-catalogo"]}:1`);
  const options = await catalog.sourcesFor(peli);
  assert.deepEqual(options.map(o => o.label), ["Catálogo simulado", "Fuentes simuladas · HD"]);
  assert.deepEqual(await options[0].resolve(), { url: "https://cdn.prueba.test/p.mp4", type: "" });
  assert.deepEqual(await options[1].resolve(), { url: "https://reproductor.prueba.test/v?id=550", type: "embed" });
  assert.deepEqual(options[1].embedOrigins, ["https://reproductor.prueba.test"]);
  // Un título sin identificador conocido no recibe fuentes de otros.
  const serie = catalog.get(`${ids["simulado-catalogo"]}:4`);
  assert.equal((await catalog.sourcesFor(serie)).length, 0);
});

test("validación de fuentes y del reproductor externo", () => {
  assert.equal(checkSource({ url: "javascript:alert(1)" }, {}), null);
  assert.equal(checkSource({ url: "no es url" }, {}), null);
  assert.equal(checkSource({ type: "embed", url: "https://x.test/e" }, { embedOrigins: [] }), null);
  assert.equal(validateEmbedUrl("http://a.test/e", ["http://a.test"]).ok, false);
  assert.equal(validateEmbedUrl("https://usuario:clave@a.test/e", ["https://a.test"]).ok, false);
  assert.equal(validateEmbedUrl("https://a.test.malo.test/e", ["https://a.test"]).ok, false);
  assert.equal(validateEmbedUrl("https://a.test/e?x=1", ["https://a.test"]).ok, true);
});

test("quitar un tipo de proveedor no rompe el registro", () => {
  registry.unregisterProviderType("simulado-roto");
  assert.ok(!registry.getInstances().some(i => i.type === "simulado-roto"));
});
