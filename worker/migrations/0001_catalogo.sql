-- Catálogo central de Supat (Cloudflare D1 / SQLite).
-- Las migraciones solo agregan: nunca borran tablas ni datos existentes.

-- Usuarios conocidos por el servidor. La identidad viene de Firebase Auth (uid verificado);
-- el rol lo asigna SOLO el servidor (dueños iniciales por configuración, el resto desde el panel).
CREATE TABLE IF NOT EXISTS users (
  uid TEXT PRIMARY KEY,
  email TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('owner', 'user')),
  blocked INTEGER NOT NULL DEFAULT 0,          -- bloqueado para el catálogo central
  suspended INTEGER NOT NULL DEFAULT 0,        -- copia de users/{uid}.suspended de Firestore
  revoked_at INTEGER NOT NULL DEFAULT 0,       -- copia de "cerrar todas las sesiones" (segundos)
  checked_at INTEGER NOT NULL DEFAULT 0,       -- última consulta del perfil en Firestore (ms)
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

-- Proveedores del catálogo central. config_json NO tiene secretos; los secretos van cifrados
-- (AES-GCM) en secrets_enc y nunca salen del servidor.
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  adapter TEXT NOT NULL,
  label TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  schedule TEXT NOT NULL DEFAULT 'daily' CHECK (schedule IN ('daily', 'manual')),
  config_json TEXT NOT NULL DEFAULT '{}',
  secrets_enc TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 100,       -- menor = se prueba primero al reproducir
  last_sync_at INTEGER,                        -- inicio de la última sincronización terminada bien
  last_status TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Títulos únicos del catálogo (películas, series, anime, canales).
CREATE TABLE IF NOT EXISTS titles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('live', 'movie', 'series', 'anime')),
  title TEXT NOT NULL,
  title_norm TEXT NOT NULL,
  original_title TEXT NOT NULL DEFAULT '',
  year INTEGER,
  description TEXT NOT NULL DEFAULT '',
  poster TEXT NOT NULL DEFAULT '',
  backdrop TEXT NOT NULL DEFAULT '',
  categories_json TEXT NOT NULL DEFAULT '[]',
  rating REAL,
  tmdb_type TEXT,                              -- 'movie' | 'tv' (los ids de TMDb son por tipo)
  tmdb_id INTEGER,
  imdb_id TEXT,
  has_episodes INTEGER NOT NULL DEFAULT 0,
  origin_provider TEXT NOT NULL DEFAULT '',     -- proveedor que lo creó (sus datos mandan)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS titles_tmdb ON titles (tmdb_type, tmdb_id) WHERE tmdb_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS titles_imdb ON titles (imdb_id) WHERE imdb_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS titles_kind ON titles (kind, updated_at);
CREATE INDEX IF NOT EXISTS titles_norm ON titles (title_norm);

-- De qué proveedor viene cada título (un título puede venir de varios).
CREATE TABLE IF NOT EXISTS title_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_id INTEGER NOT NULL REFERENCES titles (id),
  provider_id TEXT NOT NULL REFERENCES providers (id),
  external_id TEXT NOT NULL,
  playback_json TEXT NOT NULL DEFAULT '',      -- {url,type} | {lazy:true} | '' (sin fuente propia)
  data_json TEXT NOT NULL DEFAULT '{}',        -- datos del adaptador para pedir episodios o la fuente
  hash TEXT NOT NULL DEFAULT '',               -- huella de lo recibido: si no cambió, no se reescribe
  removed INTEGER NOT NULL DEFAULT 0,          -- el proveedor ya no lo ofrece (no se borra)
  seen_at INTEGER NOT NULL,
  episodes_synced_at INTEGER,
  UNIQUE (provider_id, external_id)
);
CREATE INDEX IF NOT EXISTS title_sources_title ON title_sources (title_id);

CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_id INTEGER NOT NULL REFERENCES titles (id),
  season INTEGER NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  still TEXT NOT NULL DEFAULT '',
  duration INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  UNIQUE (title_id, season, number)
);

CREATE TABLE IF NOT EXISTS episode_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL REFERENCES episodes (id),
  provider_id TEXT NOT NULL REFERENCES providers (id),
  external_id TEXT NOT NULL,
  playback_json TEXT NOT NULL DEFAULT '',
  data_json TEXT NOT NULL DEFAULT '{}',
  hash TEXT NOT NULL DEFAULT '',
  removed INTEGER NOT NULL DEFAULT 0,
  seen_at INTEGER NOT NULL,
  UNIQUE (provider_id, external_id)
);
CREATE INDEX IF NOT EXISTS episode_sources_episode ON episode_sources (episode_id);

-- Trabajos de importación: avanzan por tandas y guardan dónde quedaron (reanudables).
CREATE TABLE IF NOT EXISTS sync_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL REFERENCES providers (id),
  mode TEXT NOT NULL CHECK (mode IN ('full', 'incremental')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  cursor_json TEXT NOT NULL DEFAULT '{}',
  since INTEGER,                               -- incremental: cambios desde este momento (ms)
  pages INTEGER NOT NULL DEFAULT 0,
  seen INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  merged INTEGER NOT NULL DEFAULT 0,           -- coincidieron con un título existente (TMDb/IMDb)
  unchanged INTEGER NOT NULL DEFAULT 0,        -- ya estaban iguales (no se escribieron)
  conflicts INTEGER NOT NULL DEFAULT 0,        -- posibles duplicados que no se pudieron unir solos
  skipped INTEGER NOT NULL DEFAULT 0,
  episodes INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_run_at INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  trigger TEXT NOT NULL DEFAULT 'manual',      -- 'manual' | 'cron'
  created_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS sync_jobs_pending ON sync_jobs (status, next_run_at);
CREATE INDEX IF NOT EXISTS sync_jobs_provider ON sync_jobs (provider_id, created_at);

-- Registro técnico (sin secretos: todo mensaje pasa por redact antes de guardarse).
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  scope TEXT NOT NULL,
  provider_id TEXT,
  job_id INTEGER,
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS logs_at ON logs (at);

-- Auditoría de acciones administrativas (quién, qué, sobre qué; nunca valores secretos).
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS audit_at ON audit (at);

-- Búsqueda por texto (FTS5): evita recorrer toda la tabla en cada búsqueda.
-- Se mantiene sola con estos disparadores (solo cuando cambia el título normalizado).
CREATE VIRTUAL TABLE IF NOT EXISTS titles_fts USING fts5 (title_norm, content = 'titles', content_rowid = 'id');
CREATE TRIGGER IF NOT EXISTS titles_fts_insert AFTER INSERT ON titles BEGIN
  INSERT INTO titles_fts (rowid, title_norm) VALUES (new.id, new.title_norm);
END;
CREATE TRIGGER IF NOT EXISTS titles_fts_update AFTER UPDATE OF title_norm ON titles BEGIN
  INSERT INTO titles_fts (titles_fts, rowid, title_norm) VALUES ('delete', old.id, old.title_norm);
  INSERT INTO titles_fts (rowid, title_norm) VALUES (new.id, new.title_norm);
END;
CREATE TRIGGER IF NOT EXISTS titles_fts_delete AFTER DELETE ON titles BEGIN
  INSERT INTO titles_fts (titles_fts, rowid, title_norm) VALUES ('delete', old.id, old.title_norm);
END;
