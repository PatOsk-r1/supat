// Lista de canales M3U (y guía XMLTV opcional) que carga el usuario.
// La app no trae ninguna lista: solo usa la que el usuario tenga permiso de usar.
import { cacheGet } from "../app/cache.js";
import { parseM3U, entriesToItems } from "./m3u-parser.js";
import { parseXmltv, fetchXmltv } from "./xmltv.js";

const CORS_HELP = "Puede que el servidor no permita que otras páginas lean la lista (bloqueo CORS del navegador). " +
  "Probá descargar el archivo y cargarlo en \"Archivo de lista\".";

async function downloadText(url, what) {
  let res;
  try { res = await fetch(url); } catch { throw new Error(`No se pudo descargar ${what}. ${CORS_HELP}`); }
  if (!res.ok) throw new Error(`No se pudo descargar ${what}: el servidor respondió ${res.status}.`);
  return res.text();
}

export default {
  type: "m3u",
  name: "Lista de canales (M3U)",
  description: "Canales de TV en vivo (y películas o series si la lista las incluye) desde una lista M3U, con guía de programación XMLTV opcional.",
  origin: "La lista que cargues",
  license: "Usá solo listas que tengas permiso de usar",
  kinds: ["live", "movie", "series"],
  multiple: true,
  ttl: 12 * 3600e3,
  defaults: { url: "", file: "", epgUrl: "" },
  notice: "Algunas transmisiones no permiten reproducirse desde una página web aunque funcionen en VLC. En ese caso el reproductor lo va a indicar.",
  fields: [
    { key: "url", label: "Dirección de la lista (http/https)", type: "url", placeholder: "https://…/lista.m3u", help: "O cargá un archivo abajo. Si completás las dos, se usa la dirección." },
    { key: "file", label: "Archivo de lista (.m3u / .m3u8)", type: "file", accept: ".m3u,.m3u8,audio/x-mpegurl,application/x-mpegurl,text/plain" },
    { key: "epgUrl", label: "Guía de programación XMLTV (opcional)", type: "url", placeholder: "https://…/guia.xml", help: "Si la lista ya indica una guía (url-tvg), se usa esa cuando este campo está vacío." }
  ],
  validate(config) {
    return config.url?.trim() || config.file ? [] : ["Completá la dirección de la lista o cargá un archivo."];
  },
  async load(config, { instanceId }) {
    const text = config.url?.trim()
      ? await downloadText(config.url.trim(), "la lista")
      : await cacheGet(`archivo:${instanceId}`);
    if (!text) throw new Error("No se encontró el archivo de la lista. Volvé a cargarlo.");
    const { header, entries } = parseM3U(text);
    if (!entries.length) throw new Error("La lista no tiene entradas válidas (¿es un archivo M3U?).");
    const items = entriesToItems(entries);

    let epg = null, warning = "";
    const epgUrl = config.epgUrl?.trim() || header["url-tvg"] || header["x-tvg-url"] || "";
    if (epgUrl) {
      try {
        epg = parseXmltv(await fetchXmltv(epgUrl.split(",")[0].trim()));
      } catch (err) {
        warning = `La guía de programación no se pudo cargar: ${err.message}`;
      }
    }
    return { items, epg, warning };
  }
};
