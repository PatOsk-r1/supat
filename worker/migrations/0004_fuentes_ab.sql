-- Dos fuentes de contenido (Fuente A y Fuente B): importaciones que se pueden pausar y reanudar.
ALTER TABLE sync_jobs ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;
