import { defineConfig } from "vite";

// base "./" hace que el sitio compilado funcione desde cualquier carpeta
// (por ejemplo, abierto desde un hosting estático o una subcarpeta).
export default defineConfig({ base: "./" });
