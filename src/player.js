// Reproductor separado del catálogo: recibe un elemento y un contenedor, y se encarga
// de mostrar el video o un mensaje honesto. Nunca muestra "reproduciendo" si el video
// no arrancó de verdad. Devuelve una función para limpiar al salir de la vista.
import { escapeHtml } from "./util.js";

const HLS = "application/x-mpegurl";

function guessType(url) {
  const path = url.split(/[?#]/)[0].toLowerCase();
  if (path.endsWith(".m3u8")) return HLS;
  if (path.endsWith(".mp4") || path.endsWith(".m4v")) return "video/mp4";
  if (path.endsWith(".webm")) return "video/webm";
  return "";
}

function message(container, title, detail) {
  container.innerHTML = `<div class="player-message" role="status">
    <span class="player-icon" aria-hidden="true">▶</span>
    <strong>${escapeHtml(title)}</strong>
    <small>${escapeHtml(detail)}</small>
  </div>`;
}

export function mountPlayer(container, item) {
  if (!item.source) {
    message(container, "Este elemento no tiene una fuente de video",
      item.isDemo
        ? "Es contenido de demostración: no hay transmisión real asociada."
        : "La fuente todavía no informó una dirección de video para este título.");
    return () => {};
  }

  const { url } = item.source;
  const type = (item.source.type || guessType(url)).toLowerCase();
  const probe = document.createElement("video");

  if (type === HLS && !probe.canPlayType(HLS)) {
    message(container, "Formato no compatible con este navegador",
      "Es una transmisión HLS (.m3u8). Safari la reproduce directo; para Chrome y Firefox hace falta sumar un reproductor HLS.");
    return () => {};
  }
  if (type && type !== HLS && !probe.canPlayType(type)) {
    message(container, "Formato no compatible", `Este navegador no puede reproducir videos de tipo ${type}.`);
    return () => {};
  }

  container.innerHTML = `<video controls playsinline preload="metadata"></video>
    <p class="player-status" role="status" aria-live="polite">Cargando video…</p>`;
  const video = container.querySelector("video");
  const status = container.querySelector(".player-status");
  const setStatus = text => { status.textContent = text; };

  const handlers = {
    playing: () => setStatus("Reproduciendo"),
    pause: () => setStatus("En pausa"),
    waiting: () => setStatus("Cargando…"),
    loadedmetadata: () => setStatus("Listo para reproducir"),
    ended: () => setStatus("Terminó la reproducción"),
    error: () => message(container, "No se pudo cargar el video",
      "La dirección no respondió o el archivo no es válido. Revisá que la fuente esté disponible y autorizada.")
  };
  for (const [name, fn] of Object.entries(handlers)) video.addEventListener(name, fn);
  video.src = url;

  return () => {
    for (const [name, fn] of Object.entries(handlers)) video.removeEventListener(name, fn);
    video.pause();
    video.removeAttribute("src");
    video.load();
  };
}
