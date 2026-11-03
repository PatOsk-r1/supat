// Proveedor de demostración: entrega los datos ficticios de demo-data.js.
// Un proveedor es un objeto con un nombre y una función load() que devuelve
// (o promete) una lista de elementos con los campos descritos en demo-data.js.
// Un proveedor real podría leer un JSON propio o una API autorizada dentro de load().
import { demoItems } from "./demo-data.js";

export const demoProvider = {
  name: "demo",
  label: "Demostración",
  isDemo: true,
  load: async () => demoItems
};
