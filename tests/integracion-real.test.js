// Pruebas de INTEGRACIÓN REAL con la fuente de contenido configurada en Ajustes.
//
// No corren con "npm test": necesitan la fuente real configurada en la API local y se activan con
// SUPAT_INTEGRACION=1. Las credenciales NO pasan por acá: se cargan una vez en Ajustes (app local)
// y quedan cifradas en la base local separada (npm run api:real). Ver worker/README.md →
// "Integración real".
//
// Qué verifican, contra la API y el contenido reales:
//   conexión con las dos credenciales · importación (termina sin error) · hay títulos de cada
//   categoría activa · ficha de una serie con temporadas y episodios · enlaces de reproducción de
//   una película, de un episodio y (si hay) de un anime, que responden con video o una lista HLS válida.
// Nunca muestran direcciones, credenciales ni nombres de la fuente: solo estados y tipos.
import { test } from "node:test";
import assert from "node:assert/strict";

const ON = process.env.SUPAT_INTEGRACION === "1";
const API = process.env.SUPAT_API_LOCAL || "http://127.0.0.1:8788";
const AUTH = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const ORIGIN = "http://localhost:5175";
const IMPORT_MINUTES = Number(process.env.SUPAT_IMPORT_MINUTOS || 20);
const skip = ON ? false : "integración real: correr con SUPAT_INTEGRACION=1 (ver worker/README.md)";

let token = "";
async function call(method, path, body) {
  if (!token) {
    const r = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "dueno@prueba.test", password: "clave-de-prueba-1234", returnSecureToken: true }) });
    token = (await r.json()).idToken;
    assert.ok(token, "no se pudo entrar con la cuenta de propietario del emulador (npm run cuenta:local)");
  }
  const res = await fetch(API + path, { method, headers: { Origin: ORIGIN, Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}

// Comprueba que un enlace de reproducción sirva de verdad, sin mostrarlo.
// MP4/WebM: pide el primer KB (Range). HLS: lee la lista y pide el primer segmento (o sub-lista).
async function checkPlayable(url, type, depth = 0) {
  const res = await fetch(url, { headers: { Range: "bytes=0-1023" }, redirect: "follow" });
  const ctype = res.headers.get("content-type") || "";
  const cors = res.headers.get("access-control-allow-origin");
  assert.ok([200, 206].includes(res.status), `el enlace respondió ${res.status}`);
  const head = new Uint8Array(await res.arrayBuffer()).slice(0, 1024);
  const text = new TextDecoder().decode(head);
  const hls = type === "application/x-mpegurl" || /mpegurl/i.test(ctype) || text.startsWith("#EXTM3U");
  if (!hls) return { kind: "archivo", status: res.status, ctype, cors: Boolean(cors) };
  assert.ok(text.startsWith("#EXTM3U"), "la lista HLS no empieza con #EXTM3U");
  if (depth > 1) return { kind: "hls", status: res.status, ctype, cors: Boolean(cors) };
  const full = depth === 0 && head.length >= 1024 ? await (await fetch(url)).text() : text;
  const next = full.split(/\r?\n/).map(l => l.trim()).find(l => l && !l.startsWith("#"));
  assert.ok(next, "la lista HLS no tiene entradas");
  const inner = await checkPlayable(new URL(next, url).toString(), "", depth + 1);
  return { kind: "hls", status: res.status, ctype, cors: Boolean(cors), inner };
}

const report = (label, r) => console.log(`  ${label}: ${r.kind}, HTTP ${r.status}, ${r.ctype || "sin tipo"}, CORS ${r.cors ? "sí" : "no"}${r.inner ? ` → ${r.inner.kind} HTTP ${r.inner.status}, CORS ${r.inner.cors ? "sí" : "no"}` : ""}`);

test("la fuente real está configurada y la prueba de conexión pasa con las dos credenciales", { skip }, async () => {
  const { body } = await call("GET", "/api/admin/source");
  assert.equal(body.source.configured, true, "configurá la fuente en Ajustes (app local) primero");
  assert.ok(body.source.secretsSet.includes("apiKey"), "falta la API Key");
  const t = await call("POST", "/api/admin/source/test", {});
  assert.equal(t.body.ok, true, t.body.message);
  console.log(`  ${t.body.message}`);
});

test("la importación termina sin errores (sigue tandas hasta terminar o hasta el tiempo máximo)", { skip, timeout: (IMPORT_MINUTES + 1) * 60e3 }, async () => {
  let { body } = await call("GET", "/api/admin/source");
  let job = body.source.activeJob;
  if (!job && !body.source.lastSyncAt) job = (await call("POST", "/api/admin/source/sync", { mode: "full" })).body.job;
  const until = Date.now() + IMPORT_MINUTES * 60e3;
  while (job && ["queued", "running"].includes(job.status) && Date.now() < until) {
    job = (await call("POST", `/api/admin/jobs/${job.id}/continue`)).body.job;
    if (job.attempts) await new Promise(r => setTimeout(r, 5000));
  }
  ({ body } = await call("GET", "/api/admin/source"));
  const last = body.source.lastJob;
  console.log(`  trabajo #${last?.id}: ${last?.status}, ${last?.pages} páginas, ${last?.created} nuevos, ${last?.merged} unidos, ${last?.episodes} episodios, ${last?.skipped} descartados`);
  console.log(`  en el catálogo: ${JSON.stringify(body.source.counts)}`);
  assert.notEqual(last?.status, "failed", last?.lastError);
  if (["queued", "running"].includes(last?.status)) console.log(`  (sigue importando: pasaron ${IMPORT_MINUTES} min; el resto lo hace el cron)`);
});

test("hay títulos de cada categoría activa, con metadatos", { skip }, async () => {
  const { body } = await call("GET", "/api/admin/source");
  for (const kind of body.source.categories.filter(c => c !== "episodes")) {
    const list = (await call("GET", `/api/catalog/titles?kind=${kind}&pageSize=20`)).body.items;
    assert.ok(list.length > 0, `no hay títulos de "${kind}"`);
    const withPoster = list.filter(t => t.poster).length, withIds = list.filter(t => Object.keys(t.externalIds).length).length;
    console.log(`  ${kind}: ${list.length} en la primera página · ${withPoster} con póster · ${withIds} con TMDb/IMDb`);
  }
});

test("reproducción real: película", { skip }, async () => {
  const movies = (await call("GET", "/api/catalog/titles?kind=movie&pageSize=10")).body.items;
  assert.ok(movies.length, "no hay películas");
  let lastError = "";
  for (const m of movies.slice(0, 3)) {
    const play = await call("GET", `/api/catalog/titles/${m.id}/play`);
    if (play.status !== 200) { lastError = play.body.error; continue; }
    report("película", await checkPlayable(play.body.url, play.body.type));
    return;
  }
  assert.fail(`ninguna de las primeras películas dio un enlace: ${lastError}`);
});

test("reproducción real: serie con temporadas y episodio", { skip }, async () => {
  const series = (await call("GET", "/api/catalog/titles?kind=series&pageSize=10")).body.items;
  assert.ok(series.length, "no hay series");
  for (const s of series.slice(0, 3)) {
    const detail = (await call("GET", `/api/catalog/titles/${s.id}`)).body;
    const ep = detail.seasons?.[0]?.episodes?.[0];
    if (!ep) continue;
    console.log(`  serie: ${detail.seasons.length} temporada(s), ${detail.seasons.reduce((n, x) => n + x.episodes.length, 0)} episodio(s)`);
    const play = await call("GET", `/api/catalog/titles/${s.id}/play?episode=${ep.id}`);
    assert.equal(play.status, 200, play.body.error);
    report("episodio", await checkPlayable(play.body.url, play.body.type));
    return;
  }
  assert.fail("ninguna de las primeras series tiene temporadas y episodios importados");
});

test("reproducción real: anime (si la categoría tiene títulos)", { skip }, async () => {
  const anime = (await call("GET", "/api/catalog/titles?kind=anime&pageSize=5")).body.items;
  if (!anime.length) { console.log("  sin anime importado: se omite"); return; }
  const a = anime[0];
  const detail = (await call("GET", `/api/catalog/titles/${a.id}`)).body;
  const ep = detail.seasons?.[0]?.episodes?.[0];
  const play = await call("GET", `/api/catalog/titles/${a.id}/play${ep ? `?episode=${ep.id}` : ""}`);
  assert.equal(play.status, 200, play.body.error);
  report("anime", await checkPlayable(play.body.url, play.body.type));
});
