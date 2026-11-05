// Servidor de VALIDACIÓN local (API simulada, no existe ni imita a ninguna real) para probar la API
// en workerd + D1 local con escenarios controlables:
//   películas paginadas por número de página, series por "enlace siguiente", episodios por serie,
//   respuestas 429 con Retry-After y episodios que desaparecen.
// Uso: node tests/helpers/servidor-validacion.mjs   (http://127.0.0.1:8791)
// Control: POST /control con JSON { limited, episodes, maxMovies } · GET /control → contadores.
import { createServer } from "node:http";

const PORT = 8791;
const KEY = "clave-de-validacion-local";
const state = { limited: false, episodes: [1, 2, 3, 4], requests: 0, byPath: {} };
const MOVIES = Array.from({ length: 7 }, (_, i) => ({ id: `m${i}`, name: `Validación ${i}`, tmdb: 9100 + i, desc: `Sinopsis ${i}`, img: `/p/${i}.jpg` }));

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (u.pathname === "/control") {
    if (req.method === "POST") {
      let raw = "";
      req.on("data", c => (raw += c));
      req.on("end", () => { Object.assign(state, JSON.parse(raw || "{}")); send(res, 200, state); });
      return;
    }
    return send(res, 200, state);
  }
  state.requests++;
  state.byPath[u.pathname] = (state.byPath[u.pathname] || 0) + 1;
  if (req.headers["x-key"] !== KEY) return send(res, 401, { error: "clave" });
  if (state.limited) return send(res, 429, { error: "demasiadas solicitudes" }, { "Retry-After": "90" });
  if (u.pathname === "/v1/movies") {
    const p = Number(u.searchParams.get("p") || 1);
    return send(res, 200, { data: MOVIES.slice((p - 1) * 3, p * 3), meta: { pages: Math.ceil(MOVIES.length / 3) } });
  }
  if (u.pathname === "/v1/shows") {
    const n = Number(u.searchParams.get("n") || 1);
    return send(res, 200, { results: [{ id: `s${n}`, name: `Serie de validación ${n}`, tmdb: 9200 + n }], links: { next: n < 2 ? `http://127.0.0.1:${PORT}/v1/shows?n=${n + 1}` : null } });
  }
  const ep = /^\/v1\/shows\/(s\d+)\/episodes$/.exec(u.pathname);
  if (ep) return send(res, 200, { items: state.episodes.map(n => ({ id: `${ep[1]}-e${n}`, season: 1, number: n, title: `Episodio ${n}` })) });
  return send(res, 404, { error: "no existe" });
}).listen(PORT, "127.0.0.1", () => console.log(`Servidor de validación en http://127.0.0.1:${PORT}`));
