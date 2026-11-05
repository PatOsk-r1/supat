// Texto normalizado para búsqueda (sin acentos, minúsculas, solo letras y números).
export function normalizeText(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim().slice(0, 300);
}

