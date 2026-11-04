# Auditoría técnica: Fuente A y Fuente B (2026-11-04)

Se revisó el código, no solo la documentación. Cada afirmación está marcada:
- **[probado]**: hay una prueba automática o una corrida real en local que lo verifica;
- **[inspección]**: solo se revisó el código.

Todas las pruebas usan **APIs simuladas** (`tests/helpers/fuentes-simuladas.js` y `tests/auditoria.test.js`), que no son ni imitan a ningún proveedor real. **No se probó ninguna fuente real.**

Estado de las pruebas: **98 pasan y 6 quedan omitidas** (las de integración real). Antes de la auditoría pasaban 88.

---

## Problemas encontrados y corregidos

Cada uno se reprodujo primero con una prueba que fallaba. Se corrigió con un cambio acotado y la prueba pasó a dar bien.

| # | Problema | Consecuencia | Corrección |
|---|---|---|---|
| 1 | Los IDs de episodio de la fuente se guardaban tal cual. Si dos series usaban "1", "2"… | Los episodios de una serie **pisaban** los de otra. | Los IDs guardados llevan prefijo: `<serie>/<episodio>`. El ID original queda en `data.id` y es el que se usa en rutas y plantillas. |
| 2 | Una película y una serie con el mismo ID interno… | …se **pisaban**: una desaparecía. | Los IDs guardados llevan prefijo por tipo: `movie:7` y `series:7`. |
| 3 | Con un prefijo de imágenes, una imagen **vacía**… | …se convertía en una dirección falsa (solo el prefijo). | El prefijo se aplica solo a valores no vacíos. |
| 4 | La fuente que creó un título reemplazaba **todos** sus campos en cada actualización. | Si dejaba de mandar la sinopsis, el póster o los géneros, **se borraban**. | Un campo que llega vacío conserva el valor guardado. |
| 5 | En una importación completa, una página vacía por una falla temporal cortaba la paginación y el trabajo terminaba como "terminado". | **Se ocultaban** como no disponibles todos los títulos de las páginas siguientes (80 de 100 en la prueba). | Protección de bajas: si faltarían más del 10% (y más de 20), o si no llegó **nada**, no se marca ninguna baja y se registra el motivo. Si las bajas son reales, se confirman con "Reiniciar y confirmar bajas" (botón nuevo en la tarjeta). |
| 6 | Los subtítulos se agregaban al video pero no había **ningún control** para activarlos, y el navegador los deja apagados. | Los subtítulos nunca se veían. | Selector "Subtítulos" en el reproductor. **[inspección]** No se pudo verificar en el navegador con un video real. |

Las correcciones 2, 3 y 4 se probaron también en **workerd con D1 local [probado]**: los campos se conservaron, los episodios no se mezclaron y el episodio T2E1 se reprodujo con su ID nuevo.

**Compatibilidad:** los IDs con prefijo cambian cómo se guardan los títulos y episodios **nuevos**. La base publicada todavía no tiene fuentes, así que no la afecta. En las bases locales de prueba quedan filas viejas sin prefijo, que se marcan como no disponibles con "Reiniciar y confirmar bajas".

---

## 1. Configurador genérico

| Pedido | Estado |
|---|---|
| JSON anidado (`a.b.c`) | ✅ [probado] |
| Índices de arrays (`a[0].b`) | ✅ [probado] |
| Listas (`tags[].label` → géneros) | ✅ [probado] |
| Campos alternativos (`names.es\|names.en`) | ✅ [probado]. Se usa el primero que tenga valor. |
| Campos constantes | ❌ **No se puede configurar.** El motor lo soporta (claves `=campo`), pero Ajustes no tiene dónde cargarlo. |
| Transformaciones | ⚠️ Solo dos: el **prefijo** de imágenes y el **año** (primeros 4 caracteres de una fecha) [probado]. No hay conversión de escalas: un puntaje de 0 a 100 **se descarta**, porque se aceptan valores de 0 a 10 [inspección]. Tampoco de unidades (duración en minutos), de formatos de fecha distintos de AAAA…, ni tablas de valores. |
| Combinar varios campos | ❌ No implementado. |
| Consultas encadenadas | ⚠️ Solo **temporadas → episodios por temporada** [probado]. No hay una consulta de **detalle por título**: si el listado trae solo IDs y los datos vienen en otra ruta, no se puede. |
| Usar datos de una respuesta en otra consulta | ⚠️ Parcial: `{data.campo}` ("Otros campos" del título) en la ruta de episodios [probado] y en la reproducción [inspección]. También `{id}`, `{seriesId}`, `{season}`, `{episode}`, `{tmdb}` e `{imdb}`. Los datos de las **temporadas** no se guardan: solo su número. |
| Paginación por página, offset, cursor y enlace siguiente | ✅ [probado], una por cada fuente. Incluye total de páginas, total de resultados e indicador de última página. |
| Respuestas sin paginación | ✅ [probado]: general, o "sin paginación" por endpoint. |
| Estructuras distintas entre categorías | ⚠️ La **ruta del array** es por endpoint [probado]. El **mapeo es uno solo** para películas, series y anime; se resuelve con alternativas `a\|b` [probado], pero hay riesgo de tomar un campo equivocado. |
| Distinto **tipo** de paginación por endpoint | ❌ **No se puede.** Hay que elegir entre la general y "sin paginación". **Riesgo comprobado:** con la general en "cursor", un endpoint que pagina por enlace trae **solo la primera página, sin error** (1 de 3 en la prueba). |

**Estructuras que el motor hoy no maneja:**
- valores constantes;
- transformaciones (escalas, unidades, fechas, tablas de valores);
- combinar campos;
- pedir el detalle de cada título;
- tipos de paginación distintos por endpoint;
- mapeo distinto por categoría;
- cuerpos POST configurables (los endpoints POST solo mandan parámetros en la URL) [inspección];
- temporadas identificadas por un ID interno en vez de su número;
- episodios que vienen **dentro** de la respuesta de la serie;
- un endpoint que mezcla tipos y los distingue con un campo;
- respuestas que no son JSON;
- autenticación por login para obtener un token, renovación de tokens, OAuth y firmas por pedido;
- respetar el encabezado `Retry-After`.

## 2. Reproducción

| Escenario | ¿Se configura en Ajustes? |
|---|---|
| Autenticación para obtener el enlace (clave de la API más credencial de reproducción en encabezado, parámetro o cuerpo) | ✅ [probado] |
| Credencial de reproducción **dentro de la URL** del video | ✅ Hay que elegirlo explícitamente; queda visible en el navegador [probado, con aviso]. |
| URLs temporales: vencimiento informado por la respuesta o fijo | ✅ El servidor informa `expiresAt` [probado]. El reproductor pide un enlace nuevo al reintentar o si ya venció [inspección]. |
| HLS y sus segmentos | ✅ Si los segmentos no piden nada especial, o si traen su token en la URL de la lista [inspección]. Se reproducen directo desde la fuente, sin proxy. |
| **Encabezados que exige el servidor de video** | ❌ El navegador no puede mandarlos al reproducir. Haría falta código y exponer los valores, o un proxy. |
| **Cookies** del servidor de video | ❌ No se puede (cookies de otro sitio). Haría falta un proxy. |
| Subtítulos WebVTT informados por un endpoint | ✅ Se configuran [probado en el servidor]. En el navegador se agregan con selector, pero **no se verificaron con un video real**. Con los métodos "plantilla" y "directo" no hay subtítulos. Los SRT no se convierten. |
| Reproductor externo (iframe) | ✅ Solo de dominios permitidos [probado en el servidor]. |
| CORS | ⚠️ No se configura: depende del servidor de la fuente. hls.js lo necesita para HLS; un MP4 directo, no. Si los subtítulos de otro dominio obligan a pedir el video con CORS y falla, se reproduce sin subtítulos [inspección]. |
| DRM | ❌ No soportado, a propósito. |

No se implementó ningún proxy de video. Los motivos están en worker/README.md: límites del plan gratuito y condiciones de Cloudflare para video.

## 3. Series y episodios

| Estructura | Estado |
|---|---|
| Temporadas separadas (temporadas → episodios) | ✅ [probado] |
| Episodios directos, en una lista con número de temporada | ✅ [probado] |
| IDs internos repetidos entre series | ✅ [probado] (corrección 1) |
| Temporada especial (0) | ✅ [probado]. El navegador la muestra al final como "Especiales" [inspección]. |
| Episodios sin imagen | ✅ [probado] (corrección 3) |
| Serie con 300 episodios paginados | ✅ [probado]: 301 episodios en 3 temporadas más especiales, sin mezclar. La ficha muestra hasta 3.000 episodios por serie [inspección]. |
| Episodios identificados por TMDb | ⚠️ No hay mapeo de TMDb **por episodio**. Los episodios se ubican por serie, temporada y número. Si dos fuentes coinciden en eso, se unen en la misma fila [probado]. |
| Mezcla entre series o temporadas | ✅ No ocurre en los casos probados. |
| Episodios que la fuente ya no ofrece | ⚠️ **Nunca se marcan como no disponibles**: solo los títulos. Pueden seguir listados y fallar al reproducir [inspección]. |

## 4. Calidad de metadatos

**Cómo funciona hoy [probado]:**
- La fuente que **crea** un título define título, sinopsis, imágenes, año, géneros y puntaje. Desde la corrección 4, un campo vacío ya no borra el guardado.
- Las demás fuentes solo **completan lo que falta**.
- Los IDs de TMDb e IMDb se agregan si el título no los tiene y nadie más los usa. Si TMDb e IMDb apuntan a títulos distintos, no se une nada y se registra un aviso.

**Riesgos:**
- La "fuente dueña" es la que importa **primero**: depende del orden, no de la calidad.
- Si una fuente trae un título **sin** IDs y la otra lo trae **con** IDs, quedan **dos títulos** (no se une por nombre, a propósito).

**Propuesta, sin implementar: prioridad por fuente y por campo.**
- **Qué sería:** para cada campo (título, descripción, póster, backdrop, año, géneros, puntaje, IDs), un orden de fuentes, por ejemplo "póster: B y después A". Se guardaría qué fuente aportó cada campo, y una fuente con más prioridad podría reemplazarlo.
- **Consecuencias:**
  - cambian textos e imágenes que ya ven los usuarios;
  - para aplicarlo hace falta una sincronización completa de las dos fuentes, con más escrituras en D1;
  - los IDs externos **no** convendría reemplazarlos automáticamente: podría separar o unir títulos por error;
  - hace falta un campo nuevo en la base y una pantalla para elegir el orden.

Queda para que lo decidas.

## 5. Importación y límites

| Punto | Estado |
|---|---|
| Recuperación ante interrupciones | ✅ La posición se guarda en cada tanda; reanudar, pausar y reiniciar funcionan; detecta ejecuciones cortadas [probado]. |
| Importaciones grandes | ✅ 450 títulos en una página y 300 episodios [probado]. En Cloudflare real **no se probó** (límite de 10 ms de CPU). |
| Páginas vacías | ✅ Cortan ese endpoint. Desde la corrección 5 no causan bajas masivas [probado]. |
| Páginas repetidas | ✅ Se cortan solas [probado]. |
| Respuestas incompletas (elementos sin ID o título) | ✅ Se descartan y se cuentan [probado]. |
| Límites de solicitudes | ⚠️ Hay pausa mínima entre consultas, pero **solo dentro de una misma tanda** [inspección]. Los 429 se reintentan con espera creciente [probado]. `Retry-After` **no se respeta** [inspección]. |
| CPU | ⚠️ Tandas chicas y detección de cortes [probado]. Sin medición en Cloudflare real. |
| Escrituras en D1 | ⚠️ Lo que no cambió no se reescribe [probado]. Pero cada importación **completa** marca "visto" a todos los títulos sin cambios: con 50.000 títulos son unas 50.000 escrituras [inspección]. La diaria es incremental y no lo hace. |
| Sincronización incremental | ✅ Con el parámetro "cambios desde" [probado]. Sin ese parámetro recorre todo, pero no reescribe lo igual. |
| Bajas | ✅ Solo al terminar bien una completa, con la protección de la corrección 5. Un título sigue visible mientras otra fuente lo tenga [probado]. |
| Una importación incompleta nunca oculta títulos válidos | ✅ Un trabajo que falla, se cancela o se pausa no marca bajas [probado]. Uno que "termina" con respuestas incompletas tampoco, salvo pocas bajas dentro del margen (10% y hasta 20). **Riesgo residual:** si la fuente omite pocos títulos válidos sin avisar, dentro de ese margen, se ocultan (no se borran). |

---

## Informe final

### 1. Qué funciona realmente (probado con APIs simuladas y, en parte, en workerd con D1 local)

- **Configuración:**
  - dos APIs distintas configuradas solo desde Ajustes;
  - autenticación por clave en encabezado o parámetro, token Bearer y encabezados o parámetros personalizados;
  - JSON anidado, índices, listas y alternativas;
  - paginación por página, offset, cursor, enlace y sin paginación, con protección contra páginas repetidas o vacías.
- **Episodios:** temporadas y episodios en sus distintas formas, IDs repetidos, especiales y series largas.
- **Duplicados:** se unen por TMDb y por IMDb entre fuentes, nunca por título.
- **Importación:** reanudable, con pausa, reanudación, reinicio, reintentos y protección de bajas.
- **Reproducción:**
  - obtener el enlace con una credencial;
  - plantillas;
  - elegir la fuente, o pasar a la siguiente si una falla;
  - rechazo de enlaces con credenciales privadas o de dominios no permitidos;
  - vencimiento y subtítulos informados por el servidor.
- **Seguridad:** permisos de propietario y protección de credenciales.

### 2. Implementado pero no probado

- **Navegador:**
  - selector de subtítulos y fallback sin subtítulos;
  - renovación del enlace vencido en el reproductor;
  - reproductor externo con fuentes del catálogo;
  - cambio de fuente con dos fuentes reales;
  - botón "Reiniciar y confirmar bajas" (probado solo por la API).
- **Autenticación no probada de punta a punta:** básica (usuario y contraseña) y endpoints con método POST.
- **Opciones de conexión:** tiempo máximo y pausa entre consultas configurables; formatos de fecha `date`, `unix` y `unixms`.
- **Cloudflare real:** comportamiento con su CPU y su cron real.

### 3. Qué no puede configurarse desde la web

Ver "Estructuras que el motor hoy no maneja" (sección 1) y la tabla de reproducción (sección 2). Además:

- prioridad de metadatos por fuente y por campo;
- tipo de paginación distinto por endpoint;
- consulta de detalle por título;
- transformaciones y constantes;
- encabezados o cookies para el servidor de video.

### 4. Qué requeriría cambios de código

Todo lo del punto 3. Para encabezados o cookies del servidor de video, además, haría falta un proxy (con el análisis de costo y condiciones ya hecho) o exponer esos valores en el navegador.

### 5. Riesgos

- **Catálogo incompleto sin aviso:** pasa si se configura mal la paginación (tipo, total o última página) o si hay tipos de paginación mezclados.
- **Títulos duplicados:** cuando una fuente no trae IDs externos.
- **Metadatos según el orden:** la fuente que importa primero es la dueña de los datos.
- **Episodios obsoletos:** los que la fuente quitó no se marcan como no disponibles.
- **Exposición de la credencial de reproducción:** si se elige ponerla en la URL.
- **Límites de la fuente:** se pueden pasar, porque la pausa no se mantiene entre tandas y `Retry-After` se ignora.
- **Escrituras en D1:** las importaciones completas repetidas en catálogos grandes pueden agotar el cupo diario. Al pasarse no cobra, pero frena el servicio hasta el día siguiente.
- **CPU:** el comportamiento con el límite de 10 ms en Cloudflare real es desconocido.

### 6. Imprescindible antes de conectar las fuentes reales

1. **Revisar la documentación de cada fuente contra el punto 3.** Si una necesita algo no soportado (paginación distinta por endpoint, detalle por título, transformaciones, episodios dentro de la serie, login para obtener token), hay que implementarlo **antes**, o el catálogo quedará incompleto sin aviso.
2. **Respetar los límites de la fuente entre tandas:** guardar el próximo momento permitido y leer `Retry-After`. Es barato y evita bloqueos.
3. **Marcar como no disponibles los episodios que la fuente quitó**, con la misma protección que los títulos.
4. **Decidir la política de metadatos:** mantener "la primera fuente manda" o definir prioridades por campo.
5. **Correr las pruebas de integración real con cada fuente**, una por vez, y una prueba manual en el navegador: reproducción, subtítulos, CORS y cambio de fuente.
6. **Si alguna fuente necesita encabezados o cookies para el video:** decidir antes si se acepta un proxy (con costo o riesgo) o si esa fuente no se usa para reproducir.
