// Conexión con Firebase (cuentas y base de datos).
// Esta configuración web es PÚBLICA por diseño: identifica el proyecto, no da permisos.
// La seguridad la aplican las reglas de Firestore (firestore.rules) en los servidores de Google.
export const firebaseConfig = {
  apiKey: "AIzaSyAVTxXEH6iuEENs85qLile3PDpqE8kCchw",
  authDomain: "supat-h8tfw.firebaseapp.com",
  projectId: "supat-h8tfw",
  storageBucket: "supat-h8tfw.firebasestorage.app",
  messagingSenderId: "181370768876",
  appId: "1:181370768876:web:de98d0bb59eb10355e84c9"
};

// Con "npm run dev:emu" (modo "emulador", solo en desarrollo) la app usa los emuladores locales,
// para probar con cuentas de prueba sin tocar el proyecto real.
const useEmulator = import.meta.env?.MODE === "emulador";

let services = null;

// Carga Firebase la primera vez que se necesita (queda en un archivo aparte).
export function getFirebase() {
  services ??= (async () => {
    const [{ initializeApp }, A, F] = await Promise.all([
      import("firebase/app"), import("firebase/auth"), import("firebase/firestore")
    ]);
    const app = initializeApp(useEmulator ? { ...firebaseConfig, projectId: "demo-supat" } : firebaseConfig);
    // La sesión se guarda en IndexedDB (nunca en localStorage); si no está disponible, solo en memoria.
    const auth = A.initializeAuth(app, { persistence: [A.indexedDBLocalPersistence, A.inMemoryPersistence] });
    auth.languageCode = "es";
    const db = F.getFirestore(app);
    if (useEmulator) {
      A.connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
      F.connectFirestoreEmulator(db, "127.0.0.1", 8080);
    }
    return { auth, db, A, F };
  })();
  return services;
}
