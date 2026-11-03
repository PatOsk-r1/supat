// Reproductor externo por iframe (el reproductor oficial de un servicio, embebido).
// Medidas de seguridad:
//  - Solo se aceptan direcciones https de los orígenes que declaró el proveedor.
//  - sandbox: el reproductor puede ejecutar su propio código, pero no abrir ventanas
//    emergentes ni cambiar la página de la app.
//  - referrerpolicy="origin": el servicio solo ve el dominio de la app, no la dirección completa.
// La app no lee ni modifica lo que pasa adentro del iframe (el navegador no lo permite).
import { escapeHtml } from "../app/util.js";

const LOAD_TIMEOUT_MS = 20000;

export function validateEmbedUrl(url, allowedOrigins) {
  let u;
  try { u = new URL(url); } catch { return { ok: false, reason: "La dirección del reproductor no es válida." }; }
  if (u.protocol !== "https:") return { ok: false, reason: "El reproductor externo debe usar https." };
  if (u.username || u.password) return { ok: false, reason: "La dirección del reproductor no puede incluir usuario o contraseña." };
  if (!allowedOrigins.includes(u.origin)) return { ok: false, reason: `El origen ${u.origin} no está permitido para este proveedor.` };
  return { ok: true, url: u.toString() };
}

export function createEmbed(container, { url, title, allowedOrigins = [] }) {
  const check = validateEmbedUrl(url, allowedOrigins);
  if (!check.ok) {
    container.innerHTML = `<div class="player-message" role="alert"><span class="player-icon" aria-hidden="true">▶</span>
      <strong>No se puede abrir este reproductor</strong><small>${escapeHtml(check.reason)}</small></div>`;
    return { destroy() {} };
  }
  container.innerHTML = `<div class="embed">
    <iframe src="${escapeHtml(check.url)}" title="Reproductor: ${escapeHtml(title)}"
      referrerpolicy="origin" loading="eager" allowfullscreen
      allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
      sandbox="allow-scripts allow-same-origin allow-presentation"></iframe>
    <div class="embed-status" role="status"><div class="xp-spinner"></div><small>Cargando el reproductor…</small></div>
  </div>`;
  const frame = container.querySelector("iframe");
  const status = container.querySelector(".embed-status");
  // El navegador no informa errores de un iframe de otro sitio: si no carga en un tiempo
  // razonable, se avisa sin ocultar el reproductor (podría terminar de cargar).
  const timer = setTimeout(() => {
    status.innerHTML = `<small>El reproductor está tardando. Si no aparece, el servicio puede no estar disponible o no permitir este dominio.</small>`;
    status.classList.add("is-slow");
  }, LOAD_TIMEOUT_MS);
  frame.addEventListener("load", () => { clearTimeout(timer); status.remove(); }, { once: true });
  return {
    root: frame,
    destroy() { clearTimeout(timer); frame.src = "about:blank"; }
  };
}
