// Junta el CSS y el JS de dist/ dentro de un único HTML (publish/supat.html),
// útil para compartir una vista previa como un solo archivo.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";

const dir = "dist/assets/";
const files = readdirSync(dir);
const css = readFileSync(dir + files.find(f => f.endsWith(".css")), "utf8");
const js = readFileSync(dir + files.find(f => f.endsWith(".js")), "utf8").replace(/<\/script/gi, "<\/script");

mkdirSync("publish", { recursive: true });
writeFileSync("publish/supat.html",
  `<title>Supat</title>\n<meta name="theme-color" content="#101014">\n<style>${css}</style>\n<div id="app"></div>\n<script type="module">${js}</script>\n`);
console.log("publish/supat.html listo");
