// Crea (o reutiliza) la cuenta de PROPIETARIO de prueba en el emulador local de Firebase Auth,
// para entrar a la app local (npm run dev:emu) y cargar la fuente en Ajustes.
// Solo funciona con los emuladores (npm run emuladores): no toca cuentas reales.
// worker/.dev.vars tiene que incluir OWNER_UIDS="e2e-dueno".
// SUPAT_EMU_AUTH: otro emulador (por ejemplo http://127.0.0.1:9199 con firebase.emu-alt.json).
const AUTH = `${process.env.SUPAT_EMU_AUTH || "http://127.0.0.1:9099"}/identitytoolkit.googleapis.com/v1`;
const EMAIL = "dueno@prueba.test";
const PASSWORD = "clave-de-prueba-1234"; // contraseña de prueba del emulador local

async function post(path, body, headers = {}) {
  const res = await fetch(AUTH + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { ok: res.ok, data: await res.json() };
}

try {
  await post("/projects/demo-supat/accounts", { localId: "e2e-dueno", email: EMAIL, password: PASSWORD }, { Authorization: "Bearer owner" });
  const v = await post("/projects/demo-supat/accounts:update", { localId: "e2e-dueno", emailVerified: true }, { Authorization: "Bearer owner" });
  if (!v.ok) throw new Error(JSON.stringify(v.data));
  console.log(`Cuenta de propietario lista en el emulador: ${EMAIL} / ${PASSWORD}`);
} catch (err) {
  console.error("No se pudo crear la cuenta. ¿Están corriendo los emuladores (npm run emuladores)?", err.message);
  process.exitCode = 1;
}
