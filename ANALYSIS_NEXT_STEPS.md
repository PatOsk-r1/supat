# Estado del análisis y próximos pasos

Actualizado: 2026-11-02

## Web — estado (versión 0.2.0, 2026-11-03)

- Arquitectura en tres partes: catálogo (`src/catalog`), proveedores (`src/providers`) y reproductor (`src/player`). Ver README.
- Proveedores reales: Internet Archive (probado con reproducción real), listas M3U con guía XMLTV (probado con señales de prueba de Apple) y Jellyfin (sin probar con un servidor real).
- TMDb para metadatos (probado con respuestas simuladas y el rechazo de una clave inválida; falta una clave válida).
- 34 pruebas automáticas, sin depender de internet. Detalle en PRUEBAS.md.

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

1. Probar con una clave real de TMDb y, si el usuario lo instala, con un servidor Jellyfin.
2. Probar en Chrome/Edge (pantalla completa), Firefox y un celular real.
3. Si alguna lista M3U autorizada no se puede leer por CORS: evaluar un pequeño servidor local opcional (gratuito, en la misma PC) solo para fuentes que el usuario tenga permiso de usar.
4. Instalable como app (PWA) para abrirla desde el escritorio o el celular.

## Investigación: ¿se pueden reutilizar las fuentes de Xuper TV de forma autorizada? (2026-11-02)

**Conclusión: no existe una vía autorizada.**

- No se encontró documentación pública, API oficial, portal de desarrolladores ni exportación de listas de Xuper TV (búsqueda web del 2026-11-02).
- Hay fuentes públicas que informan que Xuper TV y Magis TV retransmiten canales, películas y series sin licencia de los titulares de los derechos. Hubo bloqueos judiciales en Argentina y Chile, y Amazon las quitó de Fire TV (TorrentFreak, Piracy Monitor, El Output, 2026). Esas mismas fuentes reportan malware asociado.
- Como Xuper TV no tiene los derechos, ni siquiera un permiso suyo convertiría su catálogo en una fuente autorizada. La autorización tendría que venir de cada titular de derechos.
- El APK no está en esta PC, así que no se hizo análisis estático nuevo. El mecanismo interno de obtención de catálogo y de direcciones está detrás de la protección ijiami y no se intentó eludirla.
- Ojo: "Xuper TV GLOBAL" de la App Store de iOS parece ser otra app, que según su ficha usa la API de TMDb para metadatos.
