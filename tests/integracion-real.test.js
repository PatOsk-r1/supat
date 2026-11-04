// Pruebas de INTEGRACIÓN REAL con Fuente A y/o Fuente B configuradas en Ajustes.
//
// No corren con "npm test": se activan con SUPAT_INTEGRACION=1 y necesitan la API local con la base
// separada (npm run api:real) y las fuentes configuradas y activadas desde Ajustes de la app local.
// Las credenciales NO pasan por acá. Se prueba cada fuente configurada, por separado.
//
// Verifican contra las APIs y el contenido reales: conexión, catálogo de cada categoría, importación,
// series con temporadas y episodios, y que los enlaces de reproducción (película y episodio) de cada
// fuente respondan con video o una lista HLS válida.
// Nunca muestran direcciones, credenciales ni nombres: solo estados y tipos.
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

async function activeSlots() {
  const { body } = await call("GET", "/api/admin/sources");
  const slots = Object.values(body.sources).filter(s => s.configured && s.enabled);
  assert.ok(slots.length, "no hay ninguna fuente configurada y activada en Ajustes (app local)");
  return slots;
}

// Comprueba que un enlace sirva de verdad, sin mostrarlo (MP4: primer KB; HLS: lista + primer segmento).
async function checkPlayable(url, type, depth = 0) {
  const res = await fetch(url, { headers: { Range: "bytes=0-1023" }, redirect: "follow" });
  const ctype = res.headers.get("content-type") || "";
  const cors = Boolean(res.headers.get("access-control-allow-origin"));
  assert.ok([200, 206].includes(res.status), `el enlace respondió ${res.status}`);
  const text = new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()).slice(0, 1024));
  const hls = type === "application/x-mpegurl" || /mpegurl/i.test(ctype) || text.startsWith("#EXTM3U");
  if (!hls || depth > 1) return { kind: hls ? "hls" : "archivo", status: res.status, ctype, cors };
  assert.ok(text.startsWith("#EXTM3U"), "la lista HLS no empieza con #EXTM3U");
  const full = depth === 0 ? await (await fetch(url)).text() : text;
  const next = full.split(/\r?\n/).map(l => l.trim()).find(l => l && !l.startsWith("#"));
  assert.ok(next, "la lista HLS no tiene entradas");
  return { kind: "hls", status: res.status, ctype, cors, inner: await checkPlayable(new URL(next, url).toString(), "", depth + 1) };
}
const report = (label, r) => console.log(`  ${label}: ${r.kind}, HTTP ${r.status}, ${r.ctype || "sin tipo"}, CORS ${r.cors ? "sí" : "no"}${r.inner ? ` → ${r.inner.kind} HTTP ${r.inner.status}, CORS ${r.inner.cors ? "sí" : "no"}` : ""}`);

test("cada fuente activa: la conexión pasa", { skip }, async () => {
  for (const s of await activeSlots()) {
    const r = await call("POST", `/api/admin/sources/${s.slot}/test-connection`);
    console.log(`  ${s.label}: ${r.body.message}`);
    assert.equal(r.body.ok, true, `${s.label}: ${r.body.message}`);
  }
});

test("cada fuente activa: el catálogo de cada categoría configurada trae resultados válidos", { skip }, async () => {
  for (const s of await activeSlots()) {
    for (const cap of s.capabilities.filter(c => ["movie", "series", "anime", "episodes"].includes(c.id))) {
      if (!cap.supported) { console.log(`  ${s.label} · ${cap.label}: no soportado`); continue; }
      const r = await call("POST", `/api/admin/sources/${s.slot}/test-catalog`, { kind: cap.id });
      console.log(`  ${s.label} · ${cap.label}: ${r.body.message}${r.body.coverage ? ` · ${JSON.stringify(r.body.coverage)}` : ""}`);
      assert.equal(r.body.ok, true, `${s.label} · ${cap.label}: ${r.body.message}`);
    }
  }
});

test("cada fuente activa: la importación avanza sin fallar", { skip, timeout: (IMPORT_MINUTES + 1) * 60e3 }, async () => {
  const until = Date.now() + IMPORT_MINUTES * 60e3;
  for (const s of await activeSlots()) {
    let job = s.activeJob;
    if (!job && !s.lastSyncAt) job = (await call("POST", `/api/admin/sources/${s.slot}/import`, { mode: "full" })).body.job;
    while (job && ["queued", "running"].includes(job.status) && !job.paused && Date.now() < until) {
      job = (await call("POST", `/api/admin/jobs/${job.id}/continue`)).body.job;
      if (job.attempts) await new Promise(r => setTimeout(r, 5000));
    }
    const view = (await call("GET", "/api/admin/sources")).body.sources[s.slot];
    const last = view.lastJob;
    console.log(`  ${s.label}: trabajo #${last?.id} ${last?.status}, ${last?.pages} páginas, ${last?.created} nuevos, ${last?.merged} unidos, ${last?.episodes} episodios · catálogo ${JSON.stringify(view.counts)}`);
    assert.notEqual(last?.status, "failed", `${s.label}: ${last?.lastError}`);
  }
});

test("cada fuente activa: reproducción de película y de episodio (prueba del servidor)", { skip }, async () => {
  for (const s of await activeSlots()) {
    const caps = Object.fromEntries(s.capabilities.map(c => [c.id, c.supported]));
    for (const [kind, cap] of [["movie", "playMovie"], ["episode", "playEpisode"]]) {
      if (!caps[cap]) { console.log(`  ${s.label} · ${kind}: no soportado`); continue; }
      const r = await call("POST", `/api/admin/sources/${s.slot}/test-playback`, { kind });
      console.log(`  ${s.label} · ${kind}: ${r.body.message}`);
      assert.equal(r.body.ok, true, `${s.label} · ${kind}: ${r.body.message}`);
    }
  }
});

test("reproducción como la pide el navegador: película y episodio de cada fuente con títulos importados", { skip }, async () => {
  for (const s of await activeSlots()) {
    const movies = (await call("GET", "/api/catalog/titles?kind=movie&pageSize=20")).body.items;
    let done = false;
    for (const m of movies) {
      const src = (await call("GET", `/api/catalog/titles/${m.id}/sources`)).body.sources.find(x => x.label === s.form.displayName);
      if (!src) continue;
      const play = await call("GET", `/api/catalog/titles/${m.id}/play?source=${src.id}`);
      assert.equal(play.status, 200, play.body.error);
      report(`${s.label} · película`, await checkPlayable(play.body.url, play.body.type));
      done = true;
      break;
    }
    if (!done) console.log(`  ${s.label} · película: sin películas importadas de esta fuente en la primera página`);
    const series = (await call("GET", "/api/catalog/titles?kind=series&pageSize=20")).body.items;
    for (const t of series) {
      const detail = (await call("GET", `/api/catalog/titles/${t.id}`)).body;
      const ep = detail.seasons?.[0]?.episodes?.[0];
      if (!ep) continue;
      const src = (await call("GET", `/api/catalog/titles/${t.id}/sources?episode=${ep.id}`)).body.sources.find(x => x.label === s.form.displayName);
      if (!src) continue;
      console.log(`  ${s.label} · serie: ${detail.seasons.length} temporada(s)`);
      const play = await call("GET", `/api/catalog/titles/${t.id}/play?episode=${ep.id}&source=${src.id}`);
      assert.equal(play.status, 200, play.body.error);
      report(`${s.label} · episodio`, await checkPlayable(play.body.url, play.body.type));
      break;
    }
  }
});

test("la configuración devuelta al navegador no tiene credenciales", { skip }, async () => {
  const { body } = await call("GET", "/api/admin/sources");
  for (const s of Object.values(body.sources)) {
    for (const k of ["apiKey", "token", "username", "password", "playbackKey", "authHeaders", "authParams"]) assert.equal(s.form[k], undefined);
  }
});
