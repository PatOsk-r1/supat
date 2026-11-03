# Estado del análisis y próximos pasos

Actualizado: 2026-11-02

## Web — confirmado (probado, ver PRUEBAS.md)

- Compila con `npm run build` en Windows y pasan las 8 pruebas automáticas (`npm test`).
- Funcionan las secciones, la búsqueda, los filtros, los favoritos guardados en el navegador, la vista de reproducción con mensajes de estado, la navegación con teclado y el diseño de 320 a 1440 px.
- Todo el contenido es de demostración (`src/catalog/demo-data.js`), está marcado como tal y no tiene video.
- No hay conexión con ningún servicio de Xuper TV ni con terceros.

## APK — confirmado

Solo lo que figura en `APK_ANALYSIS_REPORT.md` (inspección previa, hecha fuera de esta PC). En esta etapa no se analizó el APK porque:

- El archivo `XuperTV_oficial_TV_1764408199.apk` no está en esta PC (se buscó en Descargas).
- No hay herramientas Android instaladas: `java`, `jadx`, `apktool`, `adb`, `aapt` y `aapt2` no se encontraron.

## APK — pendiente (solo análisis estático, sin ejecutar el APK)

1. Que el usuario copie el APK a `analysis/` (ya está excluida de Git).
2. Calcular SHA-256 (`certutil -hashfile archivo.apk SHA256`, viene con Windows).
3. Herramientas gratuitas, a instalar solo con aprobación:
   - **Java (Temurin JDK 17+)**: lo necesitan apktool y jadx.
   - **apktool**: decodifica `AndroidManifest.xml` y los recursos.
   - **jadx**: muestra el código Java del DEX. Si la protección (ijiami) lo impide, se registra el error y no se intenta saltarla.
4. Registrar permisos, actividades, servicios, receivers, providers y minSdk/targetSdk.
5. Hacer un inventario de las bibliotecas `.so` y su propósito público (por ejemplo, ijkplayer es un reproductor open source basado en FFmpeg).
6. Separar siempre lo **confirmado** de las **hipótesis**. Los valores `xx` de `domain_test.json` no son dominios.

## Web — próximos pasos

1. **Etapa 5: evaluar fuentes legítimas.**
   - Un proveedor "archivo propio": un JSON con tus propios títulos y videos.
   - Contenido de dominio público o con licencia abierta, por ejemplo Internet Archive o videos de prueba de Blender con licencia Creative Commons. Hay que verificar la licencia de cada uno.
   - Listas M3U propias o de canales que autoricen su retransmisión. No se van a cargar listas de origen dudoso.
2. Soporte HLS para navegadores que no lo traen (hls.js, gratuito, licencia Apache-2.0). Solo cuando haya una fuente HLS autorizada.
3. Probar en Firefox y en un celular real.

## Investigación: ¿se pueden reutilizar las fuentes de Xuper TV de forma autorizada? (2026-11-02)

**Conclusión: no existe una vía autorizada.**

- No se encontró documentación pública, API oficial, portal de desarrolladores ni exportación de listas de Xuper TV (búsqueda web del 2026-11-02).
- Hay fuentes públicas que informan que Xuper TV y Magis TV retransmiten canales, películas y series sin licencia de los titulares de los derechos. Hubo bloqueos judiciales en Argentina y Chile, y Amazon las quitó de Fire TV (TorrentFreak, Piracy Monitor, El Output, 2026). Esas mismas fuentes reportan malware asociado.
- Como Xuper TV no tiene los derechos, ni siquiera un permiso suyo convertiría su catálogo en una fuente autorizada. La autorización tendría que venir de cada titular de derechos.
- El APK no está en esta PC, así que no se hizo análisis estático nuevo. El mecanismo interno de obtención de catálogo y de direcciones está detrás de la protección ijiami y no se intentó eludirla.
- Ojo: "Xuper TV GLOBAL" de la App Store de iOS parece ser otra app, que según su ficha usa la API de TMDb para metadatos.
