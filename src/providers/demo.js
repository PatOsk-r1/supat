// Proveedor de demostración: títulos ficticios, sin video.
import { demoItems } from "./demo-data.js";

export default {
  type: "demo",
  name: "Demostración",
  description: "Títulos y canales ficticios para probar la interfaz. No tienen video.",
  origin: "Incluido en la app",
  kinds: ["movie", "series", "live"],
  isDemo: true,
  multiple: false,
  fields: [],
  defaults: {},
  ttl: 0, // no hace falta guardarlo en caché
  async load() {
    return { items: demoItems };
  }
};
