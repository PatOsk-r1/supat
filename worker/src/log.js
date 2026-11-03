// Registro técnico y auditoría. Los textos se recortan y pasan por redact() antes de guardarse.
import { redact } from "./secrets.js";

const clip = (s, n) => String(s ?? "").slice(0, n);

export async function log(env, level, scope, message, { providerId = null, jobId = null, secrets = {} } = {}) {
  try {
    await env.DB.prepare("INSERT INTO logs (at, level, scope, provider_id, job_id, message) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(Date.now(), level, clip(scope, 40), providerId, jobId, clip(redact(message, secrets), 1000)).run();
  } catch {
    // Un fallo al registrar nunca corta la operación.
  }
}

export function auditStatement(env, actor, action, target = "", detail = "") {
  return env.DB.prepare("INSERT INTO audit (at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)")
    .bind(Date.now(), clip(actor, 128), clip(action, 60), clip(target, 200), clip(detail, 500));
}

export function audit(env, ...args) {
  return auditStatement(env, ...args).run();
}
