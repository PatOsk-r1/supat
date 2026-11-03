# Xuper Web — base de investigación

Este proyecto es una interfaz web inicial independiente. No contiene ni reutiliza canales, credenciales, URLs privadas ni servicios extraídos del APK.

## Requisitos
- Node.js 20+ recomendado
- npm

## Ejecutar
```bash
npm install
npm run dev
```
Abrir la URL local que indique Vite.

Otros comandos:
- `npm test`: pruebas automáticas (ver PRUEBAS.md).
- `npm run build`: versión final en `dist/`.
- `npm run page`: compila y arma `publish/xuper-web.html`, un único archivo para compartir la vista previa.

**En Windows con PowerShell** escribí `npm.cmd` en vez de `npm` (por ejemplo `npm.cmd run dev`). PowerShell bloquea `npm.ps1` por su política de scripts. En CMD o Git Bash funciona `npm` normal.

## Estado
- Interfaz responsive (PC, tablet y celular) con menú lateral, que pasa a barra inferior en el celular.
- Secciones: Inicio (destacado + filas), TV en vivo, Películas, Series y Favoritos. La dirección cambia (#/tv, #/peliculas...), así que funciona el botón Atrás.
- Búsqueda por nombre/categoría (atajo: tecla /, Escape borra) y filtros por categoría en cada sección.
- Favoritos guardados en el navegador (localStorage).
- Vista de reproducción: reproduce fuentes compatibles; si no hay fuente o falla, lo dice claramente.
- Todo el contenido actual es de **demostración** (src/catalog/demo-data.js) y no tiene video.
- Integración con servicios de Xuper: no existe ni está confirmada.

## Estructura
- `src/catalog/index.js`: punto único de acceso al catálogo (junta y valida los proveedores).
- `src/catalog/demo-provider.js` + `demo-data.js`: proveedor de demostración. Una fuente autorizada se agrega como otro proveedor.
- `src/player.js`: reproductor, separado del catálogo.
- `src/favorites.js`: favoritos en el navegador.
- `src/main.js`: interfaz y navegación. `src/style.css`: estilos.

No cargar URLs privadas, credenciales ni tokens en el frontend. Para una integración real, las credenciales deben gestionarse en un backend seguro.
