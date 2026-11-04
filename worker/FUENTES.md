# Fuentes de contenido: Fuente A y Fuente B

Supat puede usar **dos fuentes externas independientes**. Se configuran completas desde **Ajustes → Fuentes de contenido** (solo el propietario), sin tocar código ni variables de entorno. Todos los campos empiezan **vacíos**.

## Arquitectura

```
Ajustes (navegador, propietario)
   │  formulario de cada tarjeta (sin credenciales guardadas a la vista)
   ▼
Worker (worker/src/sources.js) ── valida permisos y datos ── guarda en D1:
   │      providers.config_json = { form }      (configuración, sin secretos)
   │      providers.secrets_enc = AES-GCM(...)   (credenciales, cifradas)
   ▼
Adaptador configurable (worker/src/providers/configurable.js)
   │  traduce el formulario a la especificación del motor genérico
   │  (es la capa de normalización: cada fuente tiene su propio mapeo)
   ▼
Motor genérico (generic-http.js): consultas, autenticación, paginación y mapeo
   ▼
Importación por tandas (sync.js) → catálogo único en D1 (titles, title_sources,
episodes, episode_sources) → app (búsqueda, fichas, reproductor)
```

- **Datos separados:** la información descriptiva (título, año, pósters, sinopsis, ids de TMDb e IMDb) vive en `titles` y `episodes`. Lo que hace falta para reproducir vive en `title_sources` y `episode_sources`, **una fila por fuente**. Un título puede estar en el catálogo aunque todavía no tenga fuente de reproducción.
- **El esquema de campos** (`src/shared/fuente-esquema.js`) es uno solo y lo usan la interfaz y el servidor.

## Campos de cada tarjeta

| Sección | Campos |
|---|---|
| **Identificación y conexión** | Nombre interno · Nombre visible · URL base · Método HTTP por defecto · Tiempo máximo por consulta · Reintentos · Espera entre reintentos · Pausa mínima entre consultas |
| **Autenticación** | Tipo: ninguna, API Key en encabezado o parámetro, token Bearer, usuario y contraseña, o solo personalizados · Nombre del encabezado o parámetro · API Key · Token · Usuario · Contraseña · Encabezados personalizados (secretos) · Parámetros adicionales (secretos) |
| **Catálogo** | Qué categorías importar (películas, series, anime, temporadas y episodios) · Por cada endpoint (películas, series, anime, temporadas, episodios y prueba de conexión): ruta, método, paginación propia o general, ruta del array de resultados, parámetros y encabezados |
| **Paginación** | Tipo: página, desplazamiento (offset), cursor o enlace siguiente · Parámetro de página · Parámetro de tamaño · Resultados por página · Primera página · Ruta de la información de paginación · Cursor o enlace siguiente · Indicador de última página · Total de páginas · Total de resultados · Parámetro y formato de "cambios desde" (sincronización incremental) |
| **Mapeo** | ID · Tipo · TMDb · IMDb · Título · Título original · Descripción · Póster · Backdrop · Año · Fecha de estreno · Géneros · Puntaje · Cantidad de temporadas · Cantidad de episodios · Fecha de actualización · URL de reproducción · Otros campos · Prefijos de imágenes · Número de temporada · Episodios (ID, temporada, número, título, descripción, imagen, duración, URL y otros campos) |
| **Reproducción** | Método: armar la URL, pedirla a un endpoint o tomarla directa del catálogo · URL base de reproducción · Plantillas de películas y de episodios · Parámetros de película, serie, temporada y episodio · Parámetros adicionales · Encabezados · Endpoints de reproducción · Rutas de URL, formato, vencimiento y subtítulos · Credencial de reproducción y dónde va · Dominios permitidos · Tipo de contenido (video o reproductor externo) · Formato · Idioma · Duración de los enlaces |

**Cómo se escriben algunos campos:**
- **Rutas dentro de las respuestas JSON:** `a.b`, `a[0].b`, `lista[].nombre`; para alternativas, `a|b`.
- **Variables en plantillas y parámetros:** `{id}`, `{seriesId}`, `{season}`, `{episode}`, `{tmdb}`, `{imdb}`, `{lang}`, `{data.campo}`.

## Herramientas de cada tarjeta

- **Configuración:**
  - **Guardar configuración** valida los datos básicos y dice qué falta.
  - **Activar** o **desactivar** la fuente. Activar exige lo mínimo para importar y lo enumera si falta.
- **Pruebas:**
  - **Probar conexión.**
  - **Probar catálogo** de una categoría: cuántos resultados vinieron, cuántos son válidos, si hay más páginas y qué campos del mapeo se encontraron.
  - **Probar reproducción** de una película o un episodio: el servidor obtiene el enlace y comprueba que responda, sin devolverlo.
- **Importación:**
  - **Iniciar importación** (completa) y **Sincronizar cambios** (incremental).
  - **Pausar**, **reanudar** y **reiniciar**. Reiniciar pide confirmación y conserva lo importado.
- **Consultas:**
  - **Ver errores** (los últimos avisos y errores de esa fuente).
  - Estado de la última prueba, avance de la importación y última sincronización.
- **Capacidades:** cada tarjeta muestra qué está configurado (✔) y qué **no está soportado** (—). Una función que falta no impide usar las demás.

## Credenciales

- **Dónde quedan:** se guardan cifradas con AES-GCM (`SECRETS_KEY`) y **nunca vuelven** al navegador. Ajustes solo muestra "Configurada" y, de los encabezados o parámetros personalizados, los **nombres**.
- **Qué se tapa:** errores, registros, auditoría y pruebas tapan los valores secretos.
- **Cómo se cambian:** dejarlas vacías al guardar las conserva; "Borrar la guardada" las quita.
- **Credencial de reproducción:** se usa solo para obtener o habilitar enlaces, nunca en las consultas del catálogo. Si la fuente exige que vaya **dentro de la URL que usa el navegador**, hay que elegirlo explícitamente ("Dentro de la URL que usa el navegador"). En ese caso **queda visible en el navegador**: no hay forma de ocultar una credencial que el navegador necesita para pedir el video, y la prueba de reproducción lo avisa.
- **Enlaces rechazados:** cualquier otra credencial que aparezca en un enlace hace que el enlace se rechace.
- **Dominios permitidos:** si se cargan, los enlaces de otros dominios se rechazan. Para un reproductor externo son obligatorios.

## Importación

- **Recorrido:** sigue todas las páginas de cada endpoint, por tandas: una por minuto con el cron, o "Continuar" en el panel. Se detiene antes de los límites del plan gratuito y sigue donde quedó.
- **Protección contra páginas repetidas:** si una API ignora el parámetro de página y devuelve lo mismo, el endpoint se corta. Para endpoints sin paginación hay que elegir "Sin paginación".
- **Reintentos:** se usan los de cada fuente, con espera que se duplica. Los errores 4xx fallan enseguida.
- **Errores:** nunca se borra ni se oculta contenido por un error. Las bajas se marcan solo al terminar bien una importación completa, y un título sigue visible mientras otra fuente lo tenga.
- **Duplicados:** se unen por TMDb, después por IMDb y después por el id de la misma fuente. **Nunca por título.** Los datos del título los define la fuente que lo creó; las demás solo completan lo que falta.

## Reproductor

La pantalla de reproducción consulta qué fuentes ofrecen el título o episodio y, si hay más de una, muestra botones con el **nombre visible** de cada fuente para cambiar.

- **Errores:** si una fuente falla, se prueba la siguiente.
- **Enlaces que vencen:** "Reintentar" pide un enlace nuevo, y si ya venció se pide solo.
- **Subtítulos:** los subtítulos WebVTT informados por la fuente se agregan al video. Si eso choca con CORS, se reproduce sin subtítulos y se avisa.
- **Formatos:** HLS, MP4 y WebM (los de siempre) y reproductor externo por iframe, solo de dominios permitidos. No hay proxy de video: el navegador reproduce directo desde la fuente.

## Qué información hace falta de cada fuente

Para cada fuente (A y B), de su documentación técnica:

1. **Conexión:** URL base y cómo se autentica (tipo, nombre del encabezado o parámetro, credenciales).
2. **Catálogo:** las rutas de películas, series y anime (las que existan), con su método, parámetros y dónde viene el array de resultados.
3. **Episodios:** si hay temporadas, la ruta de temporadas y la de episodios, y qué identificador usan.
4. **Paginación:** el tipo y sus parámetros, cómo se sabe que es la última página, y si permite pedir "cambios desde" una fecha.
5. **Ejemplos reales** de respuesta de cada ruta, para completar el mapeo: id, título, año, imágenes y su prefijo, TMDb, IMDb, temporada y episodio.
6. **Reproducción:**
   - si la URL se arma con una plantilla o con parámetros, o se pide a un endpoint (cuál y qué devuelve);
   - cómo se usa la credencial de reproducción;
   - formato (HLS o MP4), vencimiento y subtítulos;
   - de qué dominios vienen los videos y si permiten CORS.
7. **Límites de uso:** pedidos por segundo o por día, para cargar la pausa entre consultas.

Con eso se completa la tarjeta y se usan las herramientas de prueba. Las pruebas de integración real (`tests/integracion-real.test.js`) verifican cada fuente activa, por separado.

## Límites del plan gratuito (consultados el 2026-11-03 y el 2026-11-04 en developers.cloudflare.com)

- **CPU:** 10 ms por ejecución.
- **Consultas:** 50 consultas a D1 y 50 consultas externas por ejecución. La importación se reparte en tandas para respetarlo.
- **Filas escritas:** 100.000 por día en D1, unos 12.000 títulos nuevos por día **entre las dos fuentes**. Al pasarse, D1 no responde hasta el día siguiente: no cobra.
- **Pedidos:** 100.000 por día al Worker. El cron de cada minuto usa unos 1.440.
- **Sin proxy de video:** la reproducción no pasa por el Worker. Un proxy de video no sería viable en el plan gratuito (ver worker/README.md).
