-- Preparación de las fuentes reales: estados de importación, límites de frecuencia persistentes,
-- sesiones (token) por fuente, datos por fuente para elegir prioridades y tareas de mantenimiento.
-- Solo agrega columnas y tablas: no borra ni modifica datos existentes.

-- Resultado de un trabajo terminado: complete | warnings | partial (y su motivo).
ALTER TABLE sync_jobs ADD COLUMN outcome TEXT NOT NULL DEFAULT '';
ALTER TABLE sync_jobs ADD COLUMN outcome_detail TEXT NOT NULL DEFAULT '';

-- Datos descriptivos tal como los entregó cada fuente (para aplicar prioridades por campo).
ALTER TABLE title_sources ADD COLUMN meta_json TEXT NOT NULL DEFAULT '';
ALTER TABLE episode_sources ADD COLUMN meta_json TEXT NOT NULL DEFAULT '';

-- Estado persistente por fuente: próxima solicitud permitida, ventana de solicitudes y token de sesión
-- (cifrado). Sobrevive entre tandas, reinicios del Worker y ejecuciones del cron.
CREATE TABLE IF NOT EXISTS provider_state (
  provider_id TEXT PRIMARY KEY,
  next_at INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL DEFAULT 0,
  window_count INTEGER NOT NULL DEFAULT 0,
  token_enc TEXT NOT NULL DEFAULT '',
  token_expires_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);

-- Ajustes generales del servidor (por ejemplo, prioridades de datos entre fuentes).
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Tareas de mantenimiento reanudables (por ejemplo, aplicar nuevas prioridades al catálogo).
CREATE TABLE IF NOT EXISTS maint_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed', 'cancelled')),
  cursor INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  changed INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL DEFAULT '{}',
  last_error TEXT NOT NULL DEFAULT '',
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
);
