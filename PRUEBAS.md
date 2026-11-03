# Informe de pruebas — Etapa 4

Fecha: 2026-11-02 · Windows 10 · Node 24.21.0 · npm 11.19.0 · Vite 6.4.5
Navegador de prueba: navegador integrado de la app Claude (motor Chromium).

## Cómo repetir las pruebas

```bash
npm.cmd test
npm.cmd run build
npm.cmd run dev
```

En PowerShell hay que escribir `npm.cmd` en lugar de `npm`, porque la política de ejecución de scripts de Windows bloquea `npm.ps1`. En CMD o Git Bash funciona `npm` normal.

## 1. Pruebas automáticas (`npm test`)

Usan el probador que viene con Node (`node --test`), sin instalar nada. Archivo: `tests/logica.test.js`.

| Prueba | Resultado |
|---|---|
| El catálogo carga los 9 elementos de demostración, marcados como demo | ✅ |
| Los ids no se repiten | ✅ |
| Ningún elemento de demostración tiene fuente de video | ✅ |
| Hay contenido en TV, películas, series y un destacado | ✅ |
| `escapeHtml` neutraliza código HTML | ✅ |
| Favoritos: agregar, quitar y recordar al volver a abrir | ✅ |
| Favoritos: datos dañados no rompen la app | ✅ |
| Favoritos: con almacenamiento bloqueado, avisa y sigue funcionando | ✅ |

Resultado: **8 de 8 pasan**, tanto en Git Bash como en PowerShell (con `npm.cmd`).

## 2. Compilación

`npm run build` termina sin errores en ~130 ms. Genera `dist/` con un HTML, un CSS (~10 kB) y un JS (~14 kB).

## 3. Pruebas en el navegador

| Área | Prueba | Resultado |
|---|---|---|
| Enlaces | Los 15 enlaces de Inicio llevan a una vista válida | ✅ |
| Botones | Todos los botones tienen una acción (favorito, filtro, volver, borrar búsqueda) | ✅ |
| Portada | Muestra el destacado y las filas TV / Películas / Series | ✅ |
| Filtros | TV muestra General / Noticias / Deportes; "Noticias" deja 1 canal | ✅ |
| Películas | Incluye "Planeta Vivo" (antes no aparecía en ninguna sección) | ✅ |
| Búsqueda | "zona" → Zona Norte; "undefined" → 0 resultados; Escape borra | ✅ |
| Favoritos | Se mantienen al recargar; mensaje cuando no hay ninguno | ✅ |
| Reproductor | Elemento sin fuente → "Este elemento no tiene una fuente de video" | ✅ |
| Reproductor | Dirección rota (prueba temporal, no queda en el código) → "No se pudo cargar el video" | ✅ |
| Rutas | Título inexistente → "No encontramos este título" | ✅ |
| Volver | Series → título → Volver regresa a Series | ✅ |
| Volver | Entrando directo a un título, Volver va a Inicio sin salir del sitio | ✅ |
| Imágenes | Una imagen que no carga se quita y queda el degradado | ✅ |
| Consola | Sin errores propios (solo los 404 provocados a propósito por las pruebas) | ✅ |

## 4. Teclado y accesibilidad

| Prueba | Resultado |
|---|---|
| Orden de Tab: Saltar al contenido → logo → menú → buscador | ✅ |
| "Saltar al contenido" mueve el foco sin cambiar de sección (antes llevaba a Inicio: corregido) | ✅ |
| Enter en un ítem del menú abre la sección y lleva el foco al título; el siguiente Tab va al primer filtro | ✅ (tecla real) |
| Elegir un filtro mantiene el foco en ese botón | ✅ |
| Tecla `/` enfoca el buscador | ✅ (evento simulado; la herramienta de tipeo no envía esa tecla como real) |
| Contraste de textos chicos: subido de 3,6:1 a ~5,6:1 (mínimo recomendado 4,5:1) | ✅ (corregido) |
| Se respeta "reducir movimiento" del sistema | ✅ (agregado) |
| Botones de favorito con `aria-pressed` y nombre ("Agregar a favoritos: …") | ✅ |

No probado: lector de pantalla real (NVDA o Narrador). Cómo comprobarlo: activar Narrador con Ctrl+Win+Enter y recorrer la página con Tab.

## 5. Tamaños de pantalla

Medido en Inicio, TV, Favoritos y la vista de reproducción a 320, 400, 600, 768, 1024 y 1440 px de ancho: **sin desplazamiento horizontal ni textos cortados** en ningún caso. Capturas revisadas a 375 (celular), 768 (tablet), 1280 (PC) y 320 px.

## 6. No verificado todavía

- Reproducción real de video: no hay ninguna fuente autorizada cargada.
- Firefox y Safari: solo se probó en un navegador Chromium.
- La versión publicada (artifact) se generó a partir del mismo código, pero no se recorrió sección por sección dentro del visor.
