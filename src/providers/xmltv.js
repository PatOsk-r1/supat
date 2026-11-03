// Lector de guías de programación XMLTV (el formato estándar de las guías de IPTV).
// Solo guarda los programas de una ventana de tiempo (por defecto, de 3 h atrás a 36 h adelante)
// para que la guía no ocupe demasiado.

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, code) => {
      if (code[0] === "#") return String.fromCodePoint(code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10));
      return ENTITIES[code] ?? m;
    })
    .trim();
}

// "20261102193000 +0000" → milisegundos.
export function parseXmltvDate(s) {
  const m = String(s).trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/);
  if (!m) return NaN;
  const [, y, mo, d, h, mi, sec = "00", tz = "+0000"] = m;
  const offset = (tz[0] === "-" ? -1 : 1) * (parseInt(tz.slice(1, 3), 10) * 60 + parseInt(tz.slice(3), 10));
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec) - offset * 60000;
}

const attr = (attrs, name) => attrs.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? "";

export function parseXmltv(text, { now = Date.now(), before = 3 * 3600e3, after = 36 * 3600e3 } = {}) {
  const from = now - before, to = now + after;
  const guide = {};
  for (const [, attrs, body] of String(text).matchAll(/<programme\b([^>]*)>([\s\S]*?)<\/programme>/g)) {
    const start = parseXmltvDate(attr(attrs, "start"));
    const stop = parseXmltvDate(attr(attrs, "stop"));
    if (!Number.isFinite(start) || !Number.isFinite(stop) || stop < from || start > to) continue;
    const channel = decode(attr(attrs, "channel"));
    const title = body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/)?.[1];
    const desc = body.match(/<desc\b[^>]*>([\s\S]*?)<\/desc>/)?.[1];
    (guide[channel] ||= []).push({ start, stop, title: title ? decode(title) : "Sin título", description: desc ? decode(desc).slice(0, 300) : "" });
  }
  for (const list of Object.values(guide)) list.sort((a, b) => a.start - b.start);
  return guide;
}

// Descarga una guía; si termina en .gz la descomprime en el navegador.
export async function fetchXmltv(url, fetchFn = fetch) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`La guía respondió con un error (${res.status}).`);
  if (/\.gz(\?|$)/i.test(url) && typeof DecompressionStream !== "undefined") {
    return new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).text();
  }
  return res.text();
}
