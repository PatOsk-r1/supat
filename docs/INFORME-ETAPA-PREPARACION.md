# Informe: etapa final de preparación de las fuentes (2026-11-05)

Esta etapa resuelve los riesgos de `docs/AUDITORIA-FUENTES.md`. **No se conectó ninguna fuente real, no se usaron credenciales reales y no se publicó nada.**

**Categorías de verificación** (la columna "Verificación" de cada tabla):

| Código | Significa | Qué se usó |
|---|---|---|
| **A** | Probado automáticamente | `npm test`, con APIs simuladas |
| **C** | Probado en el motor real de Cloudflare local | workerd + D1 local (`wrangler dev`) |
| **N** | Probado manualmente en el navegador | |
| **R** | Revisado solo en el código | |
| **P** | Pendiente de integración real | |

## Resultado de las pruebas

| | Cantidad |
|---|---|
| Total | **121** |
| Aprobadas | **115** |
| Fallidas | **0** |
| Omitidas | **6** |

Las 6 omitidas son `tests/integracion-real.test.js`: necesitan fuentes reales configuradas y solo corren con `SUPAT_INTEGRACION=1`.

**Pruebas nuevas:**
- `tests/preparacion.test.js`: 17 pruebas.
- `tests/auditoria.test.js`: 10 pruebas de la etapa anterior.

**Pruebas anteriores ajustadas a las reglas nuevas:** 7 en `tests/fuentes-ab.test.js`. La fuente simulada B ya no usa la credencial en la URL; la página repetida ahora deja la importación **parcial**; los subtítulos informan su formato.

---

## 1. Paginación independiente por endpoint (prioridad crítica)

| | |
|---|---|
| **Qué se modificó** | Cada endpoint (películas, series, anime, temporadas, episodios, prueba) tiene: **tipo** de paginación (general, ninguna, página, offset, cursor, enlace), **parámetro**, **resultados por página**, **rutas** del siguiente, de última página, de total de páginas y de total de resultados, **máximo de páginas** y **de registros**, y qué hacer ante una página **vacía**, **repetida** o **inválida**. Si un campo queda vacío, se usa el de la paginación general. Cada página informa **por qué terminó** el listado: fin natural o anomalía. Una anomalía deja la importación **PARCIAL**. |
| **Archivos** | `src/shared/fuente-esquema.js`, `worker/src/providers/configurable.js` (`paginationFor`), `worker/src/providers/generic-http.js` (`nextCursor`), `worker/src/sync.js` |
| **Pruebas** | Dos endpoints con paginaciones distintas (página y enlace) en la misma fuente; límite de páginas → parcial, sin bajas; respuesta inválida → "falla" o "parcial"; cursor y enlace en la API simulada C; página repetida → parcial. |
| **Verificación** | **A**. **C**: dos fuentes importadas en workerd con la paginación nueva. |
| **Limitaciones** | Un endpoint mal configurado puede seguir terminando antes de tiempo **si la fuente no informa el total ni un indicador de última página** y devuelve una página corta o vacía: no hay forma de distinguirlo de un fin real. Para listados largos conviene configurar el total o la última página. |
| **Configuración** | Desde la interfaz. |

## 2. Límites y pausas de cada fuente

| | |
|---|---|
| **Qué se modificó** | Por fuente: intervalo mínimo entre solicitudes, máximo por ventana de tiempo, respetar `Retry-After`, qué hacer ante un 429 (esperar sin gastar reintentos, o contarlo como reintento), espera máxima y los reintentos de siempre. El estado (próxima solicitud permitida y ventana) se guarda en la tabla `provider_state`. Persiste entre tandas, reinicios y ejecuciones del cron: una tanda que encuentra una espera pendiente **no consulta** a la fuente y pospone el trabajo. Cada posposición queda en el registro técnico (`rate`). |
| **Archivos** | `worker/migrations/0005_preparacion_fuentes.sql`, `worker/src/provider-state.js`, `worker/src/providers/contract.js` (`guardedFetch`), `worker/src/providers/registry.js`, `worker/src/sync.js`, `worker/src/play.js` |
| **Pruebas** | 429 con `Retry-After` → pospuesto ~120 s sin gastar reintentos, y una tanda forzada antes de tiempo **no** hizo solicitudes; máximo por ventana y espera mínima respetados en la tanda siguiente; reinicio de un trabajo antes de terminar. |
| **Verificación** | **A**. **C**: `provider_state` guardó estado para las dos fuentes. |
| **Limitaciones** | Se evitan dos importaciones a la vez de la misma fuente: hay un solo trabajo activo por fuente, con candado. Pero las herramientas de prueba de Ajustes y la reproducción de los usuarios consultan la fuente por su cuenta. Respetan una espera pendiente, aunque **no suman** sus solicitudes a la ventana guardada; solo se guarda el estado cuando la fuente pide esperar. Con un límite de ventana muy justo, conviene dejar margen. |
| **Configuración** | Desde la interfaz. |

## 3. Episodios ausentes

| | |
|---|---|
| **Qué se modificó** | En una importación **completa** se marca como vistos también a los episodios sin cambios. Al terminar, y solo si no hubo **ninguna anomalía**, se marcan como no disponibles **en esa fuente** los episodios que no aparecieron. No se marcan si hubo errores de red no recuperados, paginación incompleta, respuestas inválidas o límites alcanzados. Se evalúan solo las series recorridas completas en esa importación y que devolvieron al menos un episodio. Un episodio sigue visible si otra fuente lo ofrece. No se borra nada. Umbral configurable (porcentaje y mínimo): si se supera, no se marca nada y la importación queda parcial. La cantidad y el motivo quedan en el resultado del trabajo y en el registro. |
| **Archivos** | `worker/src/catalog.js` (`upsertEpisodes`), `worker/src/sync.js`, `src/shared/fuente-esquema.js` |
| **Pruebas** | Importación parcial (episodios con 404) → 0 bajas; completa → bajas detectadas y el episodio sigue visible si lo ofrece la otra fuente; serie que devuelve 0 → 0 bajas; ausencias por encima del umbral → parcial; umbral subido → se marcan. |
| **Verificación** | **A**. **C**: en workerd se marcaron filas viejas de pruebas anteriores (con el formato de IDs previo) al confirmar las bajas. |
| **Configuración** | Desde la interfaz. |

## 4. Prioridades de datos entre fuentes

| | |
|---|---|
| **Qué se modificó** | Cada fuente guarda sus propios datos descriptivos (`meta_json`). El valor que se muestra en cada campo es el de la fuente **con más prioridad que lo tenga**; un campo vacío nunca borra otro. Se eliminó la regla anterior de "la primera fuente que importa manda". Hay una sección nueva en Ajustes, **Prioridad de datos entre fuentes**, solo para el propietario. **Guardar** deja la configuración pendiente y no cambia datos. **Vista previa** dice qué cambiaría, por campo y con ejemplos. **Aplicar** exige confirmación y recalcula el catálogo con una tarea por tandas (`maint_jobs`), que se puede reanudar y que también avanza sola con el cron. Todo queda en la auditoría: guardar, aplicar y terminado. La deduplicación sigue siendo solo por TMDb e IMDb. |
| **Campos** | Título, título original, sinopsis, póster, imagen de fondo, géneros, año, fecha de estreno, puntaje; y de los episodios: título, sinopsis, imagen y duración. |
| **No incluidos, y por qué** | "**Temporadas**" y "**episodios**" como conjunto: la lista de episodios es la unión de las dos fuentes, no se elige una. **Duración de películas**: ninguna fuente la mapea hoy (no hay campo). **Fecha de estreno**: se guarda por fuente y entra en la prioridad, pero el catálogo todavía no la muestra. |
| **Archivos** | `worker/src/priorities.js`, `worker/src/priorities-routes.js`, `worker/src/catalog.js`, `worker/src/catalog-text.js`, `src/ui/views/priorities-settings.js`, `src/ui/app.js`, `src/app/central-admin.js` |
| **Pruebas** | Dos fuentes con datos distintos (manda la prioridad aunque la otra importe primero; un dato vacío no borra); guardar no cambia, vista previa correcta, aplicar sin confirmación se rechaza y queda auditado; interrupción con candado tomado y reanudación de 200 títulos. |
| **Verificación** | **A**. **C**: guardar, vista previa, aplicar sin y con confirmación, y restaurar, en workerd. La **pantalla** de Ajustes es **R**: no se pudo entrar como propietario porque los emuladores de Firebase estaban ocupados por otra sesión. |
| **Limitaciones** | Los títulos importados **antes** de esta etapa no tienen datos por fuente hasta que se vuelvan a importar: la siguiente importación los completa, aunque no hayan cambiado. Mientras tanto conservan sus valores actuales. La vista previa evalúa hasta 400 títulos y 400 episodios con datos de las dos fuentes, y avisa cuántos hay en total. |
| **Configuración** | Desde la interfaz. |

## 5. Importaciones incompletas: estados

| | |
|---|---|
| **Qué se modificó** | Cada trabajo terminado tiene un resultado y su motivo: **Completada**, **Completada con advertencias** (registros descartados o posibles duplicados), **Parcial** o **Fallida**. Mientras corre: **Pendiente**, **En curso**, **En espera** (límite de frecuencia) o **Pausada**. Una importación queda **parcial**, sin bajas ni fecha de sincronización completa, si: no terminó la paginación; se alcanzó un límite; hubo una página repetida o vacía antes de tiempo; una respuesta fue inválida (con la opción "parcial"); una serie no se pudo consultar; o hubo ausencias anormales. Los errores no recuperados la dejan **fallida**. Ajustes muestra el estado y la causa. |
| **Archivos** | `worker/src/sync.js`, `worker/src/admin.js`, `worker/migrations/0005_preparacion_fuentes.sql`, `src/ui/views/sources-settings.js` |
| **Pruebas** | Límite de páginas → parcial; respuesta inválida → fallida o parcial; episodios con 404 → parcial; ausencias anormales → parcial; dos endpoints completos → completa. |
| **Verificación** | **A**. **C**: "completada con advertencias" en las dos fuentes de workerd. Lo que muestra Ajustes es **R**. |
| **Configuración** | Desde la interfaz. |

## 6. Autenticación

| | |
|---|---|
| **Qué se modificó** | Tipo nuevo: **"Inicio de sesión: usuario y contraseña → token"**. Se configuran la ruta, el formato del cuerpo (JSON o formulario), los nombres de los campos, otros campos, la ruta del token, la ruta del vencimiento o una duración fija, y el encabezado y prefijo del token. El token se guarda **cifrado** en `provider_state`, se reutiliza, se renueva al vencer y, ante un **401**, se pide uno nuevo y se reintenta una vez. Nunca se devuelve al navegador ni aparece en registros. La autenticación de reproducción es independiente: credencial de reproducción en encabezado, parámetro o cuerpo, solo al pedir el enlace. Además, el endpoint de reproducción usa la misma autenticación del catálogo (incluido el token de sesión). |
| **Archivos** | `worker/src/provider-state.js` (`makeSession`), `worker/src/providers/configurable.js`, `src/shared/fuente-esquema.js` |
| **Pruebas** | Inicio de sesión rechazado → mensaje claro, sin credenciales en la respuesta y sin token guardado; token cifrado, reutilizado y renovado ante 401; reproducción con el token. |
| **Verificación** | **A**. No se probó en workerd (el proveedor de prueba local no tiene inicio de sesión). |
| **Requiere código** | **OAuth** (autorización, `refresh_token` y similares), **renovación con un endpoint distinto** al de inicio de sesión, **firmas por solicitud** (por ejemplo HMAC), **inicio de sesión con captcha o en dos pasos**, y **un inicio de sesión separado solo para reproducir**. No están implementados ni se presentan como configurables. |

## 7. Reproducción y seguridad

| | |
|---|---|
| **Qué se modificó** | **Se eliminó** la opción de poner la credencial dentro de la URL del video. Cualquier plantilla (de video o de subtítulos) que use una credencial deja la fuente **NO COMPATIBLE con reproducción directa**. Opciones nuevas: "El servidor de video exige encabezados propios" y "exige cookies", que también la dejan no compatible. Las capacidades "reproducir películas" y "reproducir episodios" pasan a "no soportado" y la prueba de reproducción lo explica. Siguen vigentes: dominios permitidos, rechazo de enlaces con credenciales privadas, enlaces que vencen (renovación al reintentar) y elección de fuente. Sin proxy de video. |
| **Archivos** | `worker/src/providers/configurable.js`, `worker/src/play.js`, `worker/src/sources.js`, `src/shared/fuente-esquema.js` |
| **Pruebas** | Credencial en plantilla → no compatible; cookies exigidas → no compatible; enlaces con credencial privada o de otro dominio rechazados; elección de fuente y paso a la otra si una falla; reproducción con credencial en encabezado del lado del servidor. |
| **Verificación** | **A**. **C**: reproducción resuelta en workerd (200, HLS). La renovación del enlace vencido en el reproductor es **R**. |
| **Limitaciones** | **CORS** depende del servidor de la fuente y no se configura: hls.js lo necesita. Que los segmentos HLS no exijan nada se comprueba recién con la integración real (**P**). |

## 8. Subtítulos

| | |
|---|---|
| **Qué se modificó** | Subtítulos obtenidos por **endpoint** (ya existía), por **plantilla** (película y episodio, con una lista de idiomas) y por **URL del catálogo** (título y episodio, con el idioma por defecto). Los **SRT** se convierten a WebVTT **en el navegador**, sin proxy: el servidor de subtítulos tiene que permitir CORS. Hay un **selector de idioma** en el reproductor, con opción "Sin subtítulos". Se descartan los subtítulos cuya URL contiene una credencial. |
| **Archivos** | `src/player/subtitles.js` (nuevo), `src/player/player.js`, `worker/src/providers/configurable.js`, `worker/src/play.js` |
| **Pruebas** | Conversión SRT → WebVTT; detección de formato; plantilla de película y de episodio con dos idiomas; URL del catálogo (SRT); plantilla con credencial → no compatible. |
| **Verificación** | **A**. **N**, en la página de prueba `tests/fixtures/reproductor-subtitulos.html` (video generado en el navegador, un WebVTT y un SRT): el selector mostró "Sin subtítulos / Español (es) / English (en)"; el SRT se convirtió y se mostró ("Hello…"); el cambio a español mostró su texto; "Sin subtítulos" los apagó. Se verificó leyendo el estado del reproductor, porque no se pudo tomar una captura con el panel oculto. |
| **Limitaciones** | Subtítulos de otro dominio obligan a pedir el video con CORS. Si el servidor de video no lo permite, se reproduce sin subtítulos (fallback, **R**). Los subtítulos dentro de la lista HLS dependen de hls.js y **no se probaron**. |

## 9. Pendiente de integración real (P)

Todo lo anterior se probó con APIs simuladas: falta conectar y probar con cada fuente real, una por vez (`npm run test:integracion`). En particular:
- el comportamiento con el límite de 10 ms de CPU de Cloudflare en importaciones grandes;
- CORS de los servidores de video y de subtítulos;
- los segmentos HLS;
- los límites reales de cada API.

---

## Riesgos que todavía impiden conectar fuentes reales

1. **Estructuras que el motor no maneja.** Siguen sin poder configurarse: **valores constantes**, **transformaciones** (escalas, unidades, formatos de fecha), **combinar campos**, **consulta de detalle por título**, **episodios dentro de la respuesta de la serie**, **temporadas con ID interno**, **un endpoint que mezcla tipos**, respuestas que no son JSON, y los flujos de autenticación del punto 6. Si la documentación de una fuente necesita alguno, hace falta **código** antes de conectarla.
2. **Fin de listado indistinguible.** Si una fuente no informa el total ni la última página, una página corta o vacía se toma como fin del listado. Riesgo de catálogo incompleto **sin aviso** si la fuente falla así: hay que configurar total o última página cuando existan.
3. **Pantallas sin probar en el navegador.** Las de Ajustes de esta etapa (campos de paginación por endpoint, límites, inicio de sesión, prioridades, estados) **no se probaron** en el navegador: falta entrar como propietario con los emuladores libres.
4. **Ninguna prueba con fuentes reales** (punto 9).

**Conclusión: Supat todavía NO está listo para integrar fuentes reales** hasta revisar la documentación de cada fuente contra el riesgo 1, probar las pantallas del riesgo 3 y correr la integración real de a una fuente.

## Funcionalidades que siguen necesitando código específico

- Las estructuras del riesgo 1.
- OAuth y otros flujos de autenticación (punto 6).
- Cualquier fuente que exija encabezados, cookies o credenciales en la URL del video: no es compatible con reproducción directa, y la única alternativa sería un proxy, que no está autorizado (costo y condiciones del plan gratuito).
- Mostrar la fecha de estreno y la duración de películas en el catálogo, si se quieren.
