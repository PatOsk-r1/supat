# Supat

Aplicación web de streaming: películas, series y anime.
Es una **aplicación independiente**: **no trae contenido, credenciales ni catálogos de ejemplo**.
Todo lo que se muestra y reproduce viene de las **fuentes de contenido** (Fuente A y Fuente B) que configura el propietario en Ajustes.

**Abrir en línea:** https://supat-h8tfw.web.app

## Cuentas de usuario

Registro con correo y contraseña, verificación del correo, recuperación y cambio de contraseña, cerrar todas las sesiones y eliminar la cuenta. Con una cuenta se guardan **favoritos, listas (privadas o públicas) e historial**, y se ven en cualquier dispositivo. Para ver el catálogo hace falta una cuenta con el correo verificado. La seguridad está explicada en **[SEGURIDAD.md](SEGURIDAD.md)**.

## Catálogo (servidor) y fuentes de contenido

El catálogo es **uno solo, compartido por todos los usuarios**. Lo arma un servidor en Cloudflare Workers con una base D1, ambos gratuitos, a partir de **dos fuentes externas independientes**, Fuente A y Fuente B.

El propietario configura cada una en **Ajustes → Fuentes de contenido**, sin tocar código: conexión, autenticación, endpoints, paginación, mapeo de respuestas y reproducción. Cada tarjeta tiene herramientas para probar la conexión, el catálogo y la reproducción, y para activar, importar, pausar, reanudar y reiniciar la importación.

El servidor se encarga de:

- **Importar todo:** recorre todas las páginas, por tandas y sin perder el avance.
- **Actualizar todos los días** de forma automática.
- **Unir duplicados** por TMDb e IMDb, nunca por título.
- **Resolver la reproducción** con la fuente que elija el usuario, o con la siguiente si una falla.

Las credenciales quedan **cifradas en el servidor**. Si no hay contenido importado, la app lo dice: no muestra catálogos de ejemplo.

Detalles: **[worker/FUENTES.md](worker/FUENTES.md)** y **[worker/README.md](worker/README.md)**.

## Cómo abrirla en tu PC (Windows)

1. Instalá [Node.js](https://nodejs.org) (gratis; versión 20 o más nueva).
2. Hacé doble clic en **`Abrir Supat.cmd`**. La primera vez instala lo necesario; después abre el navegador.
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
| `npm run test:reglas` | Pruebas de seguridad de las reglas en el emulador (requiere Java). |
| `npm run emuladores` + `npm run dev:emu` | La app contra los emuladores locales de Firebase, con cuentas de prueba. |
| `firebase deploy --only hosting,firestore:rules` | Publica la app y las reglas en Firebase. |
| `npm run build` | Versión final optimizada en `dist/`. |
| `npm run api:dev` / `npm run api:publicar` | API del catálogo en tu PC / publicarla en Cloudflare (ver worker/README.md). |

## Qué tiene

- **Inicio:** carrusel de destacados, "Seguir viendo", favoritos y filas por tipo y categoría.
- **Películas, Series y Anime:** grilla con filtros por categoría y orden; detalle con sinopsis, reparto y temporadas/episodios. Las secciones sin contenido importado no aparecen en el menú.
- **Reproductor propio:** HLS (`.m3u8`) con hls.js o el reproductor del navegador, MP4/WebM, controles, calidad, pantalla completa, teclado (espacio, F, M, flechas), mensajes de error claros y "seguir desde donde lo dejaste".
- **Búsqueda** sin acentos ("accion" encuentra "Acción"), en lo cargado y en todo el catálogo del servidor (paginada). Tecla `/` para buscar.
- **Favoritos, progreso y ajustes** guardados en el navegador.
- **Navegación con flechas** entre tarjetas, como con el control remoto de una app de TV.
- Diseño adaptable a PC, tablet y celular (barra inferior en el celular).

## Datos opcionales de TMDb

Con una clave gratuita de [themoviedb.org](https://www.themoviedb.org/settings/api) la app completa pósters, sinopsis, reparto y episodios. Se carga en Ajustes y se guarda solo en tu navegador.
*Este producto usa la API de TMDb, pero no está respaldado ni certificado por TMDb.*

### Límites conocidos

- **CORS:** algunos servidores de video no permiten que otra página web lea sus transmisiones. El reproductor lo avisa.
- **DRM:** la app no reproduce contenido protegido con DRM ni intenta saltarlo.
- **Enlaces con credenciales:** si la fuente entrega enlaces de reproducción que contienen la credencial, el servidor no los entrega, porque la expondría. Para eso haría falta un proxy de video, que no está implementado.

## Estructura

```
src/
  app/         ajustes, favoritos, progreso, caché (IndexedDB), rutas
  catalog/     modelo de datos, almacén del catálogo, TMDb
  providers/   registro y contrato de proveedores; central.js = el catálogo del servidor
               (internet-archive, m3u, jellyfin y xmltv quedan en el código, fuera de la app)
  player/      motor (hls.js / nativo) y reproductor con controles
  ui/          controlador (app.js), piezas reutilizables y una vista por pantalla
worker/        API del catálogo central (Cloudflare Worker + D1): ver worker/README.md
tests/         pruebas automáticas (node --test); los datos ficticios viven solo en tests/fixtures
```

Para sumar un proveedor, ver **[PROVEEDORES.md](PROVEEDORES.md)**: contrato común, capacidades, límites, seguridad y pruebas.

## Dependencias

- [Vite](https://vite.dev): servidor de desarrollo y compilación.
- [hls.js](https://github.com/video-dev/hls.js) (Apache-2.0): reproducción HLS. Se descarga solo cuando hace falta.

Sin frameworks ni servicios pagos.
