// DATOS FICTICIOS DE DEMOSTRACIÓN.
// Nada de esto es contenido real: los títulos y canales son inventados y no tienen video.
// Para agregar contenido propio o autorizado, creá otro proveedor en src/catalog/
// (ver demo-provider.js como ejemplo) en lugar de editar este archivo.
//
// Campos de cada elemento:
//   id, kind ("live" | "movie" | "series"), title, category,
//   year (opcional), description (opcional), image (URL opcional),
//   color (degradado de respaldo cuando no hay imagen), featured (opcional),
//   source: null  o  { url: "https://...", type: "video/mp4" | "application/x-mpegURL" }

export const demoItems = [
  { id: 1, kind: "movie", title: "Horizonte", category: "Drama", year: 2025, featured: true, description: "Una historia de decisiones y nuevos comienzos.", color: "poster-a", source: null },
  { id: 2, kind: "series", title: "Código Azul", category: "Acción", year: 2024, description: "Un equipo resuelve una crisis que cambia cada episodio.", color: "poster-b", source: null },
  { id: 3, kind: "movie", title: "Planeta Vivo", category: "Documental", year: 2025, description: "Un recorrido por paisajes extraordinarios.", color: "poster-c", source: null },
  { id: 4, kind: "movie", title: "Última Parada", category: "Comedia", year: 2023, description: "Un viaje inesperado y muchas casualidades.", color: "poster-d", source: null },
  { id: 5, kind: "series", title: "Zona Norte", category: "Drama", year: 2025, description: "Historias cruzadas en una ciudad en movimiento.", color: "poster-e", source: null },
  { id: 6, kind: "movie", title: "Operación Noche", category: "Acción", year: 2024, description: "Una misión con el tiempo en contra.", color: "poster-f", source: null },
  { id: 101, kind: "live", title: "Canal de demostración 1", category: "General", description: "Canal ficticio para probar la interfaz. No transmite.", color: "poster-b", source: null },
  { id: 102, kind: "live", title: "Canal de demostración 2", category: "Noticias", description: "Canal ficticio para probar la interfaz. No transmite.", color: "poster-e", source: null },
  { id: 103, kind: "live", title: "Canal de demostración 3", category: "Deportes", description: "Canal ficticio para probar la interfaz. No transmite.", color: "poster-c", source: null }
];
