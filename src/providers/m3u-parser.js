// Lector de listas M3U / M3U8 (el formato de listas de IPTV y de VLC).
// Ejemplo de entrada:
//   #EXTINF:-1 tvg-id="canal1" tvg-logo="https://…/logo.png" group-title="Noticias",Canal 1
//   https://servidor/canal1.m3u8
// No trae ninguna lista: solo interpreta la que cargue el usuario.

const ATTR = /([\w-]+)="([^"]*)"/g;

// El nombre empieza después de la primera coma que no está entre comillas
// (los atributos pueden tener comas adentro, y el nombre también).
function splitExtinf(line) {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === "," && !quoted) return [line.slice(0, i), line.slice(i + 1)];
  }
  return [line, ""];
}

// Identificador corto y estable a partir de un texto (la dirección del canal, por ejemplo).
export function hashId(text) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822507) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}

export function parseM3U(text) {
  const lines = String(text).replace(/^﻿/, "").split(/\r?\n/);
  const header = {};
  const entries = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTM3U")) {
      for (const [, k, v] of line.matchAll(ATTR)) header[k] = v;
    } else if (line.startsWith("#EXTINF")) {
      const [meta, name] = splitExtinf(line);
      const attrs = {};
      for (const [, k, v] of meta.matchAll(ATTR)) attrs[k.toLowerCase()] = v;
      current = { name: name.trim() || attrs["tvg-name"] || "", attrs };
    } else if (line.startsWith("#EXTGRP:")) {
      if (current) current.attrs["group-title"] ||= line.slice(8).trim();
    } else if (!line.startsWith("#")) {
      if (!/^(https?|rtmp|rtsp):\/\//i.test(line)) { current = null; continue; }
      const entry = current || { name: "", attrs: {} };
      entry.url = line;
      entry.name ||= entry.attrs["tvg-name"] || line.split("/").pop();
      entries.push(entry);
      current = null;
    }
  }
  return { header, entries };
}

const EPISODE = /^(.*?)[\s._-]*S(\d{1,2})[\s._-]*E(\d{1,3})\b/i;

// Convierte las entradas de la lista en elementos del catálogo: canales, películas y series.
export function entriesToItems(entries) {
  const items = [];
  const series = new Map();
  let number = 0;
  for (const entry of entries) {
    const { attrs, url, name } = entry;
    const groups = (attrs["group-title"] || "").split(";").map(s => s.trim()).filter(Boolean);
    const path = url.split("?")[0].toLowerCase();
    const isSeries = /\/series\//.test(path) || EPISODE.test(name);
    const isMovie = !isSeries && /\/movie\//.test(path);

    if (isSeries) {
      const m = name.match(EPISODE);
      const seriesName = (m ? m[1] : name).replace(/[\s._-]+$/, "").trim() || name;
      const key = seriesName.toLowerCase();
      if (!series.has(key)) {
        series.set(key, { id: `s-${hashId(key)}`, kind: "series", title: seriesName, categories: groups, poster: attrs["tvg-logo"] || "", seasons: new Map() });
      }
      const s = series.get(key);
      const seasonNumber = m ? Number(m[2]) : 1;
      if (!s.seasons.has(seasonNumber)) s.seasons.set(seasonNumber, []);
      const eps = s.seasons.get(seasonNumber);
      const epNumber = m ? Number(m[3]) : eps.length + 1;
      eps.push({ id: `s${seasonNumber}e${epNumber}-${hashId(url)}`, number: epNumber, title: m ? `Episodio ${epNumber}` : name, source: { url } });
    } else if (isMovie) {
      items.push({ id: `m-${hashId(url)}`, kind: "movie", title: name, categories: groups, poster: attrs["tvg-logo"] || "", source: { url } });
    } else {
      number++;
      items.push({
        id: `c-${hashId(url)}`, kind: "live", title: name, categories: groups,
        logo: attrs["tvg-logo"] || "", tvgId: attrs["tvg-id"] || "",
        channelNumber: Number(attrs["tvg-chno"]) || number, source: { url }
      });
    }
  }
  for (const s of series.values()) {
    items.push({ ...s, seasons: [...s.seasons.entries()].map(([n, episodes]) => ({ number: n, episodes })) });
  }
  return items;
}
