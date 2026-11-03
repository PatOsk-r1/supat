# Informe preliminar del APK de Xuper TV
Fecha: 2026-11-02

## Archivo inspeccionado
- Nombre: `XuperTV_oficial_TV_1764408199.apk`
- Tamaño: aproximadamente 31 MiB.
- Tipo detectado por `file`: paquete Android (APK).
- Entradas ZIP: 2.246.
- Se realizó inspección estática de metadatos/recursos; no se ejecutó el APK.

## Hallazgos observados directamente
- `AndroidManifest.xml` está presente, pero no se decodificó en esta pasada.
- Existe `classes.dex` de solo 13.672 bytes; el DEX principal es muy pequeño frente al tamaño del APK, lo que es compatible con carga de código adicional/protegido, pero no prueba por sí solo cómo se protege.
- Bibliotecas nativas en `lib/arm64-v8a/` y `lib/armeabi-v7a/`, incluyendo `libijkplayer.so`, `libijkffmpeg.so`, `libijksdl.so`, `libtnet-3.1.14.so`, bibliotecas Crashlytics/CrashSDK y `libranger-jni.so`.
- Recursos de empaquetado/protección con nombres `assets/ijiami.ajm`, `assets/ijiami.dat`, `assets/IJMDal.Data`, `assets/signed.bin`, `assets/af.bin` y `assets/sign_verify.png`.
- `assets/domain_test.json` define 22 campos para servicios principal/respaldo: `upgrade`, `portal`, `epg`, `market`, `epg4b_sn`, `epg4b_data`, `diamond`, `notice`, `dccore`, `datacollect` y `ad`. En el archivo examinado, todos los valores son literalmente `xx`; no se obtuvieron dominios reales de ese recurso.
- `assets/therouter/routeMap.json` muestra rutas/clases para `VodDetailsActivity`, `VodCategoryActivity`, `UserCenterActivity`, `PurchaseActivity`, `InviteFriendsActivity`, `HomeActivity`, `ForcePasswordChangeActivity` y `DownloadActivity`.
- `assets/test1.html` contiene un mensaje de prueba “Illegal users”.
- El DEX contiene la cadena de paquete `com.interactive.brasiliptv.app.App`; esto no basta para establecer marca, proveedor o autenticidad.

## Límites de lo que se sabe
- No se han confirmado endpoints reales, credenciales, esquema de API ni URL de reproducción.
- No se ha demostrado que los servicios sean públicos o tengan una API web.
- No se ha probado reproducción en navegador.
- Los recursos de protección sugieren que una parte de la lógica podría no estar disponible en claro mediante inspección simple.

## Próximas tareas técnicas seguras
1. Decodificar el manifiesto con una herramienta Android adecuada y registrar permisos/componentes.
2. Obtener un inventario completo de recursos, bibliotecas y hashes.
3. Usar JADX/apktool en un entorno aislado para el análisis estático permitido; registrar errores si la protección impide decompilar.
4. Revisar únicamente APIs documentadas/públicas o servicios para los que exista autorización.
5. Seguir desarrollando la interfaz web de forma independiente con contenido ficticio, conectando luego fuentes autorizadas.
6. No intentar saltar autenticación, DRM, controles de acceso ni mecanismos anti-manipulación.

## Nota de precisión
La inspección actual no permite afirmar que la aplicación sea Magis TV ni confirmar que “Xuper” sea un cambio de nombre oficial. El nombre del archivo lo sugiere, pero el origen no se ha verificado independientemente.
