# Cómo agregar un proveedor de contenido

La app no depende de ningún proveedor en particular. Cada proveedor es un **adaptador**: un archivo en `src/providers/` que cumple un contrato común (`src/providers/contract.js`). Fichas, catálogo, usuarios y reproductor solo hablan con el catálogo (`src/catalog/store.js`), nunca con un proveedor directamente.

```
proveedores (adaptadores) ──▶ catálogo (store.js) ──▶ interfaz (ui/)
                                   │                        │
                                   └── fuentes ──▶ reproductor (player/)
```

## Capas separadas

| Capa | Dónde | Qué contiene |
|---|---|---|
| Metadatos | `catalog/model.js` | Título, año, categorías, sinopsis, imágenes, temporadas. |
| Identificadores externos | `item.externalIds` | `{ tmdb, imdb }` validados. Los completa el proveedor o TMDb. |
| Disponibilidad | `catalog/tmdb.js` (`watch`) | "Dónde verla": plataformas por país (TMDb + JustWatch). |
| Fuentes | `catalog.sourcesFor()` | Las del proveedor del título y las de otros adaptadores con `findSources`. |
| Reproducción | `player/player.js`, `player/embed.js` | Video propio (MP4, WebM, HLS) o reproductor externo por iframe. |

## El contrato

```js
export default {
  type: "mi-proveedor",            // identificador único, minúsculas
  name: "Mi proveedor",
  description: "Qué ofrece.",
  origin: "De dónde viene el contenido",
  license: "Condiciones de uso (opcional)",
  kinds: ["movie", "series"],      // "live" | "movie" | "series" | "anime"
  multiple: false,                 // ¿se puede agregar más de una vez?
  ttl: 6 * 3600e3,                 // cuánto dura la copia guardada del catálogo (ms); 0 = sin caché
  defaults: { server: "", apiKey: "" },
  fields: [
    { key: "server", label: "Dirección", type: "url", required: true },
    { key: "apiKey", label: "Clave", type: "password", required: true }  // password = secreto
  ],
  validate(config) { return []; }, // errores extra de configuración (opcional)

  // Capacidades: implementar las que correspondan (al menos load o findSources).
  async load(config, { instanceId, signal }) { return { items: [...] }; },
  async loadSeasons(item, config, ctx) { return [{ number: 1, episodes: [...] }]; },
  async resolveSource(item, episode, config, ctx) { return { url, type }; },
  async findSources(query, config, ctx) { return [{ url, type, label }]; },
  embedOrigins: ["https://reproductor.ejemplo"]   // solo si entrega reproductores por iframe
};
```

- **`load`** devuelve títulos con la forma descrita en `catalog/model.js`: `id`, `kind`, `title`, más los opcionales (`year`, `categories`, `poster`, `backdrop`, `description`, `tmdbId`, `imdbId`, `seasons`, `lazySeasons`, `source`…). Usá `source: { lazy: true }` si la dirección se pide al reproducir.
- **`findSources(query)`** recibe `{ kind, title, year, externalIds, season, episode }` y devuelve fuentes para títulos de **otros** proveedores, por ejemplo buscando por `externalIds.tmdb`.
- Fuentes: `{ url, type }` con `type` `"video/mp4"`, `"application/x-mpegurl"`, `""` (se detecta) o `"embed"` (iframe).
- Usá siempre `signal` en tus `fetch(url, { signal })`, para que la app pueda cortar consultas lentas.

## Lo que hace la app por vos

- **Valida el adaptador** al registrarlo. Si no cumple el contrato, se descarta con un aviso sin afectar a los demás.
- **Aísla cada consulta:** tiempo máximo de 20 s, máximo 20.000 títulos y una espera de 30 s entre actualizaciones forzadas. Si un proveedor falla, los demás siguen.
- **Valida las respuestas:** descarta títulos incompletos, tipos que el adaptador no declaró y fuentes con esquemas inseguros (`javascript:`, etc.).
- **Reproductores externos:** solo `https` y solo de los `embedOrigins` declarados. El iframe usa `referrerpolicy="origin"` y `sandbox` (sin ventanas emergentes ni navegación de la página). La app no lee ni modifica su contenido.
- **Secretos:** los campos `password` (o `secret: true`) nunca aparecen en errores, avisos ni datos del catálogo.
- **Interfaz:** Ajustes muestra el adaptador con sus campos, tipos de contenido, capacidades, estado y errores, y permite activarlo, desactivarlo, actualizarlo y quitarlo.

## Registrar uno nuevo

1. Crear `src/providers/mi-proveedor.js` con el contrato.
2. En `src/providers/registry.js`, importarlo y sumarlo a la lista que se pasa a `registerProviderType`.
3. Aparece en Ajustes → "Agregar proveedor".

## Credenciales

La app todavía no tiene servidor, así que hoy la configuración de cada proveedor se guarda **en el navegador** de quien la carga. No uses claves que no deban quedar en ese equipo. Cuando exista el backend, los campos secretos pasarán a guardarse en el servidor (variables de entorno o base de datos), y el adaptador correrá ahí sin cambiar su contrato.

## Pruebas

Copiá el patrón de `tests/arquitectura.test.js`, que usa adaptadores **simulados**: registrar, configurar, activar, simular errores, respuestas incompletas y tiempos de espera. Después corré:

```bash
npm test
```

No incluyas proveedores reales con credenciales en las pruebas.

## Contenido y derechos

Agregar un adaptador es una decisión de quien opera la app. Usá solo proveedores que tengan derechos sobre lo que distribuyen y cuyas condiciones permitan este uso.
