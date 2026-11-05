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
  // Fuente A ("a") y Fuente B ("b").
  sources: () => api.get("/api/admin/sources"),
  saveSource: (slot, body) => apiRequest("PUT", `/api/admin/sources/${slot}`, body),
  sourceAction: (slot, action, body = {}) => api.post(`/api/admin/sources/${slot}/${action}`, body),
  sourceErrors: slot => api.get(`/api/admin/sources/${slot}/errors`),
  reindex: () => api.post("/api/admin/catalog/reindex"),
  // Prioridad de datos entre fuentes.
  priorities: () => api.get("/api/admin/priorities"),
  savePriorities: priorities => apiRequest("PUT", "/api/admin/priorities", { priorities }),
  previewPriorities: priorities => api.post("/api/admin/priorities/preview", priorities ? { priorities } : {}),
  applyPriorities: () => api.post("/api/admin/priorities/apply", { confirm: true }),
  continuePriorities: () => api.post("/api/admin/priorities/continue")
};
