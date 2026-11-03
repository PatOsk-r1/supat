// Preferencias del usuario, guardadas en el navegador.
// La lista de proveedores también vive acá (cuáles hay, si están activos y su configuración).
import { readJSON, writeJSON } from "./storage.js";

const KEY = "xuper-web:ajustes";

export const DEFAULT_SETTINGS = {
  language: "es-ES",     // idioma de los metadatos de TMDb
  region: "UY",          // país para "Dónde verla"
  tmdbKey: "",           // clave de TMDb (la carga el usuario en Ajustes; nunca va en el código)
  player: "auto",        // "auto" | "native" | "hlsjs"
  autoplayNext: true,    // pasar solo al siguiente episodio
  resume: true,          // seguir desde donde se dejó
  providers: null        // null = usar los proveedores por defecto (ver providers/registry.js)
};

let current = { ...DEFAULT_SETTINGS, ...readJSON(KEY, {}) };
const listeners = new Set();

export const settings = {
  get: key => current[key],
  all: () => ({ ...current }),
  set(key, value) {
    current = { ...current, [key]: value };
    const saved = writeJSON(KEY, current);
    listeners.forEach(fn => fn(key, value));
    return saved;
  },
  reset() {
    current = { ...DEFAULT_SETTINGS };
    writeJSON(KEY, current);
    listeners.forEach(fn => fn(null, null));
  },
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
};
