// Reproductor con controles propios. No sabe nada del catálogo: recibe una fuente
// ({ url, type }) y textos para mostrar, y avisa el progreso con callbacks.
// Nunca muestra que algo se reproduce si el video no arrancó de verdad.
import { escapeHtml } from "../app/util.js";
import { readJSON, writeJSON } from "../app/storage.js";
import { attachSource, detectType, HLS_TYPE } from "./engine.js";

const VOLUME_KEY = "xuper-web:volumen";

const ERROR_TEXT = {
  unsupported: "Formato no compatible con este navegador",
  network: "No se pudo conectar con la transmisión",
  media: "El video está dañado o usa un formato que el navegador no decodifica",
  "hls-unavailable": "No se pudo cargar el reproductor HLS",
  load: "No se pudo cargar el video"
};

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds % 60), m = Math.floor(seconds / 60) % 60, h = Math.floor(seconds / 3600);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

// Mensaje dentro del área del reproductor (sin fuente, error, etc.).
export function playerMessage(container, title, detail, action = "") {
  container.innerHTML = `<div class="player-message" role="status">
    <span class="player-icon" aria-hidden="true">▶</span>
    <strong>${escapeHtml(title)}</strong>
    <small>${escapeHtml(detail)}</small>${action}
  </div>`;
}

/**
 * opts: {
 *   source: { url, type }, title, subtitle, live (bool), startAt (segundos),
 *   preference: "auto" | "native" | "hlsjs",
 *   onProgress(time, duration), onEnded(), next: { label, href } | null, backHref
 * }
 */
export function createPlayer(container, opts) {
  const live = Boolean(opts.live);
  container.innerHTML = `<div class="xp ${live ? "is-live" : ""}" tabindex="0" aria-label="Reproductor: ${escapeHtml(opts.title)}">
    <video playsinline preload="metadata"></video>
    <div class="xp-overlay">
      <div class="xp-top">
        ${opts.backHref ? `<a class="xp-btn" href="${escapeHtml(opts.backHref)}" data-xp="back" aria-label="Volver">←</a>` : ""}
        <div class="xp-heading"><strong>${escapeHtml(opts.title)}</strong>${opts.subtitle ? `<small>${escapeHtml(opts.subtitle)}</small>` : ""}</div>
      </div>
      <div class="xp-center">
        <div class="xp-spinner" aria-hidden="true"></div>
        <button type="button" class="xp-bigplay" data-xp="play" aria-label="Reproducir" hidden>▶</button>
        <div class="xp-error" role="alert" hidden></div>
      </div>
      <div class="xp-toast" role="status" hidden></div>
      <div class="xp-bottom">
        ${live ? "" : `<input class="xp-seek" type="range" min="0" max="0" step="1" value="0" aria-label="Posición">`}
        <div class="xp-bar">
          <button type="button" class="xp-btn" data-xp="play" aria-label="Reproducir">▶</button>
          ${live ? "" : `<button type="button" class="xp-btn" data-xp="back10" aria-label="Retroceder 10 segundos">↺</button>
          <button type="button" class="xp-btn" data-xp="fwd10" aria-label="Adelantar 10 segundos">↻</button>`}
          ${live ? `<span class="xp-live">● EN VIVO</span>` : `<span class="xp-time" aria-live="off">0:00 / 0:00</span>`}
          <span class="xp-spacer"></span>
          ${opts.next ? `<a class="xp-btn xp-next" href="${escapeHtml(opts.next.href)}">${escapeHtml(opts.next.label)} ⏭</a>` : ""}
          <select class="xp-quality" aria-label="Calidad" hidden></select>
          <button type="button" class="xp-btn" data-xp="mute" aria-label="Silenciar">🔊</button>
          <input class="xp-volume" type="range" min="0" max="1" step="0.05" aria-label="Volumen">
          <button type="button" class="xp-btn" data-xp="fullscreen" aria-label="Pantalla completa">⛶</button>
        </div>
      </div>
    </div>
  </div>`;

  const root = container.querySelector(".xp");
  const video = root.querySelector("video");
  const $ = sel => root.querySelector(sel);
  const seek = $(".xp-seek"), time = $(".xp-time"), volume = $(".xp-volume"), quality = $(".xp-quality");
  const spinner = $(".xp-spinner"), bigPlay = $(".xp-bigplay"), errorBox = $(".xp-error"), toast = $(".xp-toast");

  let attached = null;
  let destroyed = false;
  let triedHlsJsFallback = false;
  let lastSaved = 0;
  let hideTimer = 0;
  let seeking = false;

  const savedVolume = readJSON(VOLUME_KEY, { volume: 1, muted: false });
  video.volume = Number.isFinite(savedVolume.volume) ? savedVolume.volume : 1;
  video.muted = Boolean(savedVolume.muted);

  // ---------- estado visual ----------
  function showError(code, detail = "") {
    spinner.hidden = true;
    bigPlay.hidden = true;
    errorBox.hidden = false;
    errorBox.innerHTML = `<strong>${escapeHtml(ERROR_TEXT[code] || ERROR_TEXT.load)}</strong>
      <small>${escapeHtml(detail || "Revisá que la fuente esté disponible y que tengas permiso para usarla.")}</small>
      <button type="button" class="primary" data-xp="retry">Reintentar</button>`;
    root.classList.add("has-error");
  }
  function clearError() { errorBox.hidden = true; root.classList.remove("has-error"); }
  function showToast(html, ms = 6000) {
    toast.innerHTML = html;
    toast.hidden = false;
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => { toast.hidden = true; }, ms);
  }
  function updatePlayButtons() {
    const paused = video.paused;
    root.querySelectorAll('.xp-bar [data-xp="play"]').forEach(b => { b.textContent = paused ? "▶" : "❚❚"; b.setAttribute("aria-label", paused ? "Reproducir" : "Pausar"); });
    root.classList.toggle("is-paused", paused);
  }
  function updateVolume() {
    volume.value = video.muted ? 0 : video.volume;
    const btn = $('[data-xp="mute"]');
    btn.textContent = video.muted || video.volume === 0 ? "🔇" : "🔊";
    btn.setAttribute("aria-label", video.muted ? "Activar sonido" : "Silenciar");
    writeJSON(VOLUME_KEY, { volume: video.volume, muted: video.muted });
  }
  function updateTime() {
    if (live || seeking) return;
    const d = video.duration;
    if (Number.isFinite(d)) { seek.max = Math.floor(d); seek.value = Math.floor(video.currentTime); }
    time.textContent = `${formatTime(video.currentTime)} / ${formatTime(d)}`;
  }
  function wakeControls() {
    root.classList.add("show-controls");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (!video.paused) root.classList.remove("show-controls"); }, 3000);
  }
  function saveProgress(force = false) {
    if (live || !opts.onProgress) return;
    const now = Date.now();
    if (!force && now - lastSaved < 5000) return;
    lastSaved = now;
    opts.onProgress(video.currentTime, video.duration);
  }

  // ---------- acciones ----------
  const actions = {
    play: () => { video.paused ? video.play().catch(() => { bigPlay.hidden = false; }) : video.pause(); },
    back10: () => { video.currentTime = Math.max(0, video.currentTime - 10); },
    fwd10: () => { video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10); },
    mute: () => { video.muted = !video.muted; if (!video.muted && video.volume === 0) video.volume = 0.5; },
    fullscreen: () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else if (root.requestFullscreen) root.requestFullscreen().catch(() => video.webkitEnterFullscreen?.());
      else video.webkitEnterFullscreen?.(); // iPhone: solo el video puede ir a pantalla completa
    },
    restart: () => { video.currentTime = 0; toast.hidden = true; video.play().catch(() => {}); },
    retry: () => { clearError(); triedHlsJsFallback = false; load(opts.preference); }
  };

  root.addEventListener("click", ev => {
    const btn = ev.target.closest("[data-xp]");
    if (btn && actions[btn.dataset.xp]) { ev.preventDefault(); actions[btn.dataset.xp](); }
    else if (ev.target === video || ev.target.classList.contains("xp-center")) actions.play();
    wakeControls();
  });
  root.addEventListener("dblclick", ev => { if (ev.target === video || ev.target.classList.contains("xp-center")) actions.fullscreen(); });
  root.addEventListener("pointermove", wakeControls);
  root.addEventListener("keydown", ev => {
    if (ev.target.matches("input, select") && !["Escape"].includes(ev.key)) return;
    const map = { " ": "play", k: "play", f: "fullscreen", m: "mute", ArrowLeft: live ? null : "back10", ArrowRight: live ? null : "fwd10" };
    if (ev.key === "ArrowUp" || ev.key === "ArrowDown") {
      ev.preventDefault();
      video.muted = false;
      video.volume = Math.min(1, Math.max(0, video.volume + (ev.key === "ArrowUp" ? 0.1 : -0.1)));
    } else if (map[ev.key]) {
      ev.preventDefault();
      actions[map[ev.key]]();
    }
    wakeControls();
  });
  seek?.addEventListener("input", () => { seeking = true; time.textContent = `${formatTime(+seek.value)} / ${formatTime(video.duration)}`; });
  seek?.addEventListener("change", () => { video.currentTime = +seek.value; seeking = false; });
  volume.addEventListener("input", () => { video.volume = +volume.value; video.muted = +volume.value === 0; });
  quality.addEventListener("change", () => attached?.setLevel?.(+quality.value));

  const videoEvents = {
    playing: () => { spinner.hidden = true; bigPlay.hidden = true; clearError(); updatePlayButtons(); wakeControls(); },
    pause: () => { updatePlayButtons(); root.classList.add("show-controls"); saveProgress(true); },
    play: updatePlayButtons,
    waiting: () => { spinner.hidden = false; },
    canplay: () => { spinner.hidden = true; },
    timeupdate: () => { updateTime(); saveProgress(); },
    durationchange: updateTime,
    volumechange: updateVolume,
    ended: () => { saveProgress(true); updatePlayButtons(); opts.onEnded?.(); },
    error: () => {
      // En "Automático", si el HLS nativo falla se prueba una vez con hls.js.
      const isHls = detectType(opts.source.url, opts.source.type) === HLS_TYPE;
      if (attached?.engine === "native" && isHls && !triedHlsJsFallback && (opts.preference || "auto") === "auto") {
        triedHlsJsFallback = true;
        load("hlsjs");
        return;
      }
      showError(live ? "network" : "load");
    }
  };
  for (const [name, fn] of Object.entries(videoEvents)) video.addEventListener(name, fn);

  function onLevels(levels) {
    if (levels.length < 2) return;
    quality.innerHTML = `<option value="-1">Auto</option>` + levels.map(l => `<option value="${l.index}">${escapeHtml(l.label)}</option>`).join("");
    quality.hidden = false;
  }

  async function load(preference = "auto") {
    attached?.destroy();
    attached = null;
    spinner.hidden = false;
    quality.hidden = true;
    try {
      const result = await attachSource(video, opts.source, {
        preference,
        onLevels,
        onFatal: err => showError(err.code, err.message)
      });
      if (destroyed) { result.destroy(); return; }
      attached = result;
      if (opts.startAt > 0 && !live) {
        video.addEventListener("loadedmetadata", () => {
          video.currentTime = opts.startAt;
          showToast(`Seguís desde ${formatTime(opts.startAt)} · <button type="button" class="link" data-xp="restart">Empezar de nuevo</button>`);
        }, { once: true });
      }
      video.play().catch(() => { spinner.hidden = true; bigPlay.hidden = false; root.classList.add("show-controls"); });
    } catch (err) {
      if (!destroyed) showError(err.code || "load", err.message);
    }
  }

  updatePlayButtons();
  updateVolume();
  root.classList.add("show-controls");
  load(opts.preference);
  const saveOnHide = () => saveProgress(true);
  window.addEventListener("pagehide", saveOnHide);

  return {
    root,
    destroy() {
      if (destroyed) return;
      saveProgress(true);
      destroyed = true;
      clearTimeout(hideTimer);
      window.removeEventListener("pagehide", saveOnHide);
      for (const [name, fn] of Object.entries(videoEvents)) video.removeEventListener(name, fn);
      video.pause();
      attached?.destroy();
      if (document.fullscreenElement === root) document.exitFullscreen().catch(() => {});
    }
  };
}
