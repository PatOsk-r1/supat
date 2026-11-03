// Favoritos guardados en el navegador (localStorage).
// Si el navegador bloquea el almacenamiento (modo privado, permisos), los favoritos
// funcionan igual mientras la página esté abierta y se avisa con `persistent = false`.
const KEY = "xuper-web:favoritos";

export function createFavorites() {
  let ids = new Set();
  let persistent = true;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (Array.isArray(saved)) ids = new Set(saved.filter(x => typeof x === "string"));
  } catch {
    persistent = false;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify([...ids]));
    } catch {
      persistent = false;
    }
  }

  return {
    has: id => ids.has(id),
    toggle(id) {
      ids.has(id) ? ids.delete(id) : ids.add(id);
      save();
      return ids.has(id);
    },
    list: () => [...ids],
    clear() { ids.clear(); save(); },
    get size() { return ids.size; },
    get persistent() { return persistent; }
  };
}
