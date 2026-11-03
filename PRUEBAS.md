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

## 6. No verificado

- Pantalla completa: el navegador integrado de la app no la permite; el código maneja el rechazo. Falta probar en Chrome/Edge.
- Jellyfin con un servidor real y TMDb con una clave válida.
- Firefox, Safari y un celular real.
- Lector de pantalla (NVDA o Narrador).
