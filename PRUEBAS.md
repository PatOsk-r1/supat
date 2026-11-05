# Informe de pruebas — versión 0.2.0

Fecha: 2026-11-03 · Windows 10 · Node 24.21.0 · npm 11.19.0 · Vite 6.4.5 · hls.js 1.7.4
Navegador de prueba: navegador integrado de la app Claude (motor Chromium).

## Cómo repetirlas

```bash
npm test
npm run build
```

(En PowerShell: `npm.cmd test`.) Para probar el proveedor M3U a mano, ver `tests/fixtures/LEEME.md`.

## 1. Pruebas automáticas — 34 de 34 pasan

Corren sin internet en ~0,3 s.

| Archivo | Qué cubre |
|---|---|
| `tests/app.test.js` | Rutas (incluye episodios y direcciones mal codificadas), ajustes, progreso de "seguir viendo", caché. |
| `tests/logica.test.js` | Catálogo, origen de cada título, temporadas y episodio siguiente, categorías, activar/desactivar proveedores, validación de configuración, búsqueda sin acentos, orden, favoritos, protección de textos. |
| `tests/player.test.js` | Detección de formato y formato de tiempo. |
| `tests/tmdb.test.js` | Cliente de TMDb con respuestas simuladas: clave v3/v4, búsqueda con y sin año, detalles, episodios, clave rechazada. |
| `tests/proveedores.test.js` | Lector M3U (atributos, comas en nombres, canales/películas/series), XMLTV (zonas horarias, ventana de tiempo, entidades), ayudas de Internet Archive. |
| `tests/rendimiento.test.js` | 5.000 canales en ~50 ms; guía de 20.000 programas en ~75 ms. |

## 2. Pruebas reales en el navegador

| Área | Prueba | Resultado |
|---|---|---|
| Internet Archive | Carga 150 películas reales con pósters y categorías en español | ✅ |
| Internet Archive | "His Girl Friday" (1940): Detalle → Reproducir con clic real → reproduce MP4 de 1 h 31 min | ✅ |
| Seguir viendo | Tras ver 20 s, aparece en Inicio y se guarda el segundo exacto | ✅ |
| Reanudar | Un MP4 abierto con "seguir desde 1:00" arranca en 1:00 | ✅ |
| HLS en vivo | Señal de prueba de Apple por lista M3U: reproduce en 1080p con hls.js, "EN VIVO", 6 calidades | ✅ |
| Guía XMLTV | Muestra "Ahora: Programa de prueba" y su barra de progreso | ✅ |
| Errores | Canal inexistente → "No se pudo conectar con la transmisión" en 1 s con botón Reintentar | ✅ (corregido: antes quedaba cargando para siempre) |
| Errores | MP4 inexistente → "No se pudo cargar el video" | ✅ |
| Sin fuente | Títulos y canales de demostración → mensaje "no tiene una fuente de video" | ✅ |
| Series | Temporadas, pestañas, episodios, episodio siguiente, reproducir episodio | ✅ (con datos de demostración) |
| Proveedores | Agregar M3U, guardar, actualizar, activar/desactivar, quitar (dos toques) | ✅ |
| Jellyfin | Sin servidor: "No se pudo conectar con el servidor Jellyfin…" | ✅ (mensaje). **Con servidor real: no probado** |
| TMDb | Clave inventada contra el servidor real → "TMDb rechazó la clave" | ✅. **Con clave válida: no probado** (cubierto con respuestas simuladas) |
| Teclado | Flechas entre tarjetas y filas; Tab, Enter, `/`; atajos del reproductor | ✅ |
| Consola | Recorrido por las 9 pantallas tras carga limpia: 0 errores | ✅ |

## 3. Tamaños de pantalla

Inicio, TV, Películas, Series, Favoritos, Ajustes, dos detalles y reproducción, a 320, 375, 768, 1024 y 1440 px: **sin desplazamiento horizontal**. Capturas revisadas en celular (375) y PC (1366).

## 4. Rendimiento en la interfaz (5.006 canales)

| Acción | Tiempo |
|---|---|
| Abrir TV en vivo (muestra 200 canales por vez) | ~60 ms |
| Abrir Inicio | ~65 ms |
| Buscar | ~80 ms |

Peso de la app: 29 kB comprimidos (+ 6 kB de estilos). hls.js (119 kB) se descarga solo al reproducir HLS.

## 5. Hallazgos corregidos en esta ronda

1. Nombres de canal con coma se cortaban ("…(Apple, fMP4)" → "fMP4)").
2. En "Automático", este navegador decía soportar HLS nativo y fallaba; además el intento nativo dejaba la lista en caché sin permiso CORS y hls.js ya no podía leerla. Ahora se usa hls.js primero y el nativo como respaldo.
3. Si la lista principal de una transmisión no respondía, el reproductor quedaba cargando para siempre.
4. El botón grande ▶ podía pausar en vez de reproducir.

## 7. Catálogo central (2026-11-03)

### Pruebas automáticas: 75 de 75 pasan

Son las 47 anteriores más 28 nuevas, y corren sin red.

| Archivo | Qué cubre |
|---|---|
| `tests/api-auth.test.js` | **Sesión:** firma, proyecto, vencimiento, 30 días y tokens del emulador solo en localhost. **Permisos:** sin sesión todo da 401, el usuario común no entra al panel, nadie se da permisos (por el token, por la API ni cambiándose el rol), el dueño promueve y bloquea con auditoría y un dueño por configuración no se puede quitar. **Cuentas:** el correo sin verificar, la suspensión y "cerrar todas las sesiones". **CORS.** |
| `tests/api-catalogo.test.js` | **Credenciales:** se guardan cifradas y no aparecen en respuestas, registros, auditoría ni trabajos; sin `SECRETS_KEY` no se guardan. **Proveedores:** prueba de conexión. **Importación:** por tandas, reanudable y con menos de 50 consultas a D1 por tanda; reintentos ante 503, falla después de 5 intentos y 400 sin reintento; no se duplican trabajos. **Catálogo:** duplicados unidos por TMDb/IMDb, incremental con `since` y sin reescribir lo igual, bajas sin borrar, búsqueda paginada sin acentos. **Reproducción:** fuente pedida al proveedor, episodio directo e iframe de un origen no declarado. **Otros:** proveedor desactivado, validación de la especificación genérica y cron (el diario crea trabajos solo para los proveedores diarios; el de 10 minutos los termina). |
| `tests/central-cliente.test.js` | El proveedor del navegador cumple el contrato, la conversión de títulos y el correo enmascarado en el panel. |

### Pruebas reales en local

- **Motor real de Cloudflare:** la API corrió en Wrangler 4.157, con workerd y D1 local. La migración se aplicó, incluido el índice FTS5.
- **`node tests/e2e-api.mjs`, todo bien:** se usaron cuentas reales del emulador de Firebase Auth y un proveedor de prueba local. Se comprobaron los roles, que el usuario común no puede entrar al panel y que la credencial no aparece en las respuestas. También la prueba de conexión, la importación completa (6 páginas, 5 títulos, 3 episodios) y la búsqueda FTS5. Por último, la reproducción: la dirección con la clave no se entrega, y temporadas y registros están bien.
- **Cron en workerd** (`wrangler dev --test-scheduled`): la tarea de las 05:00 creó un trabajo incremental por proveedor y la de cada 10 minutos los terminó. En Internet Archive, los 40 títulos quedaron sin cambios y no se reescribieron.
- **Internet Archive real** (archive.org, por la API local): la prueba de conexión dio 20 títulos. La importación trajo 40 títulos en 2 páginas, la reproducción se resolvió a un MP4 real y archive.org respondió 200 `video/mp4`.
- **Interfaz** (navegador integrado, `npm run dev:emu`):
  - **Panel del propietario:** probar conexión, sincronizar, continuar hasta terminar, bloquear y desbloquear un usuario (la API devolvió 403 mientras estuvo bloqueado), registros, auditoría e infraestructura.
  - **Catálogo:** la ficha de una serie con dos temporadas, la búsqueda y Ajustes.
  - **Usuario común:** ve 43 películas del catálogo central y no tiene acceso al panel.

### Hallazgos corregidos

1. Una página vacía (`[]`) se tomaba como "la respuesta no tiene lista" y cortaba la importación.
2. Una serie con episodios inaccesibles (404) hacía fallar todo el trabajo. Ahora se registra y se sigue.
3. El mensaje de resultado de algunas acciones del panel se borraba al terminar.

### No verificado en el catálogo central

- **Publicación en Cloudflare:** necesita la cuenta del propietario (ver worker/README.md → Publicar). Las claves públicas reales de Google y Firestore real solo se probaron con datos simulados.
- **Programador real de Cloudflare:** las tareas programadas se dispararon a mano en workerd; falta verlas correr solas una vez publicado.
- **Ver el video en este navegador:** el reproductor recibe la dirección correcta, pero el navegador integrado no carga videos de archive.org. Con el proveedor anterior pasa exactamente lo mismo.
- **Proveedor externo real con credenciales:** no hay ninguno configurado. Se probó con un proveedor inventado.

## 8. Fuente única de contenido (2026-11-03)

### Pruebas automáticas: 83 de 83 pasan (sin red)

`tests/api-catalogo.test.js` se reescribió para la fuente única. Cubre:

- **Guardar la fuente:** prueba las dos credenciales, la activa y arranca la importación completa.
- **Credenciales:**
  - cifradas, nunca en respuestas, registros, auditoría, trabajos ni en la tabla de proveedores;
  - si se dejan vacías se conservan, y "borrar" quita solo la elegida;
  - la de reproducción no viaja en las consultas del catálogo, y sí en las de reproducción.
- **Permisos:** solo el propietario configura, prueba o sincroniza.
- **Prueba de conexión:** detecta una API Key equivocada y una credencial de reproducción equivocada, cada una por separado.
- **Configuración que falla:** no activa la fuente ni importa nada.
- **Fuente única:** guardarla apaga los otros proveedores sin borrar sus datos.
- **Categorías.**
- **Importación:**
  - por tandas, reanudable y con menos de 50 consultas a D1 por tanda;
  - una página de 450 títulos se importa completa, sin recortes;
  - una ejecución cortada varias veces deja el trabajo fallido con explicación, y conserva lo importado;
  - reintentos;
  - un error de sincronización no oculta lo importado.
- **Duplicados** dentro de la fuente, sincronización **incremental**, **bajas sin borrar**, **búsqueda** y **reproducción**.
- **Especificación:** cada credencial en su lugar.
- **Cron:** el diario y el de cada minuto.
- **Guardar sin cambios** no vuelve a importar todo.

`tests/logica.test.js` usa datos ficticios aislados en `tests/fixtures/catalogo-prueba.js`; ya no forman parte de la app.

### Pruebas reales en local (workerd + D1 local + emuladores de Firebase)

- **`node tests/e2e-api.mjs`, todo bien:** se probaron la fuente guardada desde Ajustes, con las dos credenciales, y que el usuario común no puede configurarla. También la importación completa con temporadas y episodios, el estado público, la búsqueda y la reproducción con la credencial de reproducción, y que los registros no tienen ninguna de las dos credenciales.
- **Interfaz** (`npm run dev:emu`):
  - **Usuario común:** ve solo lo importado de la fuente; las 40 películas anteriores de Internet Archive quedaron ocultas, no borradas. TV en vivo y Anime no aparecen en el menú porque no tienen contenido, y en Ajustes ve el estado sin formulario.
  - **Sin sesión:** "Iniciá sesión para ver el catálogo".
  - **Propietario:** formulario completo. Las credenciales no aparecen en la página ni en localStorage. "Probar conexión" funcionó, y "Guardar configuración" conservó las credenciales y mostró "Configuración guardada". El panel ya no tiene la pestaña Proveedores.

### Hallazgos corregidos

1. Guardar sin cambios volvía a importar todo, porque la especificación con otro formato contaba como cambio. Ahora se guarda normalizada.
2. Al cerrar sesión, o al abrir la app sin sesión, el catálogo seguía visible desde la copia guardada. Ahora esa copia se borra (favoritos e historial no se tocan).
3. Ajustes no mostraba el resultado de guardar.

### No verificado

- **Una API real:** no hay especificación ni credenciales de la fuente real. Todo se probó con una API inventada.
- **La importación en Cloudflare con un catálogo grande**, en particular el límite de 10 ms de CPU con páginas grandes.
- **El cron de cada minuto** con el programador real de Cloudflare.

## 9. Fuente A y Fuente B (2026-11-04)

### Pruebas automáticas: 88 pasan y 6 quedan omitidas (las de integración real)

`tests/fuentes-ab.test.js` reemplaza a `tests/api-catalogo.test.js` y lo cubre todo. Usa **dos simuladores con APIs distintas**, definidos en `tests/helpers/fuentes-simuladas.js`:

| | Autenticación | Paginación | Episodios | Reproducción |
|---|---|---|---|---|
| **Fuente A** | API Key en encabezado | Por página | Por temporada | Endpoint, con la credencial en un encabezado |
| **Fuente B** | Token Bearer | Por offset con total | Lista única | Plantilla, con la credencial en la URL |

Lo que cubren las pruebas:

- **Configuración:** los campos empiezan vacíos; se informa qué falta para guardar y para activar.
- **Normalización:** cada fuente se traduce a su propia especificación.
- **Permisos:** solo el propietario configura, prueba o importa (401 sin sesión, 403 para un usuario común).
- **Credenciales:** cifradas y nunca en respuestas, registros, catálogo ni trabajos; si se dejan vacías se conservan y "Borrar" las quita. Sin `SECRETS_KEY` no se guardan.
- **Pruebas desde Ajustes:** conexión, catálogo (con los campos del mapeo encontrados) y reproducción de películas y episodios en las dos fuentes, sin devolver el enlace. Avisa cuando la credencial queda visible en la URL.
- **Importación:**
  - completa, por tandas y reanudable, con menos de 50 consultas a D1 por tanda;
  - páginas grandes sin recortes; una API que ignora la página no genera un bucle infinito;
  - categorías desmarcadas no se importan.
- **Independencia:** si A falla, B importa y reproduce igual.
- **Control de la importación:** reintentos configurados desde Ajustes; pausa (el cron la respeta), reanudación y reinicio con confirmación; detección de ejecuciones cortadas.
- **Duplicados:** se unen entre fuentes por TMDb, nunca por título; un episodio puede estar en las dos fuentes.
- **Reproducción:**
  - se elige la fuente; si una falla, se usa la otra;
  - se rechazan enlaces con una credencial privada o de un dominio no permitido;
  - se informan subtítulos y vencimiento.
- **Actualización:** incremental; un error no borra ni oculta nada; las bajas se marcan solo si ninguna otra fuente tiene el título.
- **Estado público:** cuenta títulos únicos; también se probaron la búsqueda y el cron con las dos fuentes.

### Pruebas reales en local

- **`node tests/e2e-api.mjs` (workerd + D1 local + emuladores):** todo bien. Se configuró la Fuente A con el formulario y se probaron conexión, importación, búsqueda, reproducción y registros sin credenciales.
- **Interfaz:**
  - las dos tarjetas se ven con sus capacidades;
  - "Probar reproducción" de A funcionó;
  - guardar B vacía informa "Faltan datos para guardar: Nombre visible, URL base de la API".

### Hallazgo corregido

Una API que ignora el parámetro de página hacía que la importación pidiera páginas sin fin. Se corrigió de dos maneras: opción "Sin paginación" por endpoint y corte automático cuando una página llega igual a la anterior.

### No verificado (depende de datos reales)

- **Ninguna fuente real:** no se configuró ninguna, así que no hay pruebas de conexión, importación ni reproducción reales.
- **Subtítulos externos en el navegador:** el código está, pero no hay una fuente real con subtítulos para probarlo.
- **Cambiar de fuente en la pantalla de reproducción con dos fuentes reales:** probado por la API, no en el navegador.

## 10. Etapa de preparación de fuentes (2026-11-05)

**121 pruebas: 115 aprobadas, 0 fallidas, 6 omitidas.** Las omitidas son las de integración real, que necesitan fuentes reales.

- **Pruebas nuevas:** `tests/preparacion.test.js`, con 17 pruebas. Cubren:
  - paginaciones mezcladas;
  - límites (429, ventana, intervalo);
  - reinicio de un trabajo;
  - episodios ausentes, con importaciones parciales y completas;
  - respuestas vacías anormales;
  - prioridades: vista previa, aplicar, interrupción y reanudación;
  - inicio de sesión rechazado y renovación del token;
  - reproducción no compatible;
  - subtítulos.
- **Motor de Cloudflare local** (workerd + D1): dos fuentes importadas, prioridades de punta a punta, estado persistente y reproducción.
- **Navegador:** selector de subtítulos con WebVTT y SRT, en `tests/fixtures/reproductor-subtitulos.html`.
- **Sin probar en el navegador:** las pantallas nuevas de Ajustes. Faltó la sesión de propietario, porque los emuladores de Firebase estaban ocupados por otra sesión.

Detalle: [docs/INFORME-ETAPA-PREPARACION.md](docs/INFORME-ETAPA-PREPARACION.md).

## 6. No verificado

- Pantalla completa: el navegador integrado de la app no la permite; el código maneja el rechazo. Falta probar en Chrome/Edge.
- Jellyfin con un servidor real y TMDb con una clave válida.
- Firefox, Safari y un celular real.
- Lector de pantalla (NVDA o Narrador).
