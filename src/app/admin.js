// Operaciones de administración. Las reglas de Firestore verifican en el servidor que quien
// las pide esté en admins/ y que cada acción deje su registro de auditoría.
import { getFirebase } from "./firebase.js";
import { account } from "./account.js";

export const admin = {
  async users() {
    const { F, db } = await getFirebase();
    const snap = await F.getDocs(F.collection(db, "users"));
    return snap.docs.map(d => ({
      uid: d.id,
      displayName: d.data().displayName,
      createdAt: d.data().createdAt?.toMillis?.() || 0,
      suspended: Boolean(d.data().suspended)
    })).sort((a, b) => b.createdAt - a.createdAt);
  },

  // Suspende o reactiva una cuenta. La auditoría va en la misma operación (si falla, no se aplica nada).
  async setSuspended(uid, suspended, detail = "") {
    const { F, db } = await getFirebase();
    const batch = F.writeBatch(db);
    const log = F.doc(F.collection(db, "audit"));
    batch.set(log, { actor: account.user.uid, action: suspended ? "suspend" : "reactivate", target: uid, at: F.serverTimestamp(), detail: String(detail).slice(0, 300) });
    batch.update(F.doc(db, "users", uid), { suspended, updatedAt: F.serverTimestamp(), lastAudit: log.id });
    await batch.commit();
  },

  async publicLists() {
    const { F, db } = await getFirebase();
    const snap = await F.getDocs(F.collection(db, "publicLists"));
    return snap.docs.map(d => ({ id: d.id, name: d.data().name, ownerName: d.data().ownerName, count: (d.data().items || []).length }));
  },

  async deletePublicList(id, detail = "") {
    const { F, db } = await getFirebase();
    const batch = F.writeBatch(db);
    batch.set(F.doc(F.collection(db, "audit")), { actor: account.user.uid, action: "delete-public-list", target: id, at: F.serverTimestamp(), detail: String(detail).slice(0, 300) });
    batch.delete(F.doc(db, "publicLists", id));
    await batch.commit();
  },

  async audit(max = 50) {
    const { F, db } = await getFirebase();
    const snap = await F.getDocs(F.query(F.collection(db, "audit"), F.orderBy("at", "desc"), F.limit(max)));
    return snap.docs.map(d => ({ id: d.id, ...d.data(), at: d.data().at?.toMillis?.() || 0 }));
  }
};
