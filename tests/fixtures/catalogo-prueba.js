// DATOS FICTICIOS SOLO PARA LAS PRUEBAS AUTOMÁTICAS (tests/logica.test.js).
// No forman parte de la app: los títulos y canales son inventados y no tienen video.

const episodes = (season, names) => names.map((title, i) => ({
  id: `s${season}e${i + 1}`, number: i + 1, title, description: "Episodio ficticio de prueba.", source: null
}));

export const testItems = [
  { id: 1, kind: "movie", title: "Horizonte", categories: ["Drama"], year: 2025, featured: true, description: "Una historia de decisiones y nuevos comienzos.", color: "poster-a", source: null },
  {
    id: 2, kind: "series", title: "Código Azul", categories: ["Acción"], year: 2024, featured: true, description: "Un equipo resuelve una crisis que cambia cada episodio.", color: "poster-b", source: null,
    seasons: [
      { number: 1, episodes: episodes(1, ["La llamada", "Cuenta regresiva", "Sin salida"]) },
      { number: 2, episodes: episodes(2, ["Regreso", "Doble juego"]) }
    ]
  },
  { id: 3, kind: "movie", title: "Planeta Vivo", categories: ["Documental"], year: 2025, description: "Un recorrido por paisajes extraordinarios.", color: "poster-c", source: null },
  { id: 4, kind: "movie", title: "Última Parada", categories: ["Comedia"], year: 2023, description: "Un viaje inesperado y muchas casualidades.", color: "poster-d", source: null },
  {
    id: 5, kind: "series", title: "Zona Norte", categories: ["Drama"], year: 2025, description: "Historias cruzadas en una ciudad en movimiento.", color: "poster-e", source: null,
    seasons: [{ number: 1, episodes: episodes(1, ["Piloto", "La esquina", "Fin de semana", "Mudanza"]) }]
  },
  { id: 6, kind: "movie", title: "Operación Noche", categories: ["Acción"], year: 2024, description: "Una misión con el tiempo en contra.", color: "poster-f", source: null },
  { id: 101, kind: "live", title: "Canal de prueba 1", categories: ["General"], channelNumber: 1, description: "Canal ficticio para probar la interfaz. No transmite.", color: "poster-b", source: null },
  { id: 102, kind: "live", title: "Canal de prueba 2", categories: ["Noticias"], channelNumber: 2, description: "Canal ficticio para probar la interfaz. No transmite.", color: "poster-e", source: null },
  { id: 103, kind: "live", title: "Canal de prueba 3", categories: ["Deportes"], channelNumber: 3, description: "Canal ficticio para probar la interfaz. No transmite.", color: "poster-c", source: null }
];

// Proveedor de prueba que entrega estos datos (se registra solo dentro de las pruebas).
export const testProvider = {
  type: "prueba",
  name: "Prueba",
  description: "Datos ficticios de las pruebas automáticas.",
  origin: "tests/fixtures",
  kinds: ["movie", "series", "live"],
  multiple: false,
  fields: [],
  defaults: {},
  ttl: 0,
  async load() { return { items: testItems }; }
};
