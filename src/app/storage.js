// Lectura y escritura segura en localStorage (datos chicos: ajustes, favoritos, progreso).
// Si el navegador bloquea el almacenamiento, devuelve el valor por defecto y no rompe la app.

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
