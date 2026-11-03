// Motor de reproducción: decide CÓMO se reproduce una dirección.
//  - HLS (.m3u8): primero el soporte nativo del navegador (Safari, Chrome reciente);
//    si no hay, o falla, hls.js (se descarga solo en ese momento).
//  - MP4 / WebM / otros: el video nativo del navegador.
export const HLS_TYPE = "application/x-mpegurl";

export function detectType(url, type = "") {
  const t = type.toLowerCase();
  if (t.includes("mpegurl")) return HLS_TYPE;
  if (t) return t;
  const path = String(url).split(/[?#]/)[0].toLowerCase();
  if (path.endsWith(".m3u8")) return HLS_TYPE;
  if (path.endsWith(".mp4") || path.endsWith(".m4v")) return "video/mp4";
  if (path.endsWith(".webm")) return "video/webm";
  if (path.endsWith(".ogv")) return "video/ogg";
  if (path.endsWith(".mkv")) return "video/x-matroska";
  return "";
}

// Error con un código para que la interfaz muestre un mensaje claro.
export class PlaybackError extends Error {
  constructor(code, detail = "") {
    super(detail || code);
    this.code = code; // "unsupported" | "network" | "media" | "hls-unavailable"
  }
}

function attachNative(video, url) {
  video.src = url;
  return { engine: "native", destroy() { video.removeAttribute("src"); video.load(); } };
}

async function attachHlsJs(video, url, onFatal, onLevels) {
  let Hls;
  try {
    ({ default: Hls } = await import("hls.js/light"));
  } catch {
    throw new PlaybackError("hls-unavailable", "No se pudo cargar el módulo HLS.");
  }
  if (!Hls.isSupported()) throw new PlaybackError("unsupported", "Este navegador no puede reproducir HLS.");

  const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
  let networkRetries = 0;
  let mediaRecovered = false;
  hls.on(Hls.Events.ERROR, (_e, data) => {
    if (!data.fatal) return;
    // Si ni siquiera se pudo leer la lista principal, reintentar no sirve (hls.js ya reintentó).
    const manifestFailed = /^manifest/i.test(data.details || "");
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 2 && !manifestFailed) {
      networkRetries++;
      hls.startLoad();
    } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaRecovered) {
      mediaRecovered = true;
      hls.recoverMediaError();
    } else {
      onFatal(new PlaybackError(data.type === Hls.ErrorTypes.NETWORK_ERROR ? "network" : "media", data.details));
    }
  });
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    onLevels?.(hls.levels.map((l, i) => ({ index: i, label: l.height ? `${l.height}p` : `${Math.round(l.bitrate / 1000)} kbps` })));
  });
  hls.loadSource(url);
  hls.attachMedia(video);
  return {
    engine: "hlsjs",
    setLevel(index) { hls.currentLevel = index; }, // -1 = automática
    destroy() { hls.destroy(); }
  };
}

// ¿Este navegador puede usar hls.js? (necesita Media Source Extensions)
export function mseSupported() {
  return typeof window !== "undefined" && Boolean(window.MediaSource || window.ManagedMediaSource);
}

// preference: "auto" | "native" | "hlsjs"
// En "auto" se usa hls.js si el navegador lo admite, y el nativo si no (iPhone antiguo, etc.).
// Motivo: algunos navegadores dicen soportar HLS nativo y fallan; además, si el intento nativo
// va primero, la lista queda guardada en caché sin permiso CORS y hls.js ya no puede leerla.
export async function attachSource(video, source, { preference = "auto", onFatal, onLevels } = {}) {
  const type = detectType(source.url, source.type);
  if (type === HLS_TYPE) {
    const native = Boolean(video.canPlayType(HLS_TYPE));
    if (preference === "native") {
      if (!native) throw new PlaybackError("unsupported", "El navegador no reproduce HLS sin ayuda. Elegí \"Automático\" en Ajustes.");
      return attachNative(video, source.url);
    }
    if (preference === "auto" && !mseSupported()) {
      if (native) return attachNative(video, source.url);
      throw new PlaybackError("unsupported", "Este navegador no puede reproducir HLS.");
    }
    return attachHlsJs(video, source.url, onFatal, onLevels);
  }
  if (type && !video.canPlayType(type)) throw new PlaybackError("unsupported", `Este navegador no reproduce videos de tipo ${type}.`);
  return attachNative(video, source.url);
}
