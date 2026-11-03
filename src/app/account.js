// Cuenta del usuario: registro, sesión, perfil y eliminación, sobre Firebase Auth + Firestore.
// La seguridad real está en firestore.rules; acá solo se usa la sesión que da Firebase.
// Los mensajes nunca revelan si un correo está registrado.
import { getFirebase } from "./firebase.js";

const listeners = new Set();
const state = { ready: false, user: null, profile: null, isAdmin: false };

function emit() { listeners.forEach(fn => fn(account)); }

// Mensajes claros y genéricos para los errores de Firebase.
const GENERIC = "No se pudo completar la operación. Probá de nuevo en unos minutos.";
export function messageFor(err) {
  const code = err?.code || "";
  if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-email", "auth/invalid-login-credentials"].includes(code)) return "Correo o contraseña incorrectos.";
  if (code === "auth/too-many-requests") return "Demasiados intentos. Esperá unos minutos antes de volver a probar.";
  if (code === "auth/user-disabled") return "Esta cuenta está deshabilitada.";
  if (code === "auth/email-already-in-use") return "No se pudo crear la cuenta con esos datos. Si ya tenés una, iniciá sesión o recuperá la contraseña.";
  if (code === "auth/weak-password") return "La contraseña es demasiado débil.";
  if (code === "auth/requires-recent-login") return "Por seguridad, volvé a escribir tu contraseña.";
  if (code === "auth/network-request-failed") return "No hay conexión con el servidor. Revisá tu internet.";
  if (code === "permission-denied") return "No tenés permiso para hacer esto. Si cerraste todas las sesiones, volvé a iniciar sesión.";
  return GENERIC;
}

// Reglas propias para contraseñas (Firebase pide solo 6 caracteres).
export function passwordProblems(password, email = "") {
  const p = String(password);
  const problems = [];
  if (p.length < 10) problems.push("Usá al menos 10 caracteres.");
  if (p.length > 128) problems.push("Usá como máximo 128 caracteres.");
  if (/^(.)\1+$/.test(p) || /^(0123456789|1234567890|qwertyuiop|contraseña|password)/i.test(p)) problems.push("Elegí una contraseña menos predecible.");
  if (email && p.toLowerCase().includes(email.split("@")[0].toLowerCase()) && email.split("@")[0].length >= 4) problems.push("No uses tu correo dentro de la contraseña.");
  return problems;
}

export const validName = name => {
  const n = String(name || "").trim();
  return n.length >= 1 && n.length <= 40 ? n : null;
};

async function loadProfile(fb, user) {
  const { F, db } = fb;
  const ref = F.doc(db, "users", user.uid);
  let snap = await F.getDoc(ref);
  if (!snap.exists()) {
    // Perfil que faltaba (por ejemplo, si el registro se cortó a la mitad).
    await F.setDoc(ref, { displayName: user.email.split("@")[0].slice(0, 40), createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp(), suspended: false, revokedAt: new F.Timestamp(0, 0) });
    snap = await F.getDoc(ref);
  }
  const admin = await F.getDoc(F.doc(db, "admins", user.uid)).catch(() => null);
  return { profile: snap.data(), isAdmin: Boolean(admin?.exists()) };
}

export const account = {
  get ready() { return state.ready; },
  get user() { return state.user; },
  get profile() { return state.profile; },
  get isAdmin() { return state.isAdmin; },
  get signedIn() { return Boolean(state.user); },
  get verified() { return Boolean(state.user?.emailVerified); },
  get suspended() { return Boolean(state.profile?.suspended); },
  get name() { return state.profile?.displayName || state.user?.email?.split("@")[0] || ""; },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  // Arranca: escucha los cambios de sesión de Firebase.
  async start() {
    const fb = await getFirebase();
    fb.A.onAuthStateChanged(fb.auth, async user => {
      state.user = user ? { uid: user.uid, email: user.email, emailVerified: user.emailVerified } : null;
      state.profile = null;
      state.isAdmin = false;
      if (user) {
        try { Object.assign(state, await loadProfile(fb, user)); }
        catch (err) { state.error = messageFor(err); }
      }
      state.ready = true;
      emit();
    });
  },

  async register(email, password, name) {
    const problems = passwordProblems(password, email);
    if (problems.length) throw new Error(problems.join(" "));
    const displayName = validName(name);
    if (!displayName) throw new Error("Escribí un nombre de hasta 40 caracteres.");
    const fb = await getFirebase();
    try {
      const { user } = await fb.A.createUserWithEmailAndPassword(fb.auth, email.trim(), password);
      await fb.F.setDoc(fb.F.doc(fb.db, "users", user.uid), {
        displayName, createdAt: fb.F.serverTimestamp(), updatedAt: fb.F.serverTimestamp(), suspended: false, revokedAt: new fb.F.Timestamp(0, 0)
      });
      await fb.A.sendEmailVerification(user);
      Object.assign(state, await loadProfile(fb, user));
      emit();
    } catch (err) {
      throw new Error(messageFor(err));
    }
  },

  async login(email, password) {
    const fb = await getFirebase();
    try { await fb.A.signInWithEmailAndPassword(fb.auth, email.trim(), password); }
    catch (err) { throw new Error(messageFor(err)); }
  },

  async logout() {
    const fb = await getFirebase();
    await fb.A.signOut(fb.auth);
  },

  // Siempre el mismo mensaje, exista o no la cuenta.
  async resetPassword(email) {
    const fb = await getFirebase();
    try { await fb.A.sendPasswordResetEmail(fb.auth, email.trim()); }
    catch (err) { if (err?.code === "auth/too-many-requests" || err?.code === "auth/network-request-failed") throw new Error(messageFor(err)); }
    return "Si existe una cuenta con ese correo, te enviamos un enlace para crear una contraseña nueva. Revisá también la carpeta de spam.";
  },

  async resendVerification() {
    const fb = await getFirebase();
    try { await fb.A.sendEmailVerification(fb.auth.currentUser); }
    catch (err) { throw new Error(messageFor(err)); }
  },

  // Después de tocar el enlace del correo: actualiza el estado y el permiso de escritura.
  async refreshVerification() {
    const fb = await getFirebase();
    const u = fb.auth.currentUser;
    if (!u) return false;
    await u.reload();
    await u.getIdToken(true);
    state.user = { uid: u.uid, email: u.email, emailVerified: u.emailVerified };
    emit();
    return u.emailVerified;
  },

  async reauthenticate(password) {
    const fb = await getFirebase();
    const u = fb.auth.currentUser;
    try { await fb.A.reauthenticateWithCredential(u, fb.A.EmailAuthProvider.credential(u.email, password)); }
    catch (err) { throw new Error(messageFor(err)); }
  },

  // Cambiar la contraseña. Firebase cierra las demás sesiones automáticamente.
  async changePassword(current, next) {
    const problems = passwordProblems(next, state.user?.email);
    if (problems.length) throw new Error(problems.join(" "));
    await account.reauthenticate(current);
    const fb = await getFirebase();
    try { await fb.A.updatePassword(fb.auth.currentUser, next); }
    catch (err) { throw new Error(messageFor(err)); }
  },

  async updateName(name) {
    const displayName = validName(name);
    if (!displayName) throw new Error("Escribí un nombre de hasta 40 caracteres.");
    const fb = await getFirebase();
    try {
      await fb.F.updateDoc(fb.F.doc(fb.db, "users", state.user.uid), { displayName, updatedAt: fb.F.serverTimestamp() });
      state.profile = { ...state.profile, displayName };
      emit();
    } catch (err) { throw new Error(messageFor(err)); }
  },

  // Invalida TODAS las sesiones (también esta): las reglas rechazan las iniciadas antes de ahora.
  async logoutEverywhere() {
    const fb = await getFirebase();
    try { await fb.F.updateDoc(fb.F.doc(fb.db, "users", state.user.uid), { revokedAt: fb.F.serverTimestamp(), updatedAt: fb.F.serverTimestamp() }); }
    catch (err) { throw new Error(messageFor(err)); }
    await fb.A.signOut(fb.auth);
  },

  // Elimina la cuenta y todos sus datos personales. Pide la contraseña otra vez.
  async deleteAccount(password, { publicListIds = [] } = {}) {
    await account.reauthenticate(password);
    const fb = await getFirebase();
    const { F, db } = fb;
    const uid = state.user.uid;
    try {
      for (const id of publicListIds) await F.deleteDoc(F.doc(db, "publicLists", id)).catch(() => {});
      for (const name of ["favorites", "history"]) {
        const snap = await F.getDocs(F.collection(db, "users", uid, name));
        await Promise.all(snap.docs.map(d => F.deleteDoc(d.ref)));
      }
      const lists = await F.getDocs(F.collection(db, "users", uid, "lists"));
      for (const l of lists.docs) {
        const items = await F.getDocs(F.collection(l.ref, "items"));
        await Promise.all(items.docs.map(d => F.deleteDoc(d.ref)));
        await F.deleteDoc(l.ref);
      }
      await F.deleteDoc(F.doc(db, "users", uid));
      await fb.A.deleteUser(fb.auth.currentUser);
    } catch (err) {
      throw new Error(messageFor(err));
    }
  }
};
