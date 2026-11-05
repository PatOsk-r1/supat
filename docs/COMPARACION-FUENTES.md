# Supat: qué soporta el configurador de fuentes (para comparar con la documentación de una fuente)

Este documento sirve para responder una sola pregunta: **¿la fuente se puede conectar desde Ajustes, sin escribir código?**

**Cómo usarlo con ChatGPT:**

1. Pegá este documento entero.
2. Pegá la documentación técnica de la fuente.
3. Pedí el análisis con el texto del final.

**No pegues claves, tokens ni contraseñas reales.** Si los ejemplos de la documentación los traen, reemplazalos por `XXXX`.

---

## Cómo trabaja Supat

- Supat tiene **dos fuentes** (A y B). Cada una se configura con un formulario en Ajustes.
- Un servidor (Cloudflare Worker) **importa el catálogo** de la API de la fuente y lo guarda en una base propia. Lo hace por tandas: una por minuto, con un máximo de 50 consultas a la fuente por tanda.
- El servidor guarda **cifradas** las credenciales. **Nunca** las manda al navegador.
- El navegador reproduce el video **directo desde la fuente**. No hay proxy de video, así que el navegador tiene que poder abrir la URL del video **sin** credenciales, encabezados ni cookies especiales.

---

## 1. Conexión y autenticación — SOPORTADO

- **Conexión:**
  - URL base, método GET o POST y tiempo máximo por consulta (2 a 30 s);
  - reintentos con espera que se duplica en cada intento.
- **Autenticación**, uno de estos tipos:
  - ninguna;
  - API Key en un **encabezado** (cualquier nombre);
  - API Key en un **parámetro** de la URL de la API, que solo usa el servidor;
  - token fijo `Authorization: Bearer ...`;
  - usuario y contraseña con autenticación básica (HTTP Basic);
  - **inicio de sesión:**
    - se manda usuario y contraseña a un endpoint, en JSON o como formulario;
    - se toma el token de la respuesta;
    - el token se manda en un encabezado;
    - se renueva solo al vencer o ante un 401;
  - encabezados y parámetros personalizados, todos secretos.
- **Límites de uso:**
  - pausa mínima entre consultas;
  - "N solicitudes cada X segundos";
  - respeta `Retry-After`;
  - ante un 429, espera sin gastar reintentos;
  - espera máxima configurable.

## 2. Catálogo — SOPORTADO

- **Endpoints separados** para películas, series, anime, temporadas y episodios. Cada uno tiene ruta, método, parámetros, encabezados y la ruta donde viene la lista de resultados.
- **Respuestas en JSON.** Las rutas dentro del JSON se escriben así:
  - `a.b`
  - `a[0].b`
  - `lista[].nombre`
  - alternativas: `a|b`
- **Variables** en rutas, plantillas y parámetros:
  - `{id}`, `{seriesId}`, `{season}`, `{episode}`, `{tmdb}`, `{imdb}`, `{lang}`;
  - `{data.campo}`, que toma cualquier campo del ítem.
- **Paginación**, por endpoint o general:
  - tipos: sin paginación, número de página, desplazamiento (offset), cursor o enlace a la página siguiente;
  - parámetros de página y de tamaño;
  - indicadores de fin: "última página", total de páginas o total de resultados;
  - topes de páginas y de registros;
  - qué hacer si una página llega vacía, repetida o inválida.
- **Sincronización incremental** con "cambios desde una fecha", en formato ISO, AAAA-MM-DD, segundos Unix o milisegundos Unix.
- **Episodios:** el endpoint de episodios se llama **por serie** (con `{seriesId}`) y opcionalmente por número de temporada (`{season}`).

## 3. Mapeo de campos — SOPORTADO (cada campo es una ruta dentro del JSON del ítem)

- **Títulos:**
  - id, tipo (película, serie o anime), TMDb, IMDb;
  - título y título original, descripción;
  - póster y fondo, con un prefijo de URL opcional para las imágenes;
  - año, fecha de estreno, géneros, puntaje;
  - cantidad de temporadas y de episodios;
  - fecha de actualización, URL de reproducción, URL de subtítulos.
- **Episodios:** id, temporada, número, título, descripción, imagen, duración, URL de reproducción y URL de subtítulos.
- **Uniones:** los títulos repetidos entre fuentes se unen **por TMDb o IMDb**, nunca por el nombre. Conviene que la fuente traiga alguno de los dos.

## 4. Reproducción — SOPORTADO

Hay tres métodos:

- **Plantilla:** la URL se arma, por ejemplo `https://.../ver/{id}.m3u8`.
- **Endpoint:** el servidor pide la URL a la API, con la credencial en un encabezado, en un parámetro o en el cuerpo JSON, y lee de la respuesta la URL, el formato, el vencimiento y los subtítulos.
- **Directa:** la URL viene en el catálogo.

Además:

- **Formatos:** HLS (.m3u8), MP4 y WebM. También un reproductor externo en iframe, solo de dominios permitidos.
- **Enlaces que vencen:** se pide uno nuevo solo.
- **Subtítulos:** WebVTT o SRT (el SRT se convierte), por plantilla con idiomas, por URL del catálogo o devueltos por el endpoint. El servidor de subtítulos tiene que permitir CORS.
- **Dominios permitidos** para los enlaces.

### Reproducción NO COMPATIBLE

Estos casos no se pueden resolver, por seguridad o por cómo funciona el navegador:

- **La credencial va dentro de la URL del video** que abre el navegador. Quedaría expuesta a cualquier usuario.
- El video **exige encabezados** (por ejemplo `Authorization`) o **cookies** para reproducirse.
- El video **no permite CORS**: en el caso de HLS, el navegador no lo puede leer.
- **DRM** (Widevine, FairPlay, etc.): no está implementado.

## 5. NO SOPORTADO todavía (necesita código específico)

- **Datos constantes y transformaciones:**
  - poner un valor fijo;
  - unir dos campos;
  - convertir formatos de fecha o de duración (por ejemplo "1h 30m" o "PT90M");
  - traducir códigos de tipo (por ejemplo `"t": 1` → película).
- **Consultas de detalle por título:** la lista trae pocos datos y hay que pedir cada título aparte para tener la sinopsis, el póster, etc.
- **Episodios dentro de la respuesta de la serie**, en lugar de un endpoint de episodios.
- **Temporadas con ID interno:** hay que pedir primero las temporadas y después los episodios de cada temporada usando su ID, no su número.
- **Tipos mezclados en un mismo endpoint**, sin un campo claro que indique el tipo de cada ítem.
- **Respuestas que no son JSON:** XML, HTML, CSV o texto.
- **Otras autenticaciones:**
  - OAuth (flujo con redirección y consentimiento);
  - `refresh_token` aparte del token;
  - firma de cada solicitud (HMAC, por ejemplo);
  - captcha;
  - un inicio de sesión distinto solo para reproducir.
- **Fin de lista ambiguo:** si la fuente no informa el total, la última página ni el cursor siguiente, Supat solo puede detectar el fin por una página vacía o repetida, y puede marcar la importación como "parcial".
- **Cualquier otra estructura** que no entre en los puntos 1 a 4.

## 6. Límites del plan gratuito del servidor

Conviene contrastarlos con el tamaño del catálogo de la fuente:

- unas **12.000 altas de títulos por día** entre las dos fuentes (100.000 filas escritas por día);
- **50 consultas a la fuente** por tanda, y una tanda por minuto;
- **500 MB** de base de datos.

Si la fuente tiene un límite de solicitudes, se configura y Supat lo respeta.

---

## Texto para pedirle el análisis a ChatGPT

> Te paso dos cosas:
> 1. El documento "Supat: qué soporta el configurador de fuentes".
> 2. La documentación técnica de una API de contenido.
>
> Analizá si esa API se puede conectar a Supat **solo con el configurador**. Respondé con esta estructura:
> 1. **Veredicto:**
>    - "Compatible";
>    - "Compatible con limitaciones";
>    - "Necesita código" (decí qué parte);
>    - "Reproducción no compatible".
> 2. **Autenticación:** qué tipo de la sección 1 corresponde y con qué nombre de encabezado o parámetro.
> 3. **Endpoints:** la ruta de películas, series, anime, temporadas y episodios (las que existan), y en qué ruta del JSON viene la lista.
> 4. **Paginación** de cada endpoint: el tipo, los parámetros y cómo se sabe que es la última página.
> 5. **Mapeo:** la ruta JSON de cada campo de la sección 3 (id, tipo, TMDb, IMDb, título, año, póster y su prefijo, etc.). Indicá los que no existen.
> 6. **Reproducción:**
>    - qué método de la sección 4 corresponde;
>    - dónde va la credencial;
>    - el formato;
>    - si vence;
>    - los subtítulos.
>
>    Indicá si cae en algún caso NO COMPATIBLE.
> 7. **Problemas:** todo lo que coincida con la sección 5, con la cita de la documentación.
> 8. **Límites de uso** de la API.
>
> No inventes rutas ni campos que no estén en la documentación. Si algo no está claro, ponelo como "no informado".
