// Genera una clave de cifrado nueva para SECRETS_KEY (32 bytes al azar, en base64).
// Uso: npm run api:clave  → copiar el valor en "wrangler secret put SECRETS_KEY" (o en worker/.dev.vars).
// No la guardes en el repositorio: quien la tenga puede descifrar las credenciales de los proveedores.
import { randomBytes } from "node:crypto";
console.log(randomBytes(32).toString("base64"));
