// Punto único de acceso al catálogo. La interfaz solo habla con este archivo,
// así que sumar o cambiar fuentes no obliga a tocar main.js.
import { demoProvider } from "./demo-provider.js";

// Lista de proveedores activos. Para agregar uno autorizado: importarlo y sumarlo acá.
const providers = [demoProvider];

export const KINDS = {
  live: { label: "TV en vivo", mark: "EN VIVO" },
  movie: { label: "Película", mark: "PELÍCULA" },
  series: { label: "Serie", mark: "SERIE" }
};

// Convierte un elemento crudo en uno con forma conocida, o null si es inválido.
function normalize(raw, provider) {
  if (!raw || raw.id == null || !raw.title || !KINDS[raw.kind]) return null;
  const url = raw.source && typeof raw.source.url === "string" ? raw.source.url.trim() : "";
  return {
    id: `${provider.name}:${raw.id}`,
    kind: raw.kind,
    title: String(raw.title),
    category: raw.category ? String(raw.category) : "Sin categoría",
    year: raw.year || null,
    description: raw.description ? String(raw.description) : "",
    image: raw.image || "",
    color: raw.color || "poster-a",
    featured: Boolean(raw.featured),
    source: url ? { url, type: raw.source.type || "" } : null,
    provider: provider.name,
    isDemo: Boolean(provider.isDemo)
  };
}

// Carga todos los proveedores. Si uno falla, los demás siguen funcionando
// y el error se informa en la interfaz.
export async function loadCatalog() {
  const results = await Promise.allSettled(providers.map(p => p.load()));
  const items = [];
  const errors = [];
  results.forEach((result, i) => {
    const provider = providers[i];
    if (result.status === "rejected" || !Array.isArray(result.value)) {
      errors.push(`No se pudo cargar la fuente "${provider.label}".`);
      return;
    }
    for (const raw of result.value) {
      const item = normalize(raw, provider);
      if (item) items.push(item);
    }
  });
  return { items, errors };
}
