# Catálogo central de Supat (API en Cloudflare Workers + D1)

Servidor que guarda **un catálogo compartido por todos los usuarios**. El propietario incorpora proveedores de contenido desde el panel de Supat. El servidor importa sus títulos, los guarda sin duplicados y, al reproducir, resuelve la fuente.

```
Supat (navegador) ──token de Firebase──▶ Worker (worker/src) ──▶ D1 (base SQLite)
        ▲                                     │
        └──── títulos, búsqueda, fuente ◀─────┴──▶ APIs de los proveedores (con sus credenciales)
```

- **Cuentas:** las sigue manejando Firebase Auth, sin cambios. El Worker verifica la firma del token en cada pedido.
- **Proveedores del navegador:** Internet Archive, listas M3U y Jellyfin siguen funcionando como antes, en Ajustes. El catálogo central se suma como un proveedor más ("Catálogo central de Supat").
- **Todo gratuito:** usa el plan Free de Cloudflare (Workers, D1 y Cron Triggers). No hace falta tarjeta.

## Archivos

| Archivo | Qué hace |
|---|---|
| `wrangler.toml` | Configuración: base D1, cron, variables públicas y el entorno local. |
| `migrations/0001_catalogo.sql` | Tablas de usuarios, proveedores, títulos, fuentes, episodios, trabajos, registros y auditoría. También el índice de búsqueda (FTS5). |
| `src/index.js` | Rutas de la API y tareas programadas. |
| `src/auth.js` | Verifica el token de Firebase, asigna el rol, controla la suspensión y el "cerrar todas las sesiones". |
| `src/secrets.js` | Cifrado de credenciales (AES-GCM) y ocultamiento en textos. |
| `src/catalog.js` | Guardar sin duplicados (TMDb/IMDb), episodios, listado, búsqueda y ficha. |
| `src/sync.js` | Importación por tandas: reanudable, con reintentos y cron diario. |
| `src/play.js` | Fuente de reproducción (prueba los proveedores en orden). |
| `src/admin.js` | Rutas del propietario. |
| `src/providers/` | Contrato de adaptadores, adaptador genérico HTTP/JSON e Internet Archive. |

## Roles y permisos

| Rol | Qué puede hacer |
|---|---|
| `user` | Ver el catálogo, buscar, abrir fichas y reproducir. Necesita el correo verificado y la cuenta sin suspender ni bloquear. |
| `owner` | Todo lo anterior, más el panel: proveedores, sincronización, usuarios y permisos, registros e infraestructura. |

- **Propietarios iniciales:** son los uid de Firebase que figuran en `OWNER_UIDS`, en `wrangler.toml`. No se pueden quitar desde el panel.
- **Asignación de roles:** un propietario puede hacer propietario a otro usuario, o bloquearlo. Nadie puede cambiar su propio rol. Un dato agregado al token (por ejemplo `role: "owner"`) se ignora.
- **Validación:** cada ruta comprueba la sesión y el rol en el servidor (`index.js` → `authenticate` + `requireUser`/`requireOwner`). La única ruta pública es `GET /api/health`, que solo responde `{ ok: true }`.
- **Suspensión:** la suspensión y el "cerrar todas las sesiones" del módulo de cuentas se respetan. El Worker lee el perfil de Firestore con el token del propio usuario, como mucho una vez cada 5 minutos. Las sesiones de más de 30 días se rechazan, igual que en `firestore.rules`.

## Seguridad de las credenciales

- Las credenciales se cargan en el panel en campos de contraseña y viajan **una sola vez** al servidor.
- El servidor las guarda **cifradas** con AES-GCM. La clave de cifrado es `SECRETS_KEY`, un secreto del Worker que no está en el código.
- **Nunca vuelven** al navegador. Las respuestas solo dicen qué campos están cargados (`secretsSet: ["apiKey"]`). Un campo vacío al guardar conserva la credencial; para borrarla hay que marcar "Borrar la guardada".
- **Textos protegidos:** errores, registros y auditoría pasan por `redact()`, que tapa los valores secretos y sus versiones codificadas. La auditoría guarda el **nombre** del campo cambiado, nunca su valor.
- **Fuentes de reproducción:** si la dirección contiene una credencial, el servidor **no la entrega** y registra un aviso. Para esos proveedores haría falta un proxy de video, que no está implementado.
- **Reproductores externos (iframe):** solo se aceptan de los orígenes `https` declarados en la especificación.
- **Sin servidor no se guardan credenciales:** si falta `SECRETS_KEY`, el servidor se niega a guardarlas (responde 503).

## Importación y sincronización

- **Por tandas:** un trabajo recorre el catálogo del proveedor página por página y guarda dónde quedó. Cada ejecución procesa `SYNC_PAGES_PER_RUN` páginas (3 por defecto) y se detiene.
- **Cron:**
  - Todos los días a las 05:00 UTC arranca la sincronización **incremental** de cada proveedor activo con sincronización diaria.
  - Cada 10 minutos sigue los trabajos pendientes. Si no hay ninguno, no hace nada.
- **Desde el panel:** "Sincronizar ahora" o "Importación completa" procesan la primera tanda en el momento. "Continuar" procesa la siguiente.
- **Incremental:** si la especificación usa `{since}`, se piden solo los cambios desde la última sincronización completa (con 1 hora de margen). Si no, se recorre todo, pero lo que no cambió no se reescribe: se compara una huella del contenido.
- **Completa:** además marca como "no disponible" lo que el proveedor dejó de ofrecer. **No borra nada:** el título se oculta y queda guardado.
- **Reintentos:** ante 429, errores 5xx o fallas de red, se reintenta a los 1, 2, 4 y 8 minutos. Al quinto intento fallido el trabajo queda "Falló". Los errores 4xx (credenciales, rutas) fallan enseguida, porque reintentar no los arregla.
- **Episodios:** si una serie da error permanente al pedir sus episodios, se registra el aviso y se sigue con las demás. Si alguien abre una serie cuyos episodios todavía no se importaron, se piden en ese momento (unas pocas páginas).
- **Un trabajo por proveedor:** pedir otra sincronización mientras hay una en curso devuelve la que ya existe.

## Duplicados

Un título que llega se une a uno existente, en este orden:

1. Mismo proveedor y mismo id: es el mismo título.
2. Mismo id de **TMDb**. Va por tipo, porque TMDb numera aparte las películas y las series.
3. Mismo id de **IMDb**.

Si no coincide ninguno, es un título nuevo.

- **Qué datos se usan:** los del proveedor que creó el título. Los demás solo completan lo que falta.
- **Conflictos:** si TMDb e IMDb apuntan a títulos distintos, se une por TMDb y se registra un aviso de "posible duplicado". No se une ni se borra nada a ciegas.

## Adaptador genérico (HTTP/JSON): especificación

Sirve para **cualquier API que responda JSON**, sin código nuevo. El propietario la carga en el panel: "Agregar proveedor" → "API HTTP genérica (JSON)".

**Campos del formulario:**

- **Dirección base**, por ejemplo `https://api.proveedor.com/v1`. Tiene que ser https; se permite http solo en `localhost`.
- **Especificación (JSON)**: el formato está abajo.
- **Credenciales opcionales:** `apiKey`, `token`, `username`, `password`.

**Un ejemplo con una API inventada.** Es el mismo proveedor simulado que usan las pruebas, en `tests/helpers/proveedor-simulado.js`:

```json
{
  "auth": [{ "in": "header", "name": "X-Api-Key", "value": "{apiKey}" }],
  "minIntervalMs": 250,
  "catalog": {
    "movie": {
      "path": "/movies",
      "query": { "page": "{page}", "changed_since": "{since}" },
      "items": "results",
      "pagination": { "type": "page", "start": 1, "totalPages": "total_pages" },
      "map": { "id": "id", "title": "title", "year": "release_date", "description": "overview",
               "poster": "poster_path", "categories": "genres[].name", "tmdb": "ids.tmdb", "imdb": "ids.imdb" },
      "prefix": { "poster": "https://img.proveedor.com/w500" }
    },
    "series": {
      "path": "/series", "query": { "cursor": "{cursor}" }, "items": "data",
      "pagination": { "type": "cursor", "next": "meta.next" },
      "map": { "id": "id", "title": "name", "tmdb": "tmdb_id", "data.slug": "slug" }
    }
  },
  "seasons":  { "path": "/series/{data.slug}/seasons", "items": "seasons", "map": { "number": "season_number" } },
  "episodes": { "path": "/series/{data.slug}/seasons/{season}/episodes", "items": "episodes",
                "map": { "id": "id", "number": "episode_number", "title": "name", "playback.url": "stream" },
                "playbackType": "hls" },
  "resolve":  { "path": "/play/{id}", "url": "stream.url", "type": "stream.type" },
  "embedOrigins": ["https://reproductor.proveedor.com"]
}
```

| Clave | Qué es |
|---|---|
| `auth` | Lista. `{ "in": "header" \| "query", "name": "…", "value": "…{apiKey}…" }` o `{ "in": "basic" }` (usa `username` y `password`). **Las credenciales solo pueden ir acá**: si aparecen en `path` o `query`, la especificación se rechaza. |
| `headers` | Encabezados fijos que no son secretos. |
| `minIntervalMs` | Pausa mínima entre consultas, para respetar los límites del proveedor. |
| `catalog.<tipo>` | Una ruta por tipo: `movie`, `series`, `anime` o `live`. |
| `path` / `query` / `method` / `body` | La consulta. Admite `{page}`, `{offset}`, `{limit}`, `{cursor}`, `{since}`, `{id}`, `{data.<campo>}`, `{season}` y `{number}`. Un parámetro cuyo valor queda vacío no se manda. |
| `items` | Ruta hasta la lista de resultados dentro de la respuesta. |
| `pagination` | `{ "type": "page", "start", "totalPages" }`, `{ "type": "offset", "limit", "total" }`, `{ "type": "cursor", "next" }`, `{ "type": "link", "next" }` (tiene que ser del mismo servidor) o `{ "type": "none" }`. |
| `sinceFormat` | Formato de `{since}`: `iso` (por defecto), `date`, `unix` o `unixms`. |
| `map` | De dónde sale cada dato. Rutas como `a.b`, `a[0].b` o `lista[].nombre`; alternativas con `\|`; constante con `"=campo": "valor"`. Datos: `id`, `title`, `originalTitle`, `year`, `description`, `poster`, `backdrop`, `categories`, `rating`, `tmdb`, `tmdbType`, `imdb`, `hasEpisodes`, `playback.url`, `playback.type`, `data.<lo que el adaptador necesite después>`. |
| `prefix` | Prefijo para las imágenes que vienen como ruta relativa. |
| `seasons` | Opcional: lista de temporadas de una serie. Si está, los episodios se piden por temporada con `{season}`. |
| `episodes` | Episodios de una serie: `id`, `season`, `number`, `title`, `description`, `still`, `duration`, `playback.url`, `playback.type`. |
| `resolve` / `resolveEpisode` | Cómo pedir la fuente al reproducir, si el catálogo no la trae: `url` y `type` son rutas dentro de la respuesta. `typeValue` fija el tipo. |
| `playbackType` | Tipo fijo de las fuentes: `hls`, `mp4`, `webm` o `embed`. |
| `embedOrigins` | Orígenes `https` permitidos para reproductores por iframe. |
| `test` | Opcional: ruta para "Probar conexión". Si falta, se pide la primera página del catálogo. |

Para un proveedor con una API que no encaja en este formato, se crea un adaptador propio en `src/providers/`, con el contrato de `contract.js`, y se suma en `registry.js`.

## Probar en tu PC (sin cuenta de Cloudflare)

```bash
npm install
npm run api:migrar:local
npm run api:clave
```

1. `npm install` instala todo; Wrangler y workerd ya están incluidos.
2. `npm run api:migrar:local` crea la base D1 local.
3. `npm run api:clave` genera una clave de cifrado. Creá el archivo `worker/.dev.vars`, que **no** se sube a Git, con este contenido:

   ```
   SECRETS_KEY="la clave generada"
   OWNER_UIDS="uid-de-tu-cuenta-de-prueba"
   ```

4. Arrancá en terminales separadas:

   ```bash
   npm run emuladores
   ```

   ```bash
   npm run api:dev
   ```

   ```bash
   npm run dev:emu
   ```

   Son las cuentas de prueba (necesitan Java), la API en `http://127.0.0.1:8788` y la app en modo emulador, que ya usa esa API.

Pruebas:

- **`npm test`:** pruebas automáticas, sin red. Usan SQLite de Node con el mismo esquema.
- **`node tests/e2e-api.mjs`:** punta a punta contra la API local, los emuladores y el proveedor de prueba. Este último se arranca con `node tests/helpers/servidor-proveedor.mjs`. La prueba usa `OWNER_UIDS="e2e-dueno"`.

## Publicar (necesita tu cuenta de Cloudflare: gratis, sin tarjeta)

Estos pasos crean recursos en **tu** cuenta, así que los tenés que autorizar vos:

1. Iniciá sesión en Cloudflare. Abre el navegador para que entres con tu cuenta:

   ```bash
   npx wrangler login
   ```

2. Creá la base D1:

   ```bash
   npx wrangler d1 create supat-catalogo
   ```

   Copiá el `database_id` que muestra en `worker/wrangler.toml`, en la sección principal.

3. Creá las tablas:

   ```bash
   npm run api:migrar
   ```

4. Generá una clave nueva y cargala como secreto. No uses la de `.dev.vars`:

   ```bash
   npm run api:clave
   ```

   ```bash
   npx wrangler secret put SECRETS_KEY --config worker/wrangler.toml
   ```

5. Poné tu uid de Firebase en `OWNER_UIDS`, en `wrangler.toml`. Está en la consola de Firebase → Authentication → Users.
6. Publicá. La dirección queda como `https://supat-api.<tu-subdominio>.workers.dev`:

   ```bash
   npm run api:publicar
   ```

7. Creá `.env.production` con `VITE_SUPAT_API=https://supat-api.<tu-subdominio>.workers.dev`. Después recompilá y publicá la app (`npm run build` y `firebase deploy --only hosting`).

La app se publica solo en Firebase Hosting. Sin `VITE_SUPAT_API` la app funciona como antes, sin catálogo central.

## Límites del plan gratuito (consultados el 2026-11-03 en developers.cloudflare.com)

| Límite | Valor | Cómo se respeta |
|---|---|---|
| CPU por ejecución | 10 ms | Tandas chicas (3 páginas) y procesamiento liviano. |
| Consultas externas por ejecución | 50 | Tope propio de 40 por tanda. Al llegar, el trabajo sigue en la próxima. |
| Consultas a D1 por ejecución | 50 (un `batch` cuenta como 1) | Lecturas agrupadas y escrituras en un solo `batch` por página. Las pruebas verifican que cada tanda quede por debajo de 50. |
| Filas escritas por día | 100.000 (los índices también cuentan) | No se reescribe lo que no cambió. Un título nuevo escribe unas 8 filas, así que alcanza para unos 12.000 títulos nuevos por día. |
| Filas leídas por día | 5.000.000 | La búsqueda usa el índice FTS5, no recorre la tabla. |
| Tamaño de la base | 500 MB | — |
| Cron Triggers | 5 por cuenta | Se usan 2. |
| Pedidos por día | 100.000 | — |

Si se pasa un límite diario, D1 responde con error hasta el día siguiente: **no genera cobros** en el plan gratuito.
