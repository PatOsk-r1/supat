-- Los administradores de Firebase (colección admins/ de Firestore, que solo se edita desde la
-- consola) también son propietarios del catálogo central. Copia del dato, revisada cada 5 minutos.
ALTER TABLE users ADD COLUMN fs_admin INTEGER NOT NULL DEFAULT 0;
