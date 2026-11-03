# Tarea para Claude Code — continuar el análisis de Xuper TV

Lee primero `APK_ANALYSIS_REPORT.md` y `README.md`. El APK original se encuentra fuera de este proyecto en `/mnt/data/XuperTV_oficial_TV_1764408199.apk` en el entorno de ChatGPT; en mi PC tendrás que pedirme la ruta local o copiarlo al directorio `analysis/` si necesitás inspeccionarlo.

## Objetivo
Avanzar en la interfaz web de demostración y hacer un diagnóstico estático reproducible del APK, sin ejecutar el APK ni eludir protecciones.

## Primero
1. Verificá las herramientas instaladas (`java`, `jadx`, `apktool`, `adb`, `aapt`); no instales nada sin explicar antes si es gratuito y para qué sirve.
2. Si el APK está disponible localmente, extraé una copia de trabajo y calculá SHA-256.
3. Decodificá `AndroidManifest.xml` y listá permisos, actividades, servicios, receivers, providers, minSdk/targetSdk si es posible.
4. Inventariá bibliotecas `.so` y recursos de configuración. No inventes dominios: los valores `xx` de `domain_test.json` no son endpoints.
5. Si la decompilación falla por protección, registrá el error y continuá con recursos y metadatos accesibles.

## Web
6. Ejecutá `npm install` y `npm run build` en este proyecto.
7. Corregí errores de construcción y probá navegación, búsqueda, filtros y favoritos.
8. Conservá los datos ficticios claramente identificados.
9. No conectes el sitio a servicios privados, no extraigas ni uses credenciales/tokens, y no intentes eludir autenticación, DRM, firmas ni controles de acceso.
10. Creá `ANALYSIS_NEXT_STEPS.md` con resultados confirmados, pendientes y próximos pasos.

Trabajá por pasos, verificá cada resultado y no afirmes que una prueba pasó si no la ejecutaste.
