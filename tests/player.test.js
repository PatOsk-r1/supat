// Pruebas del motor del reproductor que no necesitan un navegador.
import test from "node:test";
import assert from "node:assert/strict";
import { detectType, HLS_TYPE } from "../src/player/engine.js";
import { formatTime } from "../src/player/player.js";

test("detecta el tipo por extensión o por el tipo declarado", () => {
  assert.equal(detectType("https://x/a/master.m3u8?token=1"), HLS_TYPE);
  assert.equal(detectType("https://x/peli.MP4"), "video/mp4");
  assert.equal(detectType("https://x/peli.webm#t=2"), "video/webm");
  assert.equal(detectType("https://x/stream", "application/vnd.apple.mpegurl"), HLS_TYPE);
  assert.equal(detectType("https://x/stream"), "");
});

test("formato de tiempo", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(65.9), "1:05");
  assert.equal(formatTime(3725), "1:02:05");
  assert.equal(formatTime(NaN), "0:00");
});
