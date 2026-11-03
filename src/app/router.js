// Rutas de la app. La parte de la dirección después de "#" decide la pantalla:
//   #/inicio  #/tv  #/peliculas  #/series  #/favoritos  #/ajustes
//   #/titulo/<id>               detalle de una película, serie o canal
//   #/ver/<id>                  reproducir una película o canal
//   #/ver/<id>/<idEpisodio>     reproducir un episodio
export const SECTIONS = [
  { id: "inicio", label: "Inicio", icon: "⌂" },
  { id: "tv", label: "TV en vivo", icon: "◉", kind: "live" },
  { id: "peliculas", label: "Películas", icon: "▣", kind: "movie" },
  { id: "series", label: "Series", icon: "▤", kind: "series" },
  { id: "anime", label: "Anime", icon: "✦", kind: "anime" },
  { id: "favoritos", label: "Favoritos", icon: "♥" },
  { id: "ajustes", label: "Ajustes", icon: "⚙" }
];

export function parseRoute(hash) {
  const parts = String(hash || "").replace(/^#\/?/, "").split("/").map(p => {
    try { return decodeURIComponent(p); } catch { return p; }
  });
  const [name = "inicio", a, b] = parts;
  if (name === "titulo" && a) return { name: "titulo", id: a };
  if (name === "ver" && a) return { name: "ver", id: a, episodeId: b || null };
  // Cuenta: #/cuenta (ingresar), #/cuenta/registro, #/cuenta/recuperar
  if (name === "cuenta") return { name: "cuenta", mode: ["registro", "recuperar"].includes(a) ? a : "ingresar" };
  if (["perfil", "listas", "historial", "admin"].includes(name)) return { name };
  if (name === "lista" && a) return { name: "lista", id: a };
  if (name === "publica" && a) return { name: "publica", id: a };
  return SECTIONS.some(s => s.id === name) ? { name } : { name: "inicio" };
}

export const hrefFor = {
  section: id => `#/${id}`,
  detail: item => `#/titulo/${encodeURIComponent(item.id)}`,
  watch: (item, episode) => `#/ver/${encodeURIComponent(item.id)}${episode ? `/${encodeURIComponent(episode.id)}` : ""}`
};
