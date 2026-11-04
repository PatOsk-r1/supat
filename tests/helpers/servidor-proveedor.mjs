// Servidor HTTP local con el proveedor INVENTADO de las pruebas (tests/helpers/proveedor-simulado.js),
// para probar la API corriendo en wrangler (workerd + D1 local) de punta a punta.
// Uso: node tests/helpers/servidor-proveedor.mjs   (escucha en http://127.0.0.1:8790/v1)
import { createServer } from "node:http";
import { BASE, providerNet } from "./proveedor-simulado.js";

const PORT = 8790;
const net = providerNet();

createServer(async (req, res) => {
  const url = BASE + req.url.replace(/^\/v1/, "");
  const headers = { "X-Api-Key": req.headers["x-api-key"] };
  if (req.headers["x-play-token"]) headers["X-Play-Token"] = req.headers["x-play-token"];
  const out = await net(url, { headers });
  const body = (await out.text()).replaceAll("https://cdn.prov.ejemplo", `http://127.0.0.1:${PORT}/cdn`);
  res.writeHead(out.status, { "Content-Type": "application/json" });
  res.end(body);
}).listen(PORT, "127.0.0.1", () => console.log(`Proveedor de prueba en http://127.0.0.1:${PORT}/v1`));
