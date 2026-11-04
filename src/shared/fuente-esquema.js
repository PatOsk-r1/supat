// Esquema de configuración de las fuentes de contenido (Fuente A y Fuente B).
// Lo usan las dos partes:
//   - la interfaz (Ajustes → Fuentes de contenido) para dibujar los campos;
//   - el servidor (worker/src/providers/configurable.js) para validar y armar las consultas.
// Todos los campos empiezan VACÍOS: los completa el propietario con la documentación de cada fuente.
// Nada de este archivo es específico de un proveedor.

export const SLOTS = { a: { id: "fuente-a", label: "Fuente A" }, b: { id: "fuente-b", label: "Fuente B" } };
export const slotOfProvider = providerId => Object.keys(SLOTS).find(k => SLOTS[k].id === providerId) || null;

// Credenciales: se guardan cifradas en el servidor y nunca vuelven al navegador.
export const SECRET_FIELDS = ["apiKey", "token", "username", "password", "playbackKey", "authHeaders", "authParams"];

const KV_HELP = "Una por línea, con el formato nombre=valor.";
const PLACEHOLDERS_LIST = "{id}, {seriesId}, {season}, {episode}, {tmdb}, {imdb}, {lang}, {data.campo}";

const httpMethod = { type: "select", options: [["", "El método general"], ["GET", "GET"], ["POST", "POST"]] };

function endpoint(key, label, extra = "") {
  return {
    title: label,
    fields: [
      { key: `${key}.path`, label: "Ruta (relativa a la URL base)", type: "text", placeholder: "/…", help: `Empieza con "/". ${extra}` },
      { key: `${key}.method`, label: "Método HTTP", ...httpMethod },
      { key: `${key}.paged`, label: "Paginación de este endpoint", type: "select", options: [["", "Usar la paginación general"], ["none", "Sin paginación (una sola respuesta)"]] },
      { key: `${key}.items`, label: "Ruta del array de resultados en la respuesta", type: "text", help: "Por ejemplo data.results. Vacío = la respuesta es el array." },
      { key: `${key}.params`, label: "Parámetros", type: "kv", help: `${KV_HELP} Admiten ${PLACEHOLDERS_LIST}.` },
      { key: `${key}.headers`, label: "Encabezados (no secretos)", type: "kv", help: KV_HELP }
    ]
  };
}

export const SECTIONS = [
  {
    id: "conexion", title: "Identificación y conexión",
    fields: [
      { key: "internalName", label: "Nombre interno", type: "text", help: "Solo para vos (registros y panel)." },
      { key: "displayName", label: "Nombre visible", type: "text", required: true, help: "Lo ven los usuarios al elegir la fuente de reproducción." },
      { key: "baseUrl", label: "URL base de la API", type: "url", required: true, placeholder: "https://…", help: "Tiene que ser https." },
      { key: "httpMethod", label: "Método de conexión (HTTP por defecto)", type: "select", options: [["GET", "GET"], ["POST", "POST"]] },
      { key: "timeoutSec", label: "Tiempo máximo por consulta (segundos)", type: "number", placeholder: "15", help: "Entre 2 y 30." },
      { key: "retryMax", label: "Reintentos ante errores temporales", type: "number", placeholder: "5", help: "Entre 1 y 10." },
      { key: "retryDelaySec", label: "Espera inicial entre reintentos (segundos)", type: "number", placeholder: "60", help: "Se duplica en cada reintento." },
      { key: "minIntervalMs", label: "Pausa mínima entre consultas (milisegundos)", type: "number", placeholder: "0", help: "Para respetar el límite de solicitudes de la fuente." }
    ]
  },
  {
    id: "auth", title: "Autenticación",
    fields: [
      { key: "authType", label: "Tipo de autenticación", type: "select", options: [["none", "Ninguna"], ["apiKeyHeader", "API Key en un encabezado"], ["apiKeyQuery", "API Key en un parámetro"], ["bearer", "Token (Authorization: Bearer)"], ["basic", "Usuario y contraseña (básica)"], ["custom", "Solo encabezados/parámetros personalizados"]] },
      { key: "apiKeyName", label: "Nombre del encabezado o parámetro de la API Key", type: "text" },
      { key: "apiKey", label: "API Key", type: "secret" },
      { key: "token", label: "Token", type: "secret" },
      { key: "username", label: "Usuario", type: "secret" },
      { key: "password", label: "Contraseña", type: "secret" },
      { key: "authHeaders", label: "Encabezados personalizados (secretos)", type: "secretkv", help: `${KV_HELP} Se envían en todas las consultas al catálogo.` },
      { key: "authParams", label: "Parámetros de autenticación adicionales (secretos)", type: "secretkv", help: `${KV_HELP} Se agregan a todas las consultas al catálogo.` }
    ]
  },
  {
    id: "catalogo", title: "Catálogo",
    fields: [
      { key: "cat.movie", label: "Importar películas", type: "check" },
      { key: "cat.series", label: "Importar series", type: "check" },
      { key: "cat.anime", label: "Importar anime", type: "check" },
      { key: "cat.episodes", label: "Importar temporadas y episodios", type: "check" }
    ],
    groups: [
      endpoint("ep.movie", "Endpoint de películas"),
      endpoint("ep.series", "Endpoint de series"),
      endpoint("ep.anime", "Endpoint de anime"),
      endpoint("ep.seasons", "Endpoint de temporadas (opcional)", "Admite {id} (serie) y {data.campo}. Si está, los episodios se piden por temporada con {season}."),
      endpoint("ep.episodes", "Endpoint de episodios", "Admite {id} (serie), {season} y {data.campo}."),
      endpoint("ep.test", "Endpoint de prueba de conexión (opcional)", "Si está vacío, se usa la primera página del catálogo.")
    ]
  },
  {
    id: "paginacion", title: "Paginación",
    fields: [
      { key: "page.type", label: "Tipo de paginación", type: "select", options: [["none", "Sin paginación"], ["page", "Número de página"], ["offset", "Desplazamiento (offset)"], ["cursor", "Cursor"], ["link", "Enlace a la página siguiente"]] },
      { key: "page.pageParam", label: "Parámetro de página / offset / cursor", type: "text" },
      { key: "page.sizeParam", label: "Parámetro de resultados por página", type: "text" },
      { key: "page.size", label: "Resultados por página", type: "number" },
      { key: "page.start", label: "Primera página", type: "number", placeholder: "1" },
      { key: "page.infoPath", label: "Ruta de la información de paginación", type: "text", help: "Prefijo de las rutas de abajo, por ejemplo meta. Vacío = la raíz de la respuesta." },
      { key: "page.nextPath", label: "Ruta del cursor o enlace siguiente", type: "text" },
      { key: "page.lastPagePath", label: "Ruta del indicador de última página", type: "text", help: "Un valor verdadero corta la importación de ese endpoint." },
      { key: "page.totalPagesPath", label: "Ruta del total de páginas", type: "text" },
      { key: "page.totalResultsPath", label: "Ruta del total de resultados", type: "text" },
      { key: "page.sinceParam", label: "Parámetro de \"cambios desde\" (incremental)", type: "text", help: "Si la fuente permite pedir solo lo modificado desde una fecha." },
      { key: "page.sinceFormat", label: "Formato de esa fecha", type: "select", options: [["iso", "ISO 8601"], ["date", "Fecha (AAAA-MM-DD)"], ["unix", "Segundos Unix"], ["unixms", "Milisegundos Unix"]] }
    ]
  },
  {
    id: "mapeo", title: "Mapeo de respuestas",
    fields: [
      { key: "map.id", label: "ID del contenido", type: "text", help: "Rutas dentro de cada resultado: a.b, a[0].b, lista[].nombre; alternativas con |." },
      { key: "map.type", label: "Tipo de contenido", type: "text", help: "Se guarda como dato; el tipo lo define el endpoint." },
      { key: "map.tmdb", label: "TMDb ID", type: "text" },
      { key: "map.imdb", label: "IMDb ID", type: "text" },
      { key: "map.title", label: "Título", type: "text" },
      { key: "map.originalTitle", label: "Título original", type: "text" },
      { key: "map.description", label: "Descripción", type: "text" },
      { key: "map.poster", label: "Póster", type: "text" },
      { key: "map.backdrop", label: "Backdrop", type: "text" },
      { key: "map.year", label: "Año", type: "text" },
      { key: "map.releaseDate", label: "Fecha de estreno", type: "text" },
      { key: "map.categories", label: "Géneros o categorías", type: "text" },
      { key: "map.rating", label: "Puntaje (0 a 10)", type: "text" },
      { key: "map.seasonsCount", label: "Cantidad de temporadas", type: "text" },
      { key: "map.episodesCount", label: "Cantidad de episodios", type: "text" },
      { key: "map.updatedAt", label: "Fecha de actualización", type: "text" },
      { key: "map.playbackUrl", label: "URL de reproducción (si la trae el catálogo)", type: "text", help: "Solo para el método de reproducción \"directo\"." },
      { key: "map.extra", label: "Otros campos", type: "kv", help: `${KV_HELP} nombre=ruta. Se guardan y se pueden usar como {data.nombre}.` },
      { key: "img.posterPrefix", label: "Prefijo de pósters con ruta relativa", type: "text" },
      { key: "img.backdropPrefix", label: "Prefijo de backdrops con ruta relativa", type: "text" },
      { key: "season.number", label: "Temporadas: número de temporada", type: "text", help: "Dentro de cada resultado del endpoint de temporadas." },
      { key: "epmap.id", label: "Episodios: ID", type: "text" },
      { key: "epmap.season", label: "Episodios: número de temporada", type: "text" },
      { key: "epmap.number", label: "Episodios: número de episodio", type: "text" },
      { key: "epmap.title", label: "Episodios: título", type: "text" },
      { key: "epmap.description", label: "Episodios: descripción", type: "text" },
      { key: "epmap.still", label: "Episodios: imagen", type: "text" },
      { key: "epmap.duration", label: "Episodios: duración (segundos)", type: "text" },
      { key: "epmap.playbackUrl", label: "Episodios: URL de reproducción (método directo)", type: "text" },
      { key: "epmap.extra", label: "Episodios: otros campos", type: "kv", help: `${KV_HELP} nombre=ruta.` },
      { key: "img.stillPrefix", label: "Prefijo de imágenes de episodios", type: "text" }
    ]
  },
  {
    id: "reproduccion", title: "Reproducción",
    fields: [
      { key: "play.mode", label: "Método de reproducción", type: "select", options: [["", "Sin configurar"], ["template", "Armar la URL (plantilla o parámetros)"], ["api", "Pedir la URL a un endpoint"], ["direct", "La URL viene en el catálogo"]] },
      { key: "play.baseUrl", label: "URL base de reproducción", type: "url", help: "Vacía = la URL base de la API." },
      { key: "play.movieTemplate", label: "Plantilla de URL de películas", type: "text", help: `Ruta o URL completa. Admite ${PLACEHOLDERS_LIST}.` },
      { key: "play.episodeTemplate", label: "Plantilla de URL de episodios", type: "text", help: `Admite ${PLACEHOLDERS_LIST}.` },
      { key: "play.movieIdParam", label: "Parámetro del identificador de película", type: "text" },
      { key: "play.seriesIdParam", label: "Parámetro del identificador de serie", type: "text" },
      { key: "play.seasonParam", label: "Parámetro de temporada", type: "text" },
      { key: "play.episodeParam", label: "Parámetro de episodio", type: "text" },
      { key: "play.params", label: "Parámetros adicionales", type: "kv", help: `${KV_HELP} Admiten ${PLACEHOLDERS_LIST}.` },
      { key: "play.headers", label: "Encabezados para pedir la URL (no secretos)", type: "kv", help: `${KV_HELP} Solo en el método "endpoint". El navegador no puede mandar encabezados al reproducir.` },
      { key: "play.apiPath", label: "Endpoint de reproducción de películas", type: "text", help: "Método \"endpoint\". Ruta relativa a la URL base de reproducción." },
      { key: "play.apiEpisodePath", label: "Endpoint de reproducción de episodios", type: "text" },
      { key: "play.apiMethod", label: "Método HTTP del endpoint de reproducción", ...httpMethod },
      { key: "play.urlPath", label: "Ruta de la URL en la respuesta", type: "text" },
      { key: "play.typePath", label: "Ruta del formato en la respuesta (opcional)", type: "text" },
      { key: "play.expiresPath", label: "Ruta del vencimiento en la respuesta (opcional)", type: "text", help: "Segundos que dura el enlace, o una fecha." },
      { key: "playbackKey", label: "Credencial de reproducción", type: "secret", help: "Solo se usa para obtener o habilitar los enlaces de reproducción." },
      { key: "play.keyIn", label: "Dónde va la credencial de reproducción", type: "select", options: [["", "No se usa"], ["header", "Encabezado (método endpoint)"], ["query", "Parámetro (método endpoint)"], ["body", "Cuerpo JSON (método endpoint)"], ["url", "Dentro de la URL que usa el navegador"]] },
      { key: "play.keyName", label: "Nombre del encabezado o parámetro de la credencial", type: "text", help: "Con \"dentro de la URL\": nombre del parámetro, o usá {playbackKey} en la plantilla." },
      { key: "play.domains", label: "Dominios de reproducción permitidos", type: "list", help: "Uno por línea (https://dominio). Los enlaces de otros dominios se rechazan. Obligatorio para reproductores externos." },
      { key: "play.contentType", label: "Tipo de contenido", type: "select", options: [["video", "Video (reproductor de Supat)"], ["embed", "Reproductor externo (iframe)"]] },
      { key: "play.format", label: "Formato de video", type: "select", options: [["", "Detectar"], ["hls", "HLS (.m3u8)"], ["mp4", "MP4"], ["webm", "WebM"]] },
      { key: "play.subtitlesPath", label: "Subtítulos: ruta de la lista en la respuesta", type: "text", help: "Método endpoint. Cada elemento con url (WebVTT), idioma y etiqueta." },
      { key: "play.subtitleUrl", label: "Subtítulos: campo de la URL", type: "text", placeholder: "url" },
      { key: "play.subtitleLang", label: "Subtítulos: campo del idioma", type: "text", placeholder: "lang" },
      { key: "play.subtitleLabel", label: "Subtítulos: campo de la etiqueta", type: "text", placeholder: "label" },
      { key: "play.langParam", label: "Idioma: nombre del parámetro", type: "text" },
      { key: "play.langValue", label: "Idioma: valor", type: "text", help: "También disponible como {lang}." },
      { key: "play.expiresSec", label: "Duración de los enlaces (segundos)", type: "number", help: "Si los enlaces vencen y la respuesta no lo informa. Supat pide uno nuevo al reintentar." }
    ]
  }
];

export const ALL_FIELDS = SECTIONS.flatMap(s => [...s.fields, ...(s.groups || []).flatMap(g => g.fields)]);
export const FORM_KEYS = ALL_FIELDS.filter(f => !["secret", "secretkv"].includes(f.type)).map(f => f.key);

// "nombre=valor" por línea → [[nombre, valor]]. Las líneas vacías o sin "=" se ignoran.
export function parseKv(text) {
  return String(text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
    const i = l.indexOf("=");
    return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : null;
  }).filter(Boolean);
}
export const parseList = text => String(text || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);

// Requisitos para GUARDAR (datos básicos) y para ACTIVAR/IMPORTAR. Devuelven lo que falta, en palabras.
export function missingToSave(form) {
  const m = [];
  if (!String(form.displayName || "").trim()) m.push("Nombre visible");
  const base = String(form.baseUrl || "").trim();
  if (!base) m.push("URL base de la API");
  else {
    try {
      const u = new URL(base);
      const local = ["localhost", "127.0.0.1"].includes(u.hostname);
      if (u.protocol !== "https:" && !(local && u.protocol === "http:")) m.push("URL base de la API (tiene que ser https)");
      if (u.username || u.password || u.search) m.push("URL base de la API (sin usuario, contraseña ni parámetros: van en Autenticación)");
    } catch { m.push("URL base de la API (no es una dirección válida)"); }
  }
  return m;
}

export function missingToActivate(form, secretsSet = []) {
  const m = [...missingToSave(form)];
  const kinds = ["movie", "series", "anime"].filter(k => form[`cat.${k}`] && String(form[`ep.${k}.path`] || "").trim());
  if (!kinds.length) m.push("Al menos una categoría marcada para importar, con su endpoint");
  for (const k of ["movie", "series", "anime"]) {
    if (form[`cat.${k}`] && !String(form[`ep.${k}.path`] || "").trim()) m.push(`Endpoint de ${k === "movie" ? "películas" : k} (la categoría está marcada)`);
  }
  if (!String(form["map.id"] || "").trim()) m.push("Mapeo: ID del contenido");
  if (!String(form["map.title"] || "").trim()) m.push("Mapeo: Título");
  if (form["cat.episodes"] && (form["cat.series"] || form["cat.anime"])) {
    if (!String(form["ep.episodes.path"] || "").trim()) m.push("Endpoint de episodios (la importación de episodios está marcada)");
    else {
      if (!String(form["epmap.id"] || "").trim()) m.push("Mapeo: ID del episodio");
      if (!String(form["epmap.number"] || "").trim()) m.push("Mapeo: número de episodio");
    }
  }
  const pt = form["page.type"] || "none";
  if (["page", "offset", "cursor"].includes(pt) && !String(form["page.pageParam"] || "").trim()) m.push("Paginación: parámetro de página / offset / cursor");
  if (["cursor", "link"].includes(pt) && !String(form["page.nextPath"] || "").trim()) m.push("Paginación: ruta del cursor o enlace siguiente");
  const auth = form.authType || "none";
  if (["apiKeyHeader", "apiKeyQuery"].includes(auth)) {
    if (!String(form.apiKeyName || "").trim()) m.push("Autenticación: nombre del encabezado o parámetro de la API Key");
    if (!secretsSet.includes("apiKey")) m.push("Autenticación: API Key");
  }
  if (auth === "bearer" && !secretsSet.includes("token")) m.push("Autenticación: Token");
  if (auth === "basic" && !(secretsSet.includes("username") && secretsSet.includes("password"))) m.push("Autenticación: Usuario y Contraseña");
  if (auth === "custom" && !secretsSet.includes("authHeaders") && !secretsSet.includes("authParams")) m.push("Autenticación: encabezados o parámetros personalizados");
  return m;
}
