// DATOS FICTICIOS DE DEMOSTRACIÓN.
// Nada de esto es contenido real: los títulos y canales son inventados y no tienen video.
// Sirven para ver la estructura de la app (incluidas temporadas y episodios).
// Se pueden desactivar en Ajustes → Proveedores.

const episodes = (season, names) => names.map((title, i) => ({
  id: `s${season}e${i + 1}`, number: i + 1, title, description: "Episodio ficticio de demostración.", source: null
}));

export const demoItems = [
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
  { id: 101, kind: "live", title: "Canal de demostración 1", categories: ["General"], channelNumber: 1, description: "Canal ficticio para probar la interfaz. No transmite.", color: "poster-b", source: null },
  { id: 102, kind: "live", title: "Canal de demostración 2", categories: ["Noticias"], channelNumber: 2, description: "Canal ficticio para probar la interfaz. No transmite.", color: "poster-e", source: null },
  { id: 103, kind: "live", title: "Canal de demostración 3", categories: ["Deportes"], channelNumber: 3, description: "Canal ficticio para probar la interfaz. No transmite.", color: "poster-c", source: null }
];
