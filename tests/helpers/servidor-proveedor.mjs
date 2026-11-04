// Servidor HTTP local con el proveedor INVENTADO de las pruebas (tests/helpers/proveedor-simulado.js),
// para probar la API corriendo en wrangler (workerd + D1 local) de punta a punta.
// Uso: node tests/helpers/servidor-proveedor.mjs   (escucha en http://127.0.0.1:8790/v1)
import { createServer } from "node:http";
import { BASE, providerNet } from "./proveedor-simulado.js";

const PORT = 8790;
const net = providerNet();

createServer(async (req, res) => {
  // "Video" de prueba: una lista HLS mínima y un segmento de bytes cualquiera (no es video real;
  // sirve para probar que el arnés de integración sigue listas y segmentos).
  if (req.url.startsWith("/cdn/")) {
    const headers = { "Access-Control-Allow-Origin": "*" };
    if (req.url.endsWith(".m3u8")) {
      res.writeHead(200, { ...headers, "Content-Type": "application/vnd.apple.mpegurl" });
      res.end("#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nseg0.ts\n#EXT-X-ENDLIST\n");
    } else {
      res.writeHead(req.headers.range ? 206 : 200, { ...headers, "Content-Type": req.url.endsWith(".ts") ? "video/mp2t" : "video/mp4" });
      res.end(Buffer.alloc(1024, 0x47));
    }
    return;
  }
  const url = BASE + req.url.replace(/^\/v1/, "");
  const headers = { "X-Api-Key": req.headers["x-api-key"] };
  if (req.headers["x-play-token"]) headers["X-Play-Token"] = req.headers["x-play-token"];
  const out = await net(url, { headers });
  const body = (await out.text()).replaceAll("https://cdn.prov.ejemplo", `http://127.0.0.1:${PORT}/cdn`);
  res.writeHead(out.status, { "Content-Type": "application/json" });
  res.end(body);
}).listen(PORT, "127.0.0.1", () => console.log(`Proveedor de prueba en http://127.0.0.1:${PORT}/v1`));
