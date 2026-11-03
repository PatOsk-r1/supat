// Pruebas de seguridad de las reglas de Firestore, contra el EMULADOR local de Firebase
// (no toca el proyecto real). Se ejecutan con:  npm run test:reglas
// Usuarios simulados: ana y beto (cuentas comunes) y admin (administrador).
import test, { before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, serverTimestamp, Timestamp, writeBatch } from "firebase/firestore";

let env;
const now = () => Math.floor(Date.now() / 1000);
// Sesión con correo verificado, iniciada "ahora".
const session = (uid, extra = {}) => env.authenticatedContext(uid, { email_verified: true, auth_time: now(), ...extra }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

const profile = name => ({ displayName: name, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), suspended: false, revokedAt: new Timestamp(0, 0) });
const fav = { itemId: "archive:his_girl_friday", kind: "movie", title: "His Girl Friday", poster: "" };
const list = (visibility = "private") => ({ name: "Clásicos", description: "", visibility, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-supat",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 }
  });
});
after(async () => env?.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  // Datos de partida, cargados sin reglas (como si ya existieran).
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    for (const [uid, name] of [["ana", "Ana"], ["beto", "Beto"], ["admin", "Admin"]]) {
      await setDoc(doc(db, "users", uid), { displayName: name, createdAt: Timestamp.now(), updatedAt: Timestamp.now(), suspended: false, revokedAt: new Timestamp(0, 0) });
    }
    await setDoc(doc(db, "admins", "admin"), { role: "admin" });
    await setDoc(doc(db, "users/beto/favorites/f1"), { ...fav, addedAt: Timestamp.now() });
    await setDoc(doc(db, "users/beto/history/h1"), { ...fav, episodeId: "", episodeLabel: "", time: 10, duration: 100, finished: false, updatedAt: Timestamp.now() });
    await setDoc(doc(db, "users/beto/lists/l1"), { name: "De Beto", description: "", visibility: "private", createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
  });
});

// 1-3. Aislamiento entre dos cuentas (IDOR/BOLA: cambiar el id en la ruta no sirve).
test("1. Ana no puede leer ni listar las listas de Beto", async () => {
  const db = session("ana");
  await assertFails(getDoc(doc(db, "users/beto/lists/l1")));
  await assertFails(getDocs(collection(db, "users/beto/lists")));
  await assertSucceeds(getDocs(collection(session("beto"), "users/beto/lists")));
});

test("2. Ana no puede crear, modificar ni borrar favoritos de Beto", async () => {
  const db = session("ana");
  await assertFails(setDoc(doc(db, "users/beto/favorites/f2"), { ...fav, addedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db, "users/beto/favorites/f1"), { title: "cambiado" }));
  await assertFails(deleteDoc(doc(db, "users/beto/favorites/f1")));
});

test("3. Ana no puede consultar el historial ni el perfil de Beto", async () => {
  const db = session("ana");
  await assertFails(getDoc(doc(db, "users/beto/history/h1")));
  await assertFails(getDocs(collection(db, "users/beto/history")));
  await assertFails(getDoc(doc(db, "users/beto")));
});

test("4. sin sesión se rechaza todo lo privado", async () => {
  const db = anon();
  await assertFails(getDoc(doc(db, "users/beto")));
  await assertFails(getDoc(doc(db, "users/beto/favorites/f1")));
  await assertFails(setDoc(doc(db, "users/nadie"), profile("Nadie")));
  await assertFails(setDoc(doc(db, "users/beto/favorites/x"), { ...fav, addedAt: serverTimestamp() }));
});

test("5. una sesión anterior a 'cerrar todas las sesiones' ya no sirve", async () => {
  const vieja = session("ana", { auth_time: now() - 3600 });
  await assertSucceeds(getDocs(collection(vieja, "users/ana/favorites")));
  // Ana cierra todas sus sesiones desde un dispositivo.
  await assertSucceeds(updateDoc(doc(session("ana"), "users/ana"), { revokedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertFails(getDocs(collection(vieja, "users/ana/favorites")));
  await assertFails(setDoc(doc(vieja, "users/ana/favorites/x"), { ...fav, addedAt: serverTimestamp() }));
  // Una sesión nueva (iniciada después) funciona.
  const nueva = session("ana", { auth_time: now() + 5 });
  await assertSucceeds(getDocs(collection(nueva, "users/ana/favorites")));
});

test("5c. una sesión iniciada hace más de 30 días vence", async () => {
  const vencida = session("ana", { auth_time: now() - 31 * 86400 });
  await assertFails(getDocs(collection(vencida, "users/ana/favorites")));
  await assertSucceeds(getDocs(collection(session("ana", { auth_time: now() - 29 * 86400 }), "users/ana/favorites")));
});

test("5b. una cuenta suspendida no puede guardar nada (solo leer y borrar lo suyo)", async () => {
  await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), "users/beto"), { suspended: true }));
  const db = session("beto");
  await assertFails(setDoc(doc(db, "users/beto/favorites/x"), { ...fav, addedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db, "users/beto/favorites/f1"), { title: "cambiado" }));
  await assertFails(setDoc(doc(db, "users/beto/lists/nueva"), list()));
  await assertFails(updateDoc(doc(db, "users/beto"), { displayName: "Otro", updatedAt: serverTimestamp() }));
  await assertSucceeds(getDocs(collection(db, "users/beto/favorites"))); // para poder eliminar la cuenta
  await assertSucceeds(getDoc(doc(db, "users/beto"))); // puede ver que está suspendida
});

test("correo sin verificar: puede crear su perfil y leer, pero no guardar datos", async () => {
  const db = env.authenticatedContext("nuevo", { email_verified: false, auth_time: now() }).firestore();
  await assertSucceeds(setDoc(doc(db, "users/nuevo"), profile("Nuevo")));
  await assertFails(setDoc(doc(db, "users/nuevo/favorites/x"), { ...fav, addedAt: serverTimestamp() }));
});

test("7. datos manipulados (campos extra, tipos o largos inválidos) se rechazan", async () => {
  const db = session("ana");
  const ref = doc(db, "users/ana/favorites/x");
  await assertSucceeds(setDoc(ref, { ...fav, addedAt: serverTimestamp() }));
  await assertFails(setDoc(ref, { ...fav, addedAt: serverTimestamp(), owner: "beto" }));
  await assertFails(setDoc(ref, { ...fav, kind: "'; DROP TABLE users; --", addedAt: serverTimestamp() }));
  await assertFails(setDoc(ref, { ...fav, title: "x".repeat(201), addedAt: serverTimestamp() }));
  await assertFails(setDoc(ref, { ...fav, addedAt: Timestamp.fromMillis(0) })); // fecha falsa
  await assertFails(setDoc(doc(db, "users/ana"), { ...profile("Ana"), displayName: "" }));
});

test("10. nadie se vuelve administrador ni se des-suspende desde el navegador", async () => {
  const db = session("ana");
  await assertFails(setDoc(doc(db, "admins/ana"), { role: "admin" }));
  await assertFails(updateDoc(doc(db, "users/ana"), { suspended: true, updatedAt: serverTimestamp() }));
  // Una cuenta suspendida no puede quitarse la suspensión.
  await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), "users/beto"), { suspended: true }));
  await assertFails(updateDoc(doc(session("beto"), "users/beto"), { suspended: false, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db, "users/ana"), { isAdmin: true, updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(db, "audit/a1"), { actor: "ana", action: "suspend", target: "beto", at: serverTimestamp(), detail: "" }));
  await assertFails(getDocs(collection(db, "audit")));
  await assertFails(getDocs(collection(db, "users"))); // no puede listar usuarios
});

test("10b. el administrador suspende solo con registro de auditoría, y no puede editarlo después", async () => {
  const db = session("admin");
  await assertSucceeds(getDoc(doc(db, "users/beto")));
  // Sin auditoría en la misma operación: rechazado.
  await assertFails(updateDoc(doc(db, "users/beto"), { suspended: true, updatedAt: serverTimestamp(), lastAudit: "nada" }));
  // Con auditoría coherente: permitido.
  const batch = writeBatch(db);
  batch.set(doc(db, "audit/a1"), { actor: "admin", action: "suspend", target: "beto", at: serverTimestamp(), detail: "soporte" });
  batch.update(doc(db, "users/beto"), { suspended: true, updatedAt: serverTimestamp(), lastAudit: "a1" });
  await assertSucceeds(batch.commit());
  // La auditoría no se puede alterar ni borrar, ni atribuir a otro.
  await assertFails(updateDoc(doc(db, "audit/a1"), { detail: "otro" }));
  await assertFails(deleteDoc(doc(db, "audit/a1")));
  await assertFails(setDoc(doc(db, "audit/a2"), { actor: "ana", action: "reactivate", target: "beto", at: serverTimestamp(), detail: "" }));
  // El administrador no puede leer los favoritos de Beto ni cambiarle el nombre.
  await assertFails(getDocs(collection(db, "users/beto/favorites")));
  await assertFails(updateDoc(doc(db, "users/beto"), { displayName: "X", updatedAt: serverTimestamp() }));
});

test("listas públicas: se leen sin sesión, solo las publica su dueño y nadie más las pisa", async () => {
  const ana = session("ana");
  const hash = async uid => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(uid)))).map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  const pub = async uid => ({ name: "Clásicos", description: "", ownerName: "Ana", ownerKey: await hash(uid), items: [], updatedAt: serverTimestamp() });
  // Con la lista privada no se puede publicar.
  await assertSucceeds(setDoc(doc(ana, "users/ana/lists/L"), list("private")));
  await assertFails(setDoc(doc(ana, "publicLists/L"), await pub("ana")));
  // Marcada como pública, sí.
  await assertSucceeds(updateDoc(doc(ana, "users/ana/lists/L"), { visibility: "public", updatedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(ana, "publicLists/L"), await pub("ana")));
  await assertSucceeds(getDoc(doc(anon(), "publicLists/L")));
  // Beto crea una lista propia con el mismo id e intenta pisar la de Ana: rechazado.
  const beto = session("beto");
  await assertSucceeds(setDoc(doc(beto, "users/beto/lists/L"), list("public")));
  await assertFails(setDoc(doc(beto, "publicLists/L"), await pub("beto")));
  await assertFails(deleteDoc(doc(beto, "publicLists/L")));
  // Y no puede hacerse pasar por Ana copiando su huella.
  await assertFails(setDoc(doc(beto, "publicLists/L"), await pub("ana")));
});

test("eliminar la cuenta: el dueño borra sus datos (aunque esté suspendido)", async () => {
  await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), "users/beto"), { suspended: true }));
  const db = session("beto");
  await assertSucceeds(deleteDoc(doc(db, "users/beto/favorites/f1")));
  await assertSucceeds(deleteDoc(doc(db, "users/beto/history/h1")));
  await assertSucceeds(deleteDoc(doc(db, "users/beto/lists/l1")));
  await assertSucceeds(deleteDoc(doc(db, "users/beto")));
});

test("colecciones no previstas están cerradas", async () => {
  await assertFails(setDoc(doc(session("ana"), "cualquier/cosa"), { a: 1 }));
  await assertFails(getDoc(doc(anon(), "cualquier/cosa")));
});
