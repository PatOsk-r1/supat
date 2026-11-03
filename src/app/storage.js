// Lectura y escritura segura en localStorage (datos chicos: ajustes, favoritos, progreso).
// Si el navegador bloquea el almacenamiento, devuelve el valor por defecto y no rompe la app.

// La app antes se llamaba "Xuper Web": los datos guardados con las claves viejas
// (favoritos, progreso, ajustes) pasan a las nuevas una sola vez.
try {
  const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
  for (const old of keys) {
    if (!old?.startsWith("xuper-web:")) continue;
    const key = `supat:${old.slice("xuper-web:".length)}`;
    if (localStorage.getItem(key) == null) localStorage.setItem(key, localStorage.getItem(old));
    localStorage.removeItem(old);
  }
} catch { /* sin almacenamiento: nada que migrar */ }

export function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key) {
  try { localStorage.removeItem(key); } catch { /* sin almacenamiento: nada que borrar */ }
}
