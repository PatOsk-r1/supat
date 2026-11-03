# Seguridad de las cuentas de Supat

Plataforma: **Firebase, plan Spark (gratuito)**. Firebase Auth para las cuentas, Firestore para los datos personales y Firebase Hosting para la app (https://supat-h8tfw.web.app).
Este documento dice qué está aplicado, cómo se probó y qué riesgos quedan. Que existan estas medidas **no significa que el sistema sea seguro en términos absolutos**.

## Qué está aplicado y dónde

| Medida | Dónde se aplica |
|---|---|
| Contraseñas: nunca en texto plano ni reversibles (hash scrypt de Firebase Auth). La app exige 10 caracteres o más y rechaza las muy predecibles. | Firebase Auth + `src/app/account.js` |
| Verificación de correo; recuperación con enlace temporal; cambio de contraseña (pide la actual, y Firebase cierra las demás sesiones). | Firebase Auth + `account.js` |
| Mensajes que no revelan si un correo está registrado (ingreso, recuperación). | `account.js` (`messageFor`, `resetPassword`) |
| Límite de intentos de ingreso y registro. | Firebase Auth (incorporado; no configurable en Spark) |
| La sesión vive en IndexedDB, nunca en localStorage. | `src/app/firebase.js` |
| **Aislamiento entre usuarios**: la identidad sale de la sesión verificada por Google (`request.auth.uid`), nunca de un dato del navegador. Cada operación valida la propiedad. | `firestore.rules` |
| Validación de cada dato: campos permitidos, tipos, largos y fechas del servidor. | `firestore.rules` |
| Guardar algo exige correo verificado y cuenta no suspendida. | `firestore.rules` (`canWrite`) |
| **Cerrar todas las sesiones**: se rechazan las sesiones iniciadas antes de ese momento, aunque su token siga en un dispositivo. | `firestore.rules` (`revokedAt`) |
| **Vencimiento**: una sesión deja de servir a los 30 días de iniciada. | `firestore.rules` (`auth_time`) |
| Listas públicas separadas de las privadas, sin correo ni identificador de usuario (el dueño se identifica con un hash). | `publicLists/` en `firestore.rules` |
| Administradores: solo se crean a mano en la consola (`admins/<uid>`). Ninguna regla permite escribir ahí. | `firestore.rules` |
| Suspender o reactivar exige un registro de auditoría en la misma operación; la auditoría no se puede editar ni borrar. | `firestore.rules`, `src/app/admin.js` |
| Eliminar la cuenta borra sus favoritos, historial, listas (también las públicas), perfil y usuario. | `account.js` (`deleteAccount`) |
| HTTPS obligatorio (HSTS), CSP, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, la app no se puede embeber (`frame-ancestors 'none'`). | `firebase.json` |
| CSRF: no aplica, porque la sesión no viaja en cookies sino en un encabezado de cada petición. | — |
| Inyección SQL: no aplica (Firestore no usa SQL); los datos manipulados se rechazan por validación. | `firestore.rules` |

## Cómo se probó

- `npm run test:reglas`: **14 pruebas** contra el emulador de Firestore, con dos cuentas independientes y un administrador. Cubren acceso a listas, favoritos e historial ajenos, peticiones sin sesión, sesiones revocadas y vencidas, cuentas suspendidas, correo sin verificar, datos manipulados, escalada a administrador, auditoría, listas públicas, eliminación de cuenta y colecciones no previstas.
- **Prueba de punta a punta en el navegador** con los emuladores (`npm run emuladores` + `npm run dev:emu`): registro, verificación, favoritos, listas, lista pública sin sesión, historial, siete intentos de una cuenta de leer o escribir datos de otra (todos rechazados por el servidor), panel de administración con suspensión y auditoría, cambio de contraseña, cerrar todas las sesiones, recuperación de contraseña (mismo mensaje exista o no la cuenta) y eliminación de una cuenta suspendida.
- Revisión del código publicado: no contiene claves privadas. Solo tiene la configuración web de Firebase, que es pública por diseño.

## Cómo nombrar un administrador

1. En la consola de Firebase → Authentication, copiá el **UID** del usuario.
2. En Firestore → Iniciar colección `admins` → ID del documento = ese UID → campo `role` = `admin`.
3. El usuario vuelve a entrar y ve "Administración" en su perfil.

## Riesgos y límites pendientes (plan Spark)

- **Ver las sesiones activas** una por una: Firebase no lo ofrece del lado del cliente. Existe "Cerrar todas las sesiones".
- **Suspensión**: bloquea los datos de Firestore, pero la cuenta todavía puede iniciar sesión en Auth. Para bloquearla por completo hay que deshabilitarla a mano en la consola (Authentication → usuario → Inhabilitar).
- **Límite de intentos**: lo maneja Firebase Auth, sin poder configurarlo. Firestore no tiene límite propio por usuario en Spark.
- **Backups**: el plan Spark no tiene exportaciones automáticas de Firestore (necesitan Blaze). No hay copia de seguridad automática de los datos de usuarios.
- **Ataques XSS**: si alguien lograra inyectar código en la página, podría usar la sesión del usuario. Lo mitigan la CSP estricta (`script-src 'self'`) y que todos los textos se escapan antes de mostrarse.
- **Dependencias**: `npm audit` informa 5 alertas en `@grpc/grpc-js`, que usa el SDK de Firestore solo en Node (las pruebas), no en el navegador. Revisar cuando Firebase publique una actualización.
- **Claves de proveedores del navegador** (TMDb, Jellyfin, listas M3U): siguen guardadas en el navegador de cada usuario. Las del **catálogo central** se guardan cifradas en el servidor; ver la sección siguiente.
- Los límites gratuitos del plan Spark (lecturas y escrituras por día) pueden alcanzarse si hay muchos usuarios.

## Catálogo central (servidor en Cloudflare)

Detalle completo en [worker/README.md](worker/README.md). Resumen:

- **Sesión:** cada pedido a la API lleva el token de Firebase. El servidor verifica la firma con las claves públicas de Google, el proyecto, el vencimiento y que la sesión no tenga más de 30 días.
- **Roles:** `owner` y `user` se guardan en el servidor. Los propietarios iniciales salen de `OWNER_UIDS`, en la configuración del Worker. Nadie puede asignarse un rol: un dato agregado al token se ignora y nadie cambia su propio rol.
- **Cuentas:** se respetan la suspensión y "cerrar todas las sesiones". El servidor lee el perfil de Firestore con el token del propio usuario, cada 5 minutos como máximo.
- **Credenciales de proveedores:** se guardan cifradas con AES-GCM. La clave `SECRETS_KEY` es un secreto del Worker y no está en el repositorio. Nunca se devuelven al navegador ni aparecen en registros, auditoría o errores. Una fuente cuya dirección contiene la credencial no se entrega.
- **Auditoría:** cada acción del propietario queda registrada (quién, qué, sobre qué y qué campos), sin valores secretos.
- **CORS:** solo los sitios de `ALLOWED_ORIGINS` pueden usar la API desde el navegador. Los cambios desde otro origen se rechazan.
- **Pendiente:**
  - No hay límite de pedidos por usuario en la API.
  - El bloqueo del catálogo central es aparte de la suspensión de Firestore.
  - Si Firestore no responde, se usa el último estado conocido de la cuenta.

## Probar localmente

```bash
npm run test:reglas
```

Requiere Java (Temurin 21) en el PATH. Para usar la app contra los emuladores, en dos terminales:

```bash
npm run emuladores
```

```bash
npm run dev:emu
```
