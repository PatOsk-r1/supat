# Archivos de prueba

- `lista-prueba.m3u`: lista M3U para probar el proveedor "Lista de canales". Usa las transmisiones de ejemplo que Apple publica para desarrolladores (bipbop) y un canal inexistente para probar el mensaje de error.
- `guia-prueba.xml`: guía XMLTV con programas largos, para que siempre haya un programa "ahora".

Con `npm run dev` abierto, en Ajustes → Agregar proveedor → Lista de canales (M3U), usá como dirección:
`http://localhost:5174/tests/fixtures/lista-prueba.m3u` (cambiá el puerto si Vite usa otro).
