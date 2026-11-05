// Subtítulos externos para el reproductor.
// Los navegadores solo entienden WebVTT. Los SRT se convierten acá, en el navegador (sin proxy y
// sin pasar por el servidor): se descargan (el servidor de subtítulos tiene que permitir CORS),
// se convierten a WebVTT y se cargan desde una URL local (blob:).

// SRT → WebVTT: encabezado WEBVTT, comas de milisegundos → puntos, sin índices numéricos.
export function srtToVtt(srt) {
  const text = String(srt || "").replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
  if (!text) return "WEBVTT\n";
  const blocks = text.split(/\n{2,}/).map(block => {
    const lines = block.split("\n");
    if (/^\d+$/.test(lines[0].trim()) && lines[1]?.includes("-->")) lines.shift();
    if (lines[0]?.includes("-->")) lines[0] = lines[0].replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2").replace(/(^|\s)(\d{1,2}:\d{2}),(\d{3})/g, "$100:$2.$3");
    return lines.join("\n");
  });
  return `WEBVTT\n\n${blocks.join("\n\n")}\n`;
}

export const isSrt = t => t?.format === "srt" || /\.srt(\?|#|$)/i.test(String(t?.url || ""));

// Devuelve una URL que el elemento <track> puede usar: la original (WebVTT) o un blob convertido (SRT).
export async function trackUrl(t, fetchImpl = fetch) {
  if (!isSrt(t)) return t.url;
  const res = await fetchImpl(t.url, { mode: "cors" });
  if (!res.ok) throw new Error(`Los subtítulos respondieron ${res.status}.`);
  const vtt = srtToVtt(await res.text());
  return URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
}
