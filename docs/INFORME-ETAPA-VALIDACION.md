# Informe: etapa de validación (2026-11-05)

Esta etapa comprueba, con **datos simulados**, lo que se construyó en la etapa de preparación ([INFORME-ETAPA-PREPARACION.md](INFORME-ETAPA-PREPARACION.md)).

- No se conectó ninguna fuente real.
- No se usó ninguna credencial real.
- No se publicó ni se desplegó nada.
- La migración 0005 sigue aplicada **solo en local**.

Cada resultado está en una sola categoría:

| Código | Significado |
|---|---|
| **AUTO** | Prueba automática (`npm test`), corrida al final de la etapa. |
| **CF-LOCAL** | Corrida real en el motor de Cloudflare local (workerd + D1 local) con `tests/validacion-local.mjs`. |
| **NAV** | Probado en el navegador con la app real (Vite en modo emulador, API local y sesión de propietario). |
| **CÓDIGO** | Solo se revisó el código. **No está probado.** |
| **REAL** | Pendiente de integración real: necesita las fuentes reales. |

---

## 1. Validación en Cloudflare local — completa

Requisitos:

- `npm run api:dev`, la API local en el puerto 8788;
- `node tests/helpers/servidor-validacion.mjs`, una API simulada en el puerto 8791 que no imita a ningún proveedor real.

Para correrla: `node tests/validacion-local.mjs`. Se corrió **dos veces seguidas** y las dos pasaron todas las comprobaciones.

| Comprobación | Resultado | Cat. |
|---|---|---|
| Migraciones 0001–0005 en D1 local | Están las tablas `provider_state`, `app_settings` y `maint_jobs`, y las columnas `sync_jobs.outcome`, `outcome_detail`, `paused`, `stalls` y `title_sources.meta_json`. | CF-LOCAL |
| Importación completa con paginación mezclada | Películas por número de página y series por "enlace siguiente". Resultado: `complete`. | CF-LOCAL |
| Estado parcial | Al llegar a `maxPages`, el trabajo queda `partial`, la fuente queda "parcial" y **no se oculta ningún título**. | CF-LOCAL |
| Bajas de episodios | Una importación **parcial** no marca episodios ausentes: los 8 de 8 siguen visibles. Una importación **completa**, con 2 episodios menos en la fuente, los marca ausentes sin borrarlos de la base. | CF-LOCAL |
| Límites con estado persistente | Ante un 429 con `Retry-After: 90`: el trabajo se pospone, no gasta intentos y `next_at` queda guardado en D1. Una tanda forzada durante la espera hace **0 solicitudes**. El registro explica la espera. | CF-LOCAL |
| Prioridades por campo | La vista previa indica 7 títulos con cambios. Aplicar sin confirmar responde 400. Con confirmación se aplica y la sinopsis de B pasa a mandar. Después se restauran las prioridades por defecto. | CF-LOCAL |
| Estado fallida | Con una credencial equivocada (simulada) el trabajo queda `FALLIDA` con la causa (401), y la credencial no aparece en la respuesta. | CF-LOCAL |
| Auditoría sin credenciales | Los registros de auditoría y de importación no contienen ninguna clave. | CF-LOCAL |

Nota: el script deja en curso el último trabajo de restauración (#8), porque no sigue los trabajos de mantenimiento hasta el final. Ese trabajo se terminó desde el navegador con el botón **Continuar** (ver punto 2). En uso normal lo termina el cron.

## 2. Navegador — completa

### Cómo se hizo sin tocar los emuladores del otro chat

El otro chat usa los emuladores en los puertos 9099, 4400 y 4500 (proceso 4256). Para no interrumpirlos se levantó un **segundo juego de emuladores** en otros puertos:

- `npm run emuladores:alt`, con la configuración `firebase.emu-alt.json`: Auth en 9199, Firestore en 8180, hub en 4410 y logging en 4510, sin interfaz;
- un archivo temporal `.env.emulador.local` con `VITE_EMU_AUTH` y `VITE_EMU_FIRESTORE` apuntando a esos puertos (ya borrado);
- `SUPAT_EMU_AUTH=http://127.0.0.1:9199 npm run cuenta:local` para crear la cuenta de propietario de prueba.

Antes y después se comprobó que los puertos 9099, 4400 y 4500 seguían en manos del proceso 4256.

### Resultados

| Pantalla o acción | Resultado | Cat. |
|---|---|---|
| Tarjeta de fuente con error | La fuente A muestra "Importación: FALLIDA" y la causa: el 401 y "Revisá las credenciales". | NAV |
| Probar conexión | Con la API simulada apagada muestra "✖ con problemas" y "El proveedor no se pudo conectar". | NAV |
| Fuente B | "Importación: Completada". | NAV |
| Paginación por endpoint | El endpoint de películas tiene sus 13 campos propios: tipo, parámetros, rutas de "siguiente", "última", "total", límites y políticas ante vacío, repetido o inválido. | NAV |
| Campos nuevos | Están los campos de límites (`rate.*`), de seguridad (`safety.*`) y los 10 campos de inicio de sesión. También "requiere encabezados", "requiere cookies" e idioma de subtítulos. Dónde va la clave **ya no ofrece "en la URL"**. | NAV |
| Herramientas | Está el botón "Reiniciar y confirmar bajas". | NAV |
| Prioridades: formulario | 13 filas, una por campo, y 3 botones. | NAV |
| Prioridades: guardar | Sinopsis "B primero" → "Guardar prioridades (sin aplicar)". El servidor respondió 200 y quedó `pending.description = [B, A]`, con `active` sin cambios. La pantalla mostró "Prioridades guardadas SIN aplicar…" y la marca "Sinopsis sin aplicar". | NAV |
| Prioridades: vista previa | "7 de 9 títulos evaluados cambiarían · 0 de 6 episodios", con el antes y el después de cada título. No cambió ningún dato. | NAV |
| Prioridades: restaurar | Se volvió a "A primero" y se guardó. La marca desapareció. | NAV |
| Trabajo de actualización | "Continuar" llevó el trabajo #8 de títulos a episodios y lo terminó: "terminada · 18 revisados · 7 con cambios". | NAV |
| Selector de subtítulos | Con `tests/fixtures/reproductor-subtitulos.html` aparecen las opciones "Sin subtítulos / Español (es) / English (en)". El SRT se convierte y se muestra. Cambiar de idioma y apagar los subtítulos funciona. Se probó en esta misma etapa, antes de este informe. | NAV |

### Error encontrado y corregido en el navegador

**Síntoma:** los cambios del formulario sin guardar se perdían cuando la pantalla se redibujaba sola. Pasaba, por ejemplo, al terminar de cargar el estado de una fuente. Al guardar las prioridades se mandaba el valor viejo.

**Corrección:** `src/ui/app.js` ahora guarda los cambios en curso de los formularios de fuentes y de prioridades y los repone después de cada redibujo. Se descartan solo al guardar con éxito.

**Verificado en el navegador:** el valor elegido sobrevivió a un redibujo y llegó al servidor.

## 3. Pruebas automáticas — corridas al final de la etapa

`npm test`: **121 pruebas: 115 pasan, 0 fallan y 6 quedan omitidas.** Las 6 omitidas son las de integración real y solo corren con `SUPAT_INTEGRACION=1` y fuentes reales.

`npx vite build` compila bien. Solo muestra el aviso de siempre por el tamaño de un archivo, que no es un error.

No se corrió `npm run test:reglas` (las reglas de Firestore). Levanta los emuladores en sus puertos por defecto, que comparte con el otro chat. Además, las reglas no cambiaron en esta etapa.

## 4. Revisado solo en el código (no probado)

| Tema | Por qué no se pudo probar | Cat. |
|---|---|---|
| Inicio de sesión → token con un servidor real | La renovación y el reintento ante un 401 están probados contra una API simulada (AUTO). El comportamiento con un servidor de verdad (vencimientos, formatos) no se puede comprobar sin fuente real. | CÓDIGO / REAL |
| Enlace de video vencido durante la reproducción | El reproductor vuelve a pedir el enlace; no hay una fuente que genere enlaces que venzan. | CÓDIGO |
| Subtítulos de otro dominio sin CORS | El navegador los bloquearía. Está previsto, pero no se probó con un servidor ajeno. | CÓDIGO |
| Ejecución del cron programado | En local se usó la tanda manual o el botón Continuar, que llaman al mismo código. | CÓDIGO |

## 5. Pendiente de integración real

Para todo esto hacen falta las fuentes reales y no se hizo nada:

- conexión, catálogo, importación y reproducción de cada fuente (las 6 pruebas omitidas);
- límites reales de frecuencia y formatos de error de cada fuente;
- tamaño real del catálogo frente a los límites del plan gratuito: 100.000 filas escritas por día, 50 consultas por invocación y 500 MB;
- aplicar las migraciones 0003, 0004 y 0005 en la base remota, desplegar el Worker y publicar la app. Solo con el OK del usuario.

## 6. Limitaciones que siguen (necesitan código específico)

- **Datos constantes y transformaciones:** valores fijos, combinar campos, cambiar formatos de fecha o duración, unidades.
- **Consultas adicionales de detalle por título:** cuando la lista no trae todos los datos y hay que pedir cada título aparte.
- **Episodios incluidos dentro de la respuesta de una serie** en lugar de un endpoint propio.
- **Temporadas con ID interno**, que exigen pedir primero la lista de temporadas.
- **Endpoints con tipos mezclados**: películas y series en la misma lista.
- **Respuestas que no son JSON**: XML, HTML o texto.
- **Otras autenticaciones:**
  - OAuth;
  - `refresh_token`;
  - firma de solicitudes;
  - captcha;
  - inicio de sesión aparte para reproducir.
- **Fin de lista ambiguo:** si la fuente no informa el total ni la última página, Supat se apoya en una página vacía o repetida. Si la fuente se corta antes, lo marca como **parcial** y no da de baja nada.
- **Credencial dentro de la URL del video:** es **NO COMPATIBLE** a propósito y no se va a "esconder".
- **Proxy de video:** no se hace, porque no es viable en el plan gratuito.

## 7. ¿Supat está listo para la integración real?

**Sí para empezarla, con una condición:** antes de cargar cada fuente hay que comparar su documentación con la lista del punto 6.

- Si la fuente encaja en lo que el configurador ya soporta, se puede conectar desde Ajustes en el entorno local separado (`npm run api:real`) y correr las pruebas de integración.
- Si usa algo de la lista del punto 6, primero hace falta código específico.

La integración real **no empezó**: no se conectó ninguna fuente.

## Archivos de esta etapa

- `tests/validacion-local.mjs` (nuevo): validación en Cloudflare local.
- `tests/helpers/servidor-validacion.mjs` (nuevo): API simulada controlable.
- `firebase.emu-alt.json` (nuevo) y el script `emuladores:alt` en `package.json`: emuladores en otros puertos.
- `src/app/firebase.js`: puertos del emulador configurables con `VITE_EMU_AUTH` y `VITE_EMU_FIRESTORE`, solo en modo emulador.
- `scripts/cuenta-local.mjs`: acepta `SUPAT_EMU_AUTH`.
- `src/ui/app.js`: conserva los cambios sin guardar de los formularios.
- `docs/AUDITORIA-FUENTES.md`, `PRUEBAS.md` y este informe.
