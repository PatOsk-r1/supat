// Pruebas de los lectores de listas y guías, y de las ayudas de Internet Archive.
import test from "node:test";
import assert from "node:assert/strict";
import { parseM3U, entriesToItems, hashId } from "../src/providers/m3u-parser.js";
import { parseXmltv, parseXmltvDate } from "../src/providers/xmltv.js";
import { genresFrom, pickVideoFile, stripHtml } from "../src/providers/internet-archive.js";

const LIST = `#EXTM3U url-tvg="https://ejemplo.test/guia.xml"
#EXTINF:-1 tvg-id="uno.ar" tvg-chno="7" tvg-logo="https://ejemplo.test/uno.png" group-title="Noticias",Canal Uno
https://ejemplo.test/live/uno.m3u8
#EXTINF:-1 group-title="Deportes;HD",Canal Dos
#EXTVLCOPT:http-user-agent=algo
https://ejemplo.test/live/dos.m3u8
# comentario
#EXTINF:-1 group-title="Películas",Una Película (1950)
https://ejemplo.test/movie/peli.mp4
#EXTINF:-1 group-title="Series",Mi Serie S01E02
https://ejemplo.test/series/s1e2.mp4
#EXTINF:-1 group-title="Series",Mi Serie S01 E01
https://ejemplo.test/series/s1e1.mp4
#EXTINF:-1,Sin dirección válida
no-es-una-url
`;

test("M3U: lee la cabecera, atributos, grupos y descarta líneas inválidas", () => {
  const { header, entries } = parseM3U(LIST);
  assert.equal(header["url-tvg"], "https://ejemplo.test/guia.xml");
  assert.equal(entries.length, 5);
  assert.equal(entries[0].name, "Canal Uno");
  assert.equal(entries[0].attrs["tvg-id"], "uno.ar");
  assert.equal(entries[1].url, "https://ejemplo.test/live/dos.m3u8");
});

test("M3U: separa canales, películas y series con temporadas ordenables", () => {
  const items = entriesToItems(parseM3U(LIST).entries);
  const live = items.filter(x => x.kind === "live");
  assert.deepEqual(live.map(x => [x.title, x.channelNumber, x.tvgId]), [["Canal Uno", 7, "uno.ar"], ["Canal Dos", 2, ""]]);
  assert.deepEqual(live[1].categories, ["Deportes", "HD"]);
  assert.equal(items.find(x => x.kind === "movie").title, "Una Película (1950)");
  const serie = items.find(x => x.kind === "series");
  assert.equal(serie.title, "Mi Serie");
  assert.deepEqual(serie.seasons[0].episodes.map(e => e.number).sort(), [1, 2]);
});

test("M3U: nombres y atributos con comas", () => {
  const { entries } = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="A, B" group-title="X,Y",Señal (Apple, fMP4)\nhttps://a/b.m3u8');
  assert.equal(entries[0].name, "Señal (Apple, fMP4)");
  assert.equal(entries[0].attrs["tvg-name"], "A, B");
  assert.equal(entries[0].attrs["group-title"], "X,Y");
});

test("ids estables a partir de la dirección", () => {
  assert.equal(hashId("https://a/b"), hashId("https://a/b"));
  assert.notEqual(hashId("https://a/b"), hashId("https://a/c"));
});

test("XMLTV: fechas con zona horaria", () => {
  assert.equal(parseXmltvDate("20261102193000 +0000"), Date.UTC(2026, 10, 2, 19, 30));
  assert.equal(parseXmltvDate("20261102193000 -0300"), Date.UTC(2026, 10, 2, 22, 30));
});

test("XMLTV: programas dentro de la ventana, ordenados y con entidades decodificadas", () => {
  const now = Date.UTC(2026, 10, 2, 20, 0);
  const xml = `<tv>
    <programme start="20261102210000 +0000" stop="20261102220000 +0000" channel="uno.ar"><title lang="es">Película &amp; algo</title></programme>
    <programme start="20261102193000 +0000" stop="20261102210000 +0000" channel="uno.ar"><title>Noticiero</title><desc>Resumen del día</desc></programme>
    <programme start="20261001000000 +0000" stop="20261001010000 +0000" channel="uno.ar"><title>Viejo</title></programme>
  </tv>`;
  const guide = parseXmltv(xml, { now });
  assert.deepEqual(guide["uno.ar"].map(p => p.title), ["Noticiero", "Película & algo"]);
  assert.equal(guide["uno.ar"][0].description, "Resumen del día");
});

test("Internet Archive: géneros en español, limpieza de HTML y elección de archivo", () => {
  assert.deepEqual(genresFrom(["Comedy", "Silent film"]), ["Comedia", "Cine mudo"]);
  assert.deepEqual(genresFrom([]), ["Clásicos"]);
  assert.equal(stripHtml("Hola<br>mundo &amp; <b>más</b>"), "Hola mundo & más");
  const file = pickVideoFile([
    { name: "a_512kb.mp4", format: "512Kb MPEG4" },
    { name: "a.mp4", format: "h.264" },
    { name: "a.torrent", format: "Archive BitTorrent" }
  ]);
  assert.equal(file.name, "a.mp4");
  assert.equal(pickVideoFile([{ name: "x.torrent", format: "Archive BitTorrent" }]), null);
});
