import { defineConfig } from "vite";

// base "./" hace que el sitio compilado funcione desde cualquier carpeta.
// Modo "page" (npm run page): todo en un solo archivo JS, para la vista previa publicada.
export default defineConfig(({ mode }) => ({
  base: "./",
  build: mode === "page" ? { rollupOptions: { output: { inlineDynamicImports: true } } } : {}
}));
