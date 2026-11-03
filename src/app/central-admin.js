// Operaciones del propietario sobre el catálogo central. Todas las valida el servidor
// (rol "owner"); esta capa solo arma los pedidos. Las credenciales que se escriben en el panel
// viajan una sola vez al servidor y nunca vuelven: el servidor solo responde qué campos están cargados.
import { api } from "./api.js";

const q = obj => new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== "" && v != null)).toString();

export const centralAdmin = {
  adapters: () => api.get("/api/admin/adapters").then(r => r.adapters),
  providers: () => api.get("/api/admin/providers").then(r => r.providers),
  createProvider: body => api.post("/api/admin/providers", body).then(r => r.provider),
  updateProvider: (id, body) => api.patch(`/api/admin/providers/${encodeURIComponent(id)}`, body).then(r => r.provider),
  testProvider: (id, config) => api.post(`/api/admin/providers/${encodeURIComponent(id)}/test`, config ? { config } : {}),
  sync: (id, mode) => api.post(`/api/admin/providers/${encodeURIComponent(id)}/sync`, { mode }),
  jobs: (provider = "") => api.get(`/api/admin/jobs?${q({ provider, limit: 40 })}`).then(r => r.jobs),
  continueJob: id => api.post(`/api/admin/jobs/${id}/continue`),
  cancelJob: id => api.post(`/api/admin/jobs/${id}/cancel`),
  logs: ({ level = "", before = "" } = {}) => api.get(`/api/admin/logs?${q({ level, before, limit: 100 })}`).then(r => r.logs),
  audit: () => api.get("/api/admin/audit?limit=60").then(r => r.audit),
  users: () => api.get("/api/admin/users").then(r => r.users),
  updateUser: (uid, body) => api.patch(`/api/admin/users/${encodeURIComponent(uid)}`, body),
  stats: () => api.get("/api/admin/stats"),
  reindex: () => api.post("/api/admin/catalog/reindex")
};
