// Rendimiento con listas grandes (generadas en memoria, sin internet).
import test from "node:test";
import assert from "node:assert/strict";
import { parseM3U, entriesToItems } from "../src/providers/m3u-parser.js";
import { parseXmltv } from "../src/providers/xmltv.js";
import { normalizeItem } from "../src/catalog/model.js";
import { searchItems } from "../src/ui/views/lists.js";

const N = 5000;

test(`lista de ${N} canales: leer, convertir y buscar en menos de 1 segundo`, () => {
  let text = "#EXTM3U\n";
  for (let i = 0; i < N; i++) text += `#EXTINF:-1 tvg-id="c${i}" group-title="Grupo ${i % 40}",Canal número ${i}\nhttps://ejemplo.test/live/${i}.m3u8\n`;
  const t0 = performance.now();
  const raw = entriesToItems(parseM3U(text).entries);
  const items = raw.map(x => normalizeItem(x, { id: "m3u", label: "Lista" }, {}));
  const found = searchItems(items, "numero 4999");
  const ms = performance.now() - t0;
  assert.equal(items.length, N);
  assert.equal(found[0].title, "Canal número 4999");
  assert.ok(ms < 1000, `tardó ${Math.round(ms)} ms`);
  console.log(`  ${N} canales: ${Math.round(ms)} ms`);
});

test("guía XMLTV de 20.000 programas en menos de 1 segundo", () => {
  const now = Date.UTC(2026, 10, 3, 12);
  const pad = n => String(n).padStart(2, "0");
  const fmt = ms => { const d = new Date(ms); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00 +0000`; };
  let xml = "<tv>";
  for (let c = 0; c < 500; c++) for (let p = 0; p < 40; p++) {
    const start = now - 6 * 3600e3 + p * 3600e3;
    xml += `<programme start="${fmt(start)}" stop="${fmt(start + 3600e3)}" channel="c${c}"><title>Programa ${p}</title></programme>`;
  }
  xml += "</tv>";
  const t0 = performance.now();
  const guide = parseXmltv(xml, { now });
  const ms = performance.now() - t0;
  assert.equal(Object.keys(guide).length, 500);
  assert.ok(guide.c0.length < 40, "descarta lo que está fuera de la ventana de tiempo");
  assert.ok(ms < 1000, `tardó ${Math.round(ms)} ms`);
  console.log(`  20.000 programas: ${Math.round(ms)} ms`);
});
