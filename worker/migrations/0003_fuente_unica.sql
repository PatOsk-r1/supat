-- Fuente de contenido única (Ajustes → Fuentes de contenido): estado de la última prueba de conexión.
ALTER TABLE providers ADD COLUMN last_test_at INTEGER;
ALTER TABLE providers ADD COLUMN last_test_ok INTEGER;
ALTER TABLE providers ADD COLUMN last_test_message TEXT NOT NULL DEFAULT '';

-- Ejecuciones de un trabajo que se cortaron sin guardar avance (límite de CPU o de tiempo).
ALTER TABLE sync_jobs ADD COLUMN stalls INTEGER NOT NULL DEFAULT 0;
