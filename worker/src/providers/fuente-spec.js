// Especificación de la fuente de contenido, incorporada al adaptador del servidor.
//
// Cuando esté definida (no null), el servidor la usa siempre y Ajustes deja de mostrar el campo
// de "especificación": el propietario solo carga nombre, dirección base, credenciales y categorías.
// Se escribe a partir de la documentación técnica oficial de la API, con el formato del
// adaptador genérico (worker/README.md → "Adaptador genérico"). No se inventan rutas,
// parámetros ni formatos: todo lo que figure acá tiene que salir de esa documentación.
//
// Reglas:
//  - Sin nombres, marcas ni textos visibles del proveedor: lo que ve el usuario sale de Ajustes.
//  - Sin credenciales: van en Ajustes y se referencian como {apiKey} (en "auth") y
//    {playbackKey} (solo en "playbackAuth").
//  - La dirección base NO va acá: se configura en Ajustes y las rutas son relativas a ella.
const SPEC = null;

let override; // solo para las pruebas automáticas

export function builtInSpec() {
  return override !== undefined ? override : SPEC;
}

// Pruebas: reemplaza la especificación incorporada (null = ninguna; undefined = volver a la real).
export function setBuiltInSpecForTests(spec) {
  override = spec;
}
