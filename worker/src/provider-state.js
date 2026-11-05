// Estado persistente de cada fuente (tabla provider_state):
//   - límite de frecuencia: próxima solicitud permitida y ventana de solicitudes;
//   - sesión: token obtenido con "inicio de sesión" (cifrado) y su vencimiento.
// Se guarda en D1, así que se respeta entre tandas, reinicios del Worker y ejecuciones del cron.
import { ProviderError, pick } from "./providers/contract.js";
import { encryptSecrets, decryptSecrets } from "./secrets.js";

const SHORT_WAIT_MS = 1500; // esperas cortas se hacen dentro de la tanda; las largas posponen el trabajo

export async function loadState(env, providerId) {
  const row = await env.DB.prepare("SELECT * FROM provider_state WHERE provider_id = ?").bind(providerId).first();
  return { provider_id: providerId, next_at: 0, window_start: 0, window_count: 0, token_enc: "", token_expires_at: 0, ...(row || {}), dirty: false };
}

export async function saveState(env, state) {
  if (!state?.dirty) return;
  await env.DB.prepare(`INSERT INTO provider_state (provider_id, next_at, window_start, window_count, token_enc, token_expires_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (provider_id) DO UPDATE SET next_at = excluded.next_at, window_start = excluded.window_start, window_count = excluded.window_count,
    token_enc = excluded.token_enc, token_expires_at = excluded.token_expires_at, updated_at = excluded.updated_at`)
    .bind(state.provider_id, state.next_at, state.window_start, state.window_count, state.token_enc, state.token_expires_at, Date.now()).run();
  state.dirty = false;
}

// "Retry-After": segundos o fecha HTTP. Devuelve milisegundos, o 0 si no hay.
export function retryAfterMs(header, now = Date.now()) {
  if (!header) return 0;
  const n = Number(header);
  if (Number.isFinite(n) && n >= 0) return n * 1000;
  const t = Date.parse(header);
  return Number.isFinite(t) ? Math.max(0, t - now) : 0;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Control de frecuencia de una fuente. cfg = { minIntervalMs, windowSec, windowMax, honorRetryAfter, on429, maxWaitMs, retryDelayMs }
export function makeGate(state, cfg, { now = () => Date.now() } = {}) {
  const defer = (until, why) => {
    const err = new ProviderError(`Solicitudes pospuestas hasta las ${new Date(until).toISOString().slice(11, 19)} UTC (${why}).`, { retryable: true, status: -2 });
    err.deferUntil = until;
    err.rateLimited = true;
    return err;
  };
  return {
    async before() {
      let t = now();
      if (cfg.windowSec > 0 && cfg.windowMax > 0) {
        if (t - state.window_start >= cfg.windowSec * 1000) { state.window_start = t; state.window_count = 0; state.dirty = true; }
        if (state.window_count >= cfg.windowMax) state.next_at = Math.max(state.next_at, state.window_start + cfg.windowSec * 1000);
      }
      if (state.next_at > t) {
        const wait = state.next_at - t;
        if (wait > SHORT_WAIT_MS) throw defer(state.next_at, state.window_count >= cfg.windowMax && cfg.windowMax > 0 ? "límite de solicitudes por ventana" : "intervalo mínimo o espera pedida por la fuente");
        await sleep(wait);
        t = now();
        if (cfg.windowSec > 0 && t - state.window_start >= cfg.windowSec * 1000) { state.window_start = t; state.window_count = 0; }
      }
      state.window_count++;
      state.next_at = t + (cfg.minIntervalMs || 0);
      state.dirty = true;
    },
    // Respuesta 429 (o 503 con Retry-After): se agenda la próxima solicitud permitida.
    onLimited(res) {
      const t = now();
      const ra = cfg.honorRetryAfter ? retryAfterMs(res.headers.get("retry-after"), t) : 0;
      const wait = Math.min(cfg.maxWaitMs || 3600e3, ra || cfg.retryDelayMs || 60000);
      state.next_at = Math.max(state.next_at, t + wait);
      state.dirty = true;
      const err = defer(state.next_at, res.status === 429 ? "la fuente respondió 429" : `la fuente pidió esperar (${res.status})`);
      err.status = res.status;
      err.consumesAttempt = res.status !== 429 || cfg.on429 === "retry";
      return err;
    }
  };
}

// Sesión con token ("inicio de sesión: usuario y contraseña → token"). El token se guarda cifrado
// en provider_state y se renueva al vencer o ante un 401. Nunca sale del servidor.
export function makeSession(env, state, login, { fetch, secrets, baseUrl }) {
  let mem = null;
  async function doLogin() {
    const root = new URL(baseUrl);
    const url = new URL(root.origin + root.pathname.replace(/\/$/, "") + login.path);
    const fields = { [login.userField || "username"]: secrets.username || "", [login.passField || "password"]: secrets.password || "", ...Object.fromEntries(login.extra || []) };
    const headers = { Accept: "application/json", ...(login.headers || {}) };
    let body;
    if (login.format === "form") { headers["Content-Type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(fields).toString(); }
    else { headers["Content-Type"] = "application/json"; body = JSON.stringify(fields); }
    let res;
    try { res = await fetch(url.toString(), { method: "POST", headers, body }); }
    catch (err) {
      if (err.status === 401 || err.status === 403) throw new ProviderError("El inicio de sesión fue rechazado: revisá usuario y contraseña.", { status: err.status });
      throw err;
    }
    let data;
    try { data = await res.json(); } catch { throw new ProviderError("El inicio de sesión no respondió JSON."); }
    const token = pick(data, login.tokenPath);
    if (!token || typeof token !== "string") throw new ProviderError("El inicio de sesión no devolvió un token en la ruta configurada.");
    let exp = 0;
    const raw = login.expiresPath ? pick(data, login.expiresPath) : undefined;
    if (raw !== undefined && raw !== null && raw !== "") {
      const n = Number(raw);
      exp = Number.isFinite(n) ? (n > 1e12 ? n : n > 1e9 ? n * 1000 : Date.now() + n * 1000) : Date.parse(String(raw)) || 0;
    }
    if (!exp) exp = Date.now() + (login.ttlSec || 3600) * 1000;
    mem = { token, exp };
    state.token_enc = await encryptSecrets(env, { t: token });
    state.token_expires_at = exp;
    state.dirty = true;
    await saveState(env, state);
    return token;
  }
  return {
    async token(force = false) {
      const now = Date.now();
      if (!force && mem && mem.exp > now + 30000) return mem.token;
      if (!force && state.token_enc && state.token_expires_at > now + 30000) {
        try {
          const t = (await decryptSecrets(env, state.token_enc)).t;
          if (t) { mem = { token: t, exp: state.token_expires_at }; return t; }
        } catch { /* se vuelve a iniciar sesión */ }
      }
      return doLogin();
    },
    // Para las pruebas y el panel: ¿hay un token vigente guardado? (nunca devuelve el token)
    hasValidToken: () => Boolean((mem && mem.exp > Date.now()) || (state.token_enc && state.token_expires_at > Date.now()))
  };
}
