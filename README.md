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

## Estado
- Interfaz responsive de catálogo: implementada con datos de demostración.
- Navegación: Inicio, TV en vivo, Películas, Series y Favoritos.
- Búsqueda local: implementada.
- Reproductor: solo abre una fuente de video de demostración cuando se configura una URL autorizada en `src/data.js`.
- Integración con servicios de Xuper: no confirmada; requiere API documentada/autorizada o acceso del proveedor.

No cargar URLs privadas, credenciales ni tokens en el frontend. Para una integración real, las credenciales deben gestionarse en un backend seguro.
