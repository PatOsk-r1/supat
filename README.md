# Xuper Web

Aplicación web de streaming (TV en vivo, películas y series) con una experiencia inspirada en las apps de IPTV como Xuper TV.
Es un **prototipo independiente y no oficial**, sin relación con Xuper TV: **no trae canales, credenciales ni fuentes privadas**.
Todo lo que se reproduce viene de proveedores que configurás vos y que tenés permiso de usar.

## Cómo abrirla (Windows)

1. Instalá [Node.js](https://nodejs.org) (gratis; versión 20 o más nueva).
2. Hacé doble clic en **`Abrir Xuper Web.cmd`**. La primera vez instala lo necesario; después abre el navegador.
3. Para apagarla, cerrá la ventana negra.

Por consola:

```bash
npm install
npm run dev
```

En **PowerShell** escribí `npm.cmd` en vez de `npm` (por ejemplo `npm.cmd run dev`), porque PowerShell bloquea `npm.ps1` por su política de scripts. En CMD o Git Bash funciona `npm` normal.

| Comando | Para qué |
|---|---|
| `npm run dev` | Abre la app en tu PC (solo accesible desde tu PC). |
| `npm run dev:red` | Igual, pero accesible desde otros dispositivos de tu wifi (por ejemplo, el celular). |
| `npm test` | Pruebas automáticas (ver PRUEBAS.md). |
| `npm run build` | Versión final optimizada en `dist/`. |
| `npm run page` | Arma `publish/xuper-web.html`, una vista previa de un solo archivo (solo con contenido de demostración). |

## Qué tiene

- **Inicio:** carrusel de destacados, "Seguir viendo", favoritos y filas por tipo y categoría.
- **TV en vivo:** guía estilo IPTV con categorías, lista de canales con el programa actual (si hay guía XMLTV) y vista previa.
- **Películas y Series:** grilla con filtros por categoría, proveedor y orden; detalle con sinopsis, reparto y temporadas/episodios.
- **Reproductor propio:** HLS (`.m3u8`) con hls.js o el reproductor del navegador, MP4/WebM, controles, calidad, pantalla completa, teclado (espacio, F, M, flechas), mensajes de error claros y "seguir desde donde lo dejaste".
- **Búsqueda** sin acentos ("accion" encuentra "Acción"), tecla `/` para buscar.
- **Favoritos, progreso y ajustes** guardados en el navegador.
- **Navegación con flechas** entre tarjetas, como con el control remoto de una app de TV.
- Diseño adaptable a PC, tablet y celular (barra inferior en el celular).

## Proveedores de contenido (Ajustes → Proveedores)

| Proveedor | Qué aporta | Configuración |
|---|---|---|
| **Internet Archive** | Películas clásicas de dominio público o con licencia abierta (archive.org). | Ninguna. Viene activado. Se puede cambiar la búsqueda. |
| **Lista de canales (M3U)** | TV en vivo (y películas o series si la lista las tiene), con guía XMLTV opcional. | Dirección de la lista o archivo `.m3u`. Usá solo listas autorizadas. |
| **Servidor Jellyfin** | Tu propia colección de películas y series. | Dirección del servidor y clave de API ([jellyfin.org](https://jellyfin.org), gratis). |
| **Demostración** | Títulos ficticios sin video, para ver la estructura. | Ninguna. Se puede desactivar. |

Se pueden tener varios proveedores del mismo tipo (por ejemplo, dos listas M3U), activarlos, desactivarlos, actualizarlos y quitarlos. Cada título muestra de qué proveedor viene.

**TMDb (opcional):** con una clave gratuita de [themoviedb.org](https://www.themoviedb.org/settings/api) la app completa pósters, sinopsis, reparto y episodios. Se carga en Ajustes y se guarda solo en tu navegador.
*Este producto usa la API de TMDb, pero no está respaldado ni certificado por TMDb.*

### Límites conocidos

- **CORS:** algunos servidores no permiten que otra página web lea sus listas o transmisiones, aunque funcionen en VLC. La app lo avisa. Para listas, se puede cargar el archivo descargado.
- **DRM:** la app no reproduce contenido protegido con DRM ni intenta saltarlo.
- La **vista previa publicada** (`npm run page`) solo muestra la demostración, porque ese visor bloquea las conexiones externas.

## Estructura

```
src/
  app/         ajustes, favoritos, progreso, caché (IndexedDB), rutas
  catalog/     modelo de datos, almacén del catálogo, TMDb
  providers/   un archivo por tipo de proveedor + registro + lectores M3U y XMLTV
  player/      motor (hls.js / nativo) y reproductor con controles
  ui/          controlador (app.js), piezas reutilizables y una vista por pantalla
tests/         pruebas automáticas (node --test) y archivos de prueba
```

Para sumar un proveedor, ver **[PROVEEDORES.md](PROVEEDORES.md)**: contrato común, capacidades, límites, seguridad y pruebas.

## Dependencias

- [Vite](https://vite.dev): servidor de desarrollo y compilación.
- [hls.js](https://github.com/video-dev/hls.js) (Apache-2.0): reproducción HLS. Se descarga solo cuando hace falta.

Sin frameworks ni servicios pagos.
