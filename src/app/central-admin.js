// Operaciones del propietario sobre el catálogo central. Todas las valida el servidor
// (rol "owner"); esta capa solo arma los pedidos. Las credenciales que se escriben en el panel
// viajan una sola vez al servidor y nunca vuelven: el servidor solo responde qué campos están cargados.
import { api, apiRequest } from "./api.js";

const q = obj => new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== "" && v != null)).toString();

export const centralAdmin = {
  providers: () => api.get("/api/admin/providers").then(r => r.providers),
  jobs: (provider = "") => api.get(`/api/admin/jobs?${q({ provider, limit: 40 })}`).then(r => r.jobs),
  continueJob: id => api.post(`/api/admin/jobs/${id}/continue`),
  cancelJob: id => api.post(`/api/admin/jobs/${id}/cancel`),
  logs: ({ level = "", before = "" } = {}) => api.get(`/api/admin/logs?${q({ level, before, limit: 100 })}`).then(r => r.logs),
  audit: () => api.get("/api/admin/audit?limit=60").then(r => r.audit),
  users: () => api.get("/api/admin/users").then(r => r.users),
  updateUser: (uid, body) => api.patch(`/api/admin/users/${encodeURIComponent(uid)}`, body),
  stats: () => api.get("/api/admin/stats"),
  source: () => api.get("/api/admin/source"),
  saveSource: body => apiRequest("PUT", "/api/admin/source", body),
  testSource: body => api.post("/api/admin/source/test", body),
  syncSource: mode => api.post("/api/admin/source/sync", { mode }),
  reindex: () => api.post("/api/admin/catalog/reindex")
};
