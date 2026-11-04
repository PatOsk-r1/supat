// Controlador de la interfaz: arma el marco (menú, buscador), elige la pantalla según la
// ruta, atiende los clics y mantiene el foco del teclado en su lugar.
import { escapeHtml as e } from "../app/util.js";
import { SECTIONS, parseRoute } from "../app/router.js";
import { settings } from "../app/settings.js";
import { progress } from "../app/progress.js";
import { createFavorites } from "../app/favorites.js";
import { cacheClear, cacheSet } from "../app/cache.js";
import { catalog } from "../catalog/store.js";
import * as enrich from "../catalog/enrich.js";
import { getInstance } from "../providers/registry.js";
import * as home from "./views/home.js";
import * as browse from "./views/browse.js";
import * as live from "./views/live.js";
import * as detail from "./views/detail.js";
import * as watch from "./views/watch.js";
import * as settingsView from "./views/settings.js";
import { renderFavorites, renderSearch } from "./views/lists.js";
import * as accountViews from "./views/account.js";
import * as adminView from "./views/admin.js";
import { account } from "../app/account.js";
import { userdata } from "../app/userdata.js";
import { admin } from "../app/admin.js";
import { centralAdmin } from "../app/central-admin.js";
import { TAB_DATA } from "./views/central-admin.js";
import { searchCentral } from "../providers/central.js";
import { ALL_FIELDS } from "../shared/fuente-esquema.js";

const defaultFilters = () => ({ category: "Todos", provider: "todos", sort: "destacados", limit: 0 });

export function startApp(app, extensions = {}) {
  // Favoritos y progreso de ANTES de tener cuenta (en este navegador): solo para pasarlos a la cuenta.
  const localFavorites = createFavorites();
  // Sin sesión (o sin correo verificado) no se guarda nada: el catálogo se explora igual.
  const guestFavorites = { persistent: true, has: () => false, list: () => [], size: 0, toggle: async () => false, clear: async () => {} };
  const guestProgress = { save() {}, flush() {}, get: () => null, resumeTime: () => 0, isFinished: () => false, recent: () => [], all: () => [], remove: async () => {}, clear: async () => {} };
  const state = { route: parseRoute(location.hash), query: "", filters: defaultFilters(), season: 0, confirm: null, restartRequested: false, tmdbStatus: "", formError: "", formMessage: "", busy: false,
    central: { tab: null, data: {}, loading: false, error: "", editing: null, newAdapter: "", testResult: null, logLevel: "" },
    remote: null, sources: null };
  const ctx = {
    catalog, settings, state, account, userdata, admin, ...extensions,
    get favorites() { return userdata.active ? userdata.favorites : guestFavorites; },
    get progress() { return userdata.active ? userdata.progress : guestProgress; },
    localData: { count: () => localFavorites.size + progress.recent(999).length }
  };
  let cleanup = () => {};
  let depth = 0;
  let renderQueued = false;

  // ---------- marco ----------
  const brand = `<span class="brand-icon">S</span><span class="brand-text">SU<span class="brand-light">PAT</span></span>`;
  app.innerHTML = `<a class="skip" href="#view" data-skip>Saltar al contenido</a>
  <aside class="sidebar">
    <a class="brand" href="#/inicio" aria-label="Supat, inicio">${brand}</a>
    <nav aria-label="Secciones">${SECTIONS.map(s =>
      `<a class="nav-item" href="#/${s.id}" data-nav="${s.id}"><span class="nav-icon" aria-hidden="true">${s.icon}</span><span class="nav-label">${s.label}</span></a>`).join("")}
    </nav>
  </aside>
  <div class="content">
    <header class="topbar">
      <a class="brand brand-mobile" href="#/inicio" aria-label="Supat, inicio">${brand}</a>
      <label class="search"><span aria-hidden="true">⌕</span><span class="sr-only">Buscar por nombre</span>
        <input id="search" type="search" placeholder="Buscar películas, series y canales…" autocomplete="off" aria-keyshortcuts="/"></label>
      <a class="account-link" id="account-link" href="#/cuenta">Ingresar</a>
    </header>
    <div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
    <main id="view" tabindex="-1"></main>
    <footer>SUPAT <span>Información e imágenes de TMDb</span></footer>
  </div>`;
  const view = app.querySelector("#view");
  const search = app.querySelector("#search");

  // ---------- dibujo ----------
  function pickView() {
    const { route } = state;
    if (state.query.trim()) return renderSearch(ctx);
    if (route.name === "inicio") return home.render(ctx);
    if (route.name === "favoritos") return renderFavorites(ctx);
    if (route.name === "ajustes") return settingsView.render(ctx);
    if (route.name === "titulo") return detail.render(ctx, route);
    if (route.name === "ver") return watch.render(ctx, route);
    if (route.name === "cuenta") return accountViews.renderAuth(ctx, route);
    if (route.name === "perfil") return accountViews.renderProfile(ctx);
    if (route.name === "listas") return accountViews.renderLists(ctx);
    if (route.name === "lista") return accountViews.renderListDetail(ctx, route);
    if (route.name === "historial") return accountViews.renderHistory(ctx);
    if (route.name === "publica") return accountViews.renderPublicList(ctx, route);
    if (route.name === "admin") return adminView.render(ctx);
    const section = SECTIONS.find(s => s.id === route.name);
    return section.kind === "live" ? live.render(ctx, section) : browse.render(ctx, section);
  }

  function render({ focusHeading = false } = {}) {
    const focusKey = view.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    cleanup();
    cleanup = () => {};

    // Las secciones de un tipo sin títulos importados no se muestran (no hay contenido de relleno).
    const kinds = new Set(catalog.all().map(x => x.kind));
    const loadedOnce = !catalog.loading || kinds.size;
    app.querySelectorAll("[data-nav]").forEach(a => {
      const section = SECTIONS.find(s => s.id === a.dataset.nav);
      a.hidden = Boolean(section?.kind && loadedOnce && kinds.size && !kinds.has(section.kind) && state.route.name !== section.id);
      const current = a.dataset.nav === state.route.name && !state.query;
      a.classList.toggle("active", current);
      current ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current");
    });

    const loadingFirst = catalog.loading && !catalog.all().length;
    const result = loadingFirst && state.route.name !== "ajustes"
      ? { title: "Cargando", html: `<div class="empty" role="status"><div class="xp-spinner"></div>Cargando catálogo…</div>` }
      : pickView();
    view.innerHTML = result.html;
    document.title = `${result.title} · Supat`;
    if (result.mount) cleanup = result.mount(view, ctx) || (() => {});

    const again = focusKey && view.querySelector(`[data-key="${CSS.escape(focusKey)}"]`);
    if (again) again.focus({ preventScroll: true });
    else if (focusHeading) (view.querySelector("h1") || view).focus({ preventScroll: true });
  }
  ctx.render = render;

  // ---------- catálogo central: datos del panel del propietario ----------
  const centralLoaders = {
    providers: () => centralAdmin.providers(),
    jobs: () => centralAdmin.jobs(),
    users: () => centralAdmin.users(),
    logs: () => centralAdmin.logs({ level: state.central.logLevel }),
    audit: () => centralAdmin.audit(),
    stats: () => centralAdmin.stats()
  };
  // Carga lo que necesita la pestaña (solo lo que falta, o todo con force).
  ctx.loadCentral = async (tab, { force = false } = {}) => {
    const c = state.central;
    c.tab = tab;
    const need = (TAB_DATA[tab] || []).filter(k => force || !(k in c.data));
    if (!need.length || c.loading) return;
    c.loading = true; c.error = "";
    if (!force) render();
    try {
      const values = await Promise.all(need.map(k => centralLoaders[k]()));
      need.forEach((k, i) => { c.data[k] = values[i]; });
    } catch (err) {
      c.error = err?.message || "No se pudo cargar el panel del catálogo central.";
    } finally {
      c.loading = false;
      render();
    }
  };
  const reloadCentral = () => ctx.loadCentral(state.central.tab, { force: true });

  // Fuente A y Fuente B (solo propietario; nunca trae credenciales).
  ctx.loadSources = async ({ quiet = false } = {}) => {
    const prev = state.sources;
    if (prev?.loading) return;
    state.sources = { results: {}, errors: {}, ...prev, loading: true };
    if (!quiet) render();
    try {
      const { sources } = await centralAdmin.sources();
      state.sources = { ...state.sources, data: sources, loading: false, error: "" };
    } catch (err) {
      state.sources = { ...state.sources, loading: false, error: err?.message || "No se pudieron cargar las fuentes." };
    }
    if (state.route.name === "ajustes" && !state.busy) render();
  };
  const setSlot = (slot, source) => { state.sources = { ...state.sources, data: { ...state.sources.data, [slot]: source } }; };
  const setResult = (slot, kind, value) => {
    const results = { ...(state.sources.results || {}) };
    results[slot] = { ...(results[slot] || {}), [kind]: value };
    state.sources = { ...state.sources, results };
  };
  const refreshCatalog = () => { catalog.forgetThrottle("central"); catalog.load({ only: "central", force: true }).then(render); };

  // Redibuja como mucho una vez por cuadro. En la pantalla de reproducción no se redibuja
  // por cambios de catálogo, para no cortar el video.
  function queueRender() {
    if (renderQueued || (view.querySelector(".xp") && !state.query)) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; render(); });
  }
  catalog.subscribe(queueRender);
  ctx.queueRender = queueRender;

  // ---------- TMDb ----------
  ctx.enrichment = enrich.enrichment;
  ctx.enrichSeason = enrich.enrichSeason;
  ctx.testTmdb = async () => {
    const result = await enrich.checkKey();
    enrich.enrichInBackground(catalog.all(), queueRender);
    return result;
  };
  ctx.requestEnrichment = item => enrich.request(item, done => {
    if (state.route.name === "titulo" && state.route.id === done.id && !state.query) render();
  });

  // ---------- acciones ----------
  const toastBox = app.querySelector("#toast");
  function toast(text, ms = 4500) {
    toastBox.textContent = text;
    toastBox.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { toastBox.hidden = true; }, ms);
  }

  // Para guardar hace falta sesión con correo verificado. Devuelve true si se puede seguir.
  function requireAccount(reason) {
    if (!account.signedIn) { state.authReason = reason; location.hash = "#/cuenta"; return false; }
    if (account.suspended) { toast("Tu cuenta está suspendida."); return false; }
    if (!account.verified) { toast("Verificá tu correo para poder guardar. Te lo explicamos en tu perfil."); return false; }
    return userdata.active;
  }

  async function toggleFavorite(id) {
    if (!requireAccount("Iniciá sesión para guardar favoritos.")) return;
    const item = catalog.get(id);
    if (!item) return;
    let on;
    try { on = await userdata.favorites.toggle(item); }
    catch { toast("No se pudo guardar el favorito. Probá de nuevo."); return; }
    if (["favoritos", "inicio"].includes(state.route.name) && !state.query) { render(); return; }
    // En el resto de las pantallas se actualizan los botones en su lugar (sin cortar el video).
    app.querySelectorAll(`[data-action="fav"][data-id="${CSS.escape(id)}"]`).forEach(b => {
      b.classList.toggle("selected", on);
      b.textContent = on ? "♥" : "♡";
      b.setAttribute("aria-pressed", on);
      b.setAttribute("aria-label", `${on ? "Quitar de" : "Agregar a"} favoritos: ${b.getAttribute("aria-label").split(": ").slice(1).join(": ")}`);
    });
  }

  async function clearData(what) {
    if (what === "cache" || what === "all") await cacheClear();
    if (what === "progress" || what === "all") { progress.clear(); await ctx.progress.clear(); }
    if (what === "favorites" || what === "all") { localFavorites.clear(); await ctx.favorites.clear(); }
    if (what === "all") { settings.reset(); location.hash = "#/inicio"; location.reload(); return; }
    if (what === "cache") await catalog.load({ force: true });
    render();
  }

  const clickActions = {
    fav: el => toggleFavorite(el.dataset.id),
    filter: el => { state.filters[el.dataset.name] = el.dataset.value; state.filters.limit = 0; render(); },
    more: () => { state.filters.limit = (state.filters.limit || 60) + 60; render(); },
    "clear-search": () => { search.value = ""; state.query = ""; render({ focusHeading: true }); search.focus(); },
    back: (el, ev) => { ev.preventDefault(); (history.state?.depth ?? 0) > 0 ? history.back() : (location.hash = "#/inicio"); },
    "scroll-row": el => {
      const track = el.closest(".row").querySelector(".row-track");
      track.scrollBy({ left: Number(el.dataset.dir) * track.clientWidth * 0.85, behavior: "smooth" });
    },
    season: el => { state.season = Number(el.dataset.index); render(); },
    source: el => { state.sourceIndex = Number(el.dataset.index); render(); },
    "play-restart": () => { state.restartRequested = true; },
    // En PC el canal se reproduce en la vista previa; en el celular abre la pantalla de reproducción.
    "live-select": (el, ev) => {
      if (window.matchMedia("(max-width: 720px)").matches) return;
      ev.preventDefault();
      state.liveSelected = el.dataset.id;
      render();
    },
    "data-clear": el => {
      const what = el.dataset.what;
      if (state.confirm !== what) { state.confirm = what; render(); return; }
      state.confirm = null;
      clearData(what);
    },
    "tmdb-remove": () => { settings.set("tmdbKey", ""); state.tmdbStatus = "Clave quitada."; render(); },

    // ---------- cuenta ----------
    logout: () => run(() => account.logout(), { after: () => { location.hash = "#/inicio"; } }),
    "logout-all": () => confirmThen("logout-all", () => run(() => account.logoutEverywhere(), { after: () => { state.authReason = "Cerraste todas las sesiones. Volvé a ingresar."; location.hash = "#/cuenta"; } })),
    "verify-check": () => run(async () => {
      if (!(await account.refreshVerification())) throw new Error("Todavía no figura verificado. Tocá el enlace del correo y probá de nuevo.");
    }, { ok: "¡Listo! Tu correo está verificado." }),
    "verify-resend": () => run(() => account.resendVerification(), { ok: "Te reenviamos el correo de verificación." }),
    "import-local": () => run(async () => {
      for (const id of localFavorites.list()) { const item = catalog.get(id); if (item && !userdata.favorites.has(id)) await userdata.favorites.toggle(item); }
      for (const p of progress.recent(999)) {
        const item = catalog.get(p.itemId || p.id);
        if (item) userdata.progress.save(p.id, p.time, p.duration, { ...p, kind: item.kind, poster: item.poster });
      }
      userdata.progress.flush();
      localFavorites.clear();
      progress.clear();
    }, { ok: "Pasamos tus favoritos y lo que estabas viendo a tu cuenta." }),
    "list-delete": el => confirmThen(`list-del:${el.dataset.id}`, () => run(() => userdata.lists.remove(el.dataset.id), { after: () => { location.hash = "#/listas"; } })),
    "list-remove-item": el => run(async () => {
      await userdata.lists.removeItem(el.dataset.id, el.dataset.item);
      state.listItems = { ...state.listItems, [el.dataset.id]: await userdata.lists.items(el.dataset.id) };
    }),
    "history-remove": el => run(() => userdata.progress.remove(el.dataset.id)),
    "history-clear": () => confirmThen("history-clear", () => run(() => userdata.progress.clear(), { ok: "Historial borrado." })),

    // ---------- administración ----------
    "admin-suspend": el => {
      const suspend = el.dataset.suspend === "true";
      confirmThen(`${suspend ? "suspend" : "reactivate"}:${el.dataset.uid}`, () => run(async () => {
        await admin.setSuspended(el.dataset.uid, suspend, "Desde el panel");
        state.admin = null; // se vuelve a cargar
      }));
    },
    "admin-delete-list": el => confirmThen(`pub:${el.dataset.id}`, () => run(async () => {
      await admin.deletePublicList(el.dataset.id, "Moderación");
      state.admin = null;
    })),

    // ---------- catálogo central (propietario) ----------
    "admin-tab": el => { state.adminTab = el.dataset.tab; state.formError = ""; state.formMessage = ""; state.central.editing = null; render(); },
    // ---------- fuentes de contenido (Ajustes, propietario) ----------
    "src-act": el => {
      const { slot, act } = el.dataset;
      const kindOf = attr => app.querySelector(`[${attr}="${slot}"]`)?.value;
      const job = j => (j.status === "done" ? "terminada" : j.status === "failed" ? `falló (${j.lastError})` : "en curso; sigue sola cada minuto");
      const tasks = {
        "test-connection": async () => { setResult(slot, "connection", await centralAdmin.sourceAction(slot, "test-connection")); await ctx.loadSources({ quiet: true }); },
        "test-catalog": async () => setResult(slot, "catalog", await centralAdmin.sourceAction(slot, "test-catalog", { kind: kindOf("data-src-kind") })),
        "test-playback": async () => setResult(slot, "playback", await centralAdmin.sourceAction(slot, "test-playback", { kind: kindOf("data-src-play") })),
        enable: async () => { setSlot(slot, (await centralAdmin.sourceAction(slot, "enable", { enabled: true })).source); state.formMessage = "Fuente activada."; refreshCatalog(); },
        disable: async () => { setSlot(slot, (await centralAdmin.sourceAction(slot, "enable", { enabled: false })).source); state.formMessage = "Fuente desactivada: sus títulos dejan de mostrarse (no se borran)."; refreshCatalog(); },
        import: async () => { const r = await centralAdmin.sourceAction(slot, "import", { mode: "full" }); state.formMessage = `Importación #${r.job.id}: ${job(r.job)}.`; await ctx.loadSources({ quiet: true }); },
        "import-incremental": async () => { const r = await centralAdmin.sourceAction(slot, "import", { mode: "incremental" }); state.formMessage = `Sincronización #${r.job.id}: ${job(r.job)}.`; await ctx.loadSources({ quiet: true }); },
        pause: async () => { setSlot(slot, (await centralAdmin.sourceAction(slot, "pause")).source); state.formMessage = "Importación en pausa. Lo importado se conserva."; },
        resume: async () => { setSlot(slot, (await centralAdmin.sourceAction(slot, "resume")).source); state.formMessage = "Importación reanudada."; },
        restart: async () => { setSlot(slot, (await centralAdmin.sourceAction(slot, "restart", { confirm: true })).source); state.formMessage = "Importación reiniciada desde la primera página. Lo importado se conserva."; },
        errors: async () => { const { errors } = await centralAdmin.sourceErrors(slot); state.sources = { ...state.sources, errors: { ...(state.sources.errors || {}), [slot]: errors } }; }
      };
      if (!tasks[act]) return;
      if (act === "restart") confirmThen(`src-restart:${slot}`, () => run(tasks.restart));
      else run(tasks[act]);
    },
    "central-continue": el => run(async () => {
      const { job } = await centralAdmin.continueJob(el.dataset.id);
      state.formMessage = `Trabajo #${job.id}: ${job.status === "done" ? "terminado" : `${job.pages} páginas procesadas hasta ahora`}.`;
      await reloadCentral();
    }),
    "central-cancel": el => confirmThen(`ccancel:${el.dataset.id}`, () => run(async () => { await centralAdmin.cancelJob(el.dataset.id); await reloadCentral(); }, { ok: "Trabajo cancelado. Lo importado hasta ahora se conserva." })),
    "central-role": el => confirmThen(`crole:${el.dataset.uid}`, () => run(async () => { await centralAdmin.updateUser(el.dataset.uid, { role: el.dataset.role }); await reloadCentral(); }, { ok: "Permisos actualizados." })),
    "central-block": el => confirmThen(`cblock:${el.dataset.uid}`, () => run(async () => { await centralAdmin.updateUser(el.dataset.uid, { blocked: el.dataset.blocked === "true" }); await reloadCentral(); }, { ok: "Acceso actualizado." })),
    "central-logs-older": el => run(async () => {
      const older = await centralAdmin.logs({ level: state.central.logLevel, before: el.dataset.before });
      state.central.data.logs = [...state.central.data.logs, ...older];
    }),
    "central-reindex": () => run(async () => { await centralAdmin.reindex(); await reloadCentral(); }, { ok: "Índice de búsqueda reconstruido." }),
    "remote-more": () => remoteSearch(state.remote?.q, (state.remote?.page || 1) + 1)
  };

  // Tarjeta de una fuente → { form, secrets, clearSecrets }. Las credenciales vacías no se mandan (se conservan).
  function sourceSlotBody(formEl) {
    const form = {}, secrets = {}, clearSecrets = [];
    for (const f of ALL_FIELDS) {
      if (f.type === "secret" || f.type === "secretkv") {
        const v = formEl.elements[`secret:${f.key}`]?.value || "";
        if (v.trim()) secrets[f.key] = f.type === "secret" ? v.trim() : v;
        if (formEl.elements[`clear:${f.key}`]?.checked) clearSecrets.push(f.key);
      } else if (f.type === "check") {
        form[f.key] = Boolean(formEl.elements[f.key]?.checked);
      } else {
        form[f.key] = formEl.elements[f.key]?.value ?? "";
      }
    }
    return { form, secrets, clearSecrets };
  }

  // Ejecuta una operación de cuenta mostrando "ocupado", y después el mensaje o el error.
  async function run(fn, { ok = "", after = null } = {}) {
    state.busy = true; state.formError = ""; state.formMessage = "";
    render();
    try {
      await fn();
      if (ok) state.formMessage = ok;
      after?.();
    } catch (err) {
      state.formError = err?.message || "No se pudo completar la operación.";
    } finally {
      state.busy = false;
      render();
    }
  }

  // Acciones irreversibles: el primer toque pide confirmación, el segundo ejecuta.
  function confirmThen(key, fn) {
    if (state.confirm !== key) { state.confirm = key; render(); return; }
    state.confirm = null;
    fn();
  }
  const CONFIRM_ACTIONS = ["provider-remove", "data-clear", "logout-all", "list-delete", "history-clear", "admin-suspend", "admin-delete-list", "src-act", "central-cancel", "central-role", "central-block"];

  app.addEventListener("click", ev => {
    const el = ev.target.closest("[data-action]");
    const action = el?.dataset.action;
    // Cualquier otro clic cancela una confirmación pendiente ("¿Seguro? Tocá de nuevo").
    if (state.confirm && !CONFIRM_ACTIONS.includes(action)) { state.confirm = null; render(); }
    if (el?.dataset.skip !== undefined && ev.target.closest("[data-skip]")) { ev.preventDefault(); view.focus(); return; }
    if (action && clickActions[action] && el.type !== "checkbox" && el.tagName !== "SELECT" && el.type !== "file") clickActions[action](el, ev);
  });

  app.addEventListener("change", async ev => {
    const el = ev.target;
    if (el.dataset.action === "central-log-level") { state.central.logLevel = el.value; delete state.central.data.logs; ctx.loadCentral("registros"); return; }
    if (el.dataset.action === "filter-select") { state.filters[el.dataset.name] = el.value; state.filters.limit = 0; render(); return; }
    if (el.dataset.setting) { settings.set(el.dataset.setting, el.type === "checkbox" ? el.checked : el.value); return; }
  });

  app.addEventListener("submit", async ev => {
    const form = ev.target;
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    if (form.dataset.form === "source-slot") {
      const slot = form.dataset.slot;
      run(async () => {
        const { source } = await centralAdmin.saveSource(slot, sourceSlotBody(form));
        setSlot(slot, source);
        state.formMessage = source.missingToActivate.length
          ? `Configuración guardada. Para activar e importar todavía falta: ${source.missingToActivate.join(", ")}.`
          : "Configuración guardada.";
      });
    } else if (form.dataset.form === "tmdb") {
      settings.set("tmdbKey", (data.tmdbKey || "").trim());
      settings.set("language", data.language);
      settings.set("region", data.region);
      state.tmdbStatus = data.tmdbKey ? "Probando la clave…" : "Sin clave: no se completarán imágenes ni información.";
      render();
      if (data.tmdbKey && ctx.testTmdb) {
        state.tmdbStatus = await ctx.testTmdb();
        render();
      } else if (data.tmdbKey) {
        state.tmdbStatus = "Clave guardada.";
        render();
      }
    } else if (form.dataset.form === "login") {
      run(() => account.login(data.email || "", data.password || ""), { after: () => { state.authReason = ""; location.hash = "#/perfil"; } });
    } else if (form.dataset.form === "register") {
      run(() => account.register(data.email || "", data.password || "", data.name || ""), { after: () => { location.hash = "#/perfil"; } });
    } else if (form.dataset.form === "reset") {
      let text = "";
      run(async () => { text = await account.resetPassword(data.email || ""); }, { after: () => { state.formMessage = text; } });
    } else if (form.dataset.form === "profile-name") {
      run(() => account.updateName(data.name), { ok: "Nombre actualizado." });
    } else if (form.dataset.form === "password") {
      run(() => account.changePassword(data.current || "", data.next || ""), { ok: "Contraseña cambiada. Tus otras sesiones se cerraron.", after: () => form.reset() });
    } else if (form.dataset.form === "delete-account") {
      run(() => account.deleteAccount(data.password || "", { publicListIds: userdata.lists.publicIds() }), {
        after: () => { state.authReason = "Tu cuenta y tus datos se eliminaron."; location.hash = "#/cuenta"; }
      });
    } else if (form.dataset.form === "list-create") {
      if (!requireAccount("Iniciá sesión para crear listas.")) return;
      run(async () => {
        if (!(data.name || "").trim()) throw new Error("Escribí un nombre para la lista.");
        const id = await userdata.lists.create({ name: data.name });
        location.hash = `#/lista/${encodeURIComponent(id)}`;
      });
    } else if (form.dataset.form === "list-edit") {
      run(() => {
        if (!(data.name || "").trim()) throw new Error("Escribí un nombre para la lista.");
        return userdata.lists.update(form.dataset.id, { name: data.name, description: data.description || "", visibility: data.public ? "public" : "private" });
      }, { ok: "Lista guardada." });
    } else if (form.dataset.form === "add-to-list") {
      if (!requireAccount("Iniciá sesión para usar listas.")) return;
      const item = catalog.get(form.dataset.id);
      if (!item) return;
      try {
        let listId = data.list;
        if (listId === "__nueva") listId = await userdata.lists.create({ name: item.title.slice(0, 80) });
        await userdata.lists.addItem(listId, item);
        toast(`Agregado a "${userdata.lists.get(listId)?.name || "tu lista"}".`);
      } catch {
        toast("No se pudo agregar a la lista. Probá de nuevo.");
      }
    }
  });

  // ---------- cuenta: estado en la barra superior ----------
  const accountLink = app.querySelector("#account-link");
  function updateAccountLink() {
    if (account.signedIn) {
      accountLink.href = "#/perfil";
      accountLink.innerHTML = `<span class="avatar" aria-hidden="true">${e(account.name.slice(0, 1).toUpperCase())}</span><span class="account-name">${e(account.name)}</span>`;
      accountLink.setAttribute("aria-label", `Tu perfil: ${account.name}`);
    } else {
      accountLink.href = "#/cuenta";
      accountLink.textContent = "Ingresar";
      accountLink.removeAttribute("aria-label");
    }
  }
  // Al entrar, salir o verificar el correo, el catálogo central se vuelve a pedir con la sesión nueva.
  let sessionKey = null;
  account.onChange(() => {
    updateAccountLink();
    queueRender();
    const key = account.ready ? `${account.user?.uid || ""}:${account.verified}` : null;
    const changed = sessionKey === null ? !account.signedIn : key !== sessionKey; // al abrir sin sesión, o al cambiar
    if (key !== null && changed && getInstance("central")?.enabled) {
      catalog.forgetThrottle("central");
      // Sin sesión no se muestra la copia guardada del catálogo (no toca favoritos ni historial).
      const clear = account.signedIn ? Promise.resolve() : catalog.clearCache("central");
      clear.then(() => catalog.load({ only: "central", force: true })).then(render);
    }
    if (key !== null) sessionKey = key;
  });
  userdata.onChange(queueRender);
  account.start().catch(() => { toast("No se pudo conectar con el servicio de cuentas. El catálogo funciona igual."); });

  // ---------- búsqueda ----------
  let searchTimer = 0, remoteTimer = 0, remoteAbort = null;
  // Búsqueda en TODO el catálogo central (paginada en el servidor), además de lo ya cargado.
  async function remoteSearch(q, page) {
    remoteAbort?.abort();
    if (!q || q.length < 2 || !getInstance("central")?.enabled || !account.verified) { state.remote = null; return; }
    remoteAbort = new AbortController();
    const previous = page > 1 && state.remote?.q === q ? state.remote.items : [];
    state.remote = { q, page, items: previous, loading: true, hasMore: false, error: "" };
    queueRender();
    try {
      const res = await searchCentral(q, page, { signal: remoteAbort.signal });
      state.remote = { q, page, items: [...previous, ...catalog.addExternal("central", res.items)], hasMore: res.hasMore, loading: false, error: "" };
    } catch (err) {
      if (err?.name === "AbortError") return;
      state.remote = { q, page, items: previous, hasMore: false, loading: false, error: err?.message || "No se pudo buscar en el catálogo central." };
    }
    if (state.query.trim() === q) render();
  }
  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = search.value; render(); }, 120);
    clearTimeout(remoteTimer);
    remoteTimer = setTimeout(() => remoteSearch(search.value.trim(), 1), 400);
  });
  search.addEventListener("keydown", ev => {
    if (ev.key === "Escape") { search.value = ""; state.query = ""; render(); }
  });
  document.addEventListener("keydown", ev => {
    if (ev.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      ev.preventDefault();
      search.focus();
    } else if (ev.key.startsWith("Arrow") && !ev.altKey && !ev.ctrlKey && document.activeElement.matches(SPATIAL_FROM)) {
      if (moveFocus(ev.key)) ev.preventDefault();
    }
  });

  // Navegación con flechas entre tarjetas, como con el control remoto de una app de TV:
  // busca el elemento más cercano en la dirección de la flecha.
  const SPATIAL_FROM = ".poster, .channel-logo, .wide-thumb, .ch-link, .episode-link, .nav-item, .cat";
  const SPATIAL_TO = SPATIAL_FROM + ", #view .primary, #view .secondary, #view .filter, #view .see-all";
  function moveFocus(key) {
    const current = document.activeElement.getBoundingClientRect();
    const cx = current.left + current.width / 2, cy = current.top + current.height / 2;
    const horizontal = key === "ArrowLeft" || key === "ArrowRight";
    let best = null, bestScore = Infinity;
    for (const el of app.querySelectorAll(SPATIAL_TO)) {
      if (el === document.activeElement || !el.offsetParent) continue;
      const r = el.getBoundingClientRect();
      const dx = r.left + r.width / 2 - cx, dy = r.top + r.height / 2 - cy;
      const along = { ArrowRight: dx, ArrowLeft: -dx, ArrowDown: dy, ArrowUp: -dy }[key];
      if (along <= 4) continue;
      const score = along + (horizontal ? Math.abs(dy) : Math.abs(dx)) * 3;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (!best) return false;
    best.focus({ preventScroll: true });
    best.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    return true;
  }

  // ---------- rutas ----------
  // Cada entrada del historial guarda su "profundidad" dentro de la app,
  // así "Volver" solo retrocede si la página anterior también es de la app.
  history.replaceState({ depth: history.state?.depth ?? 0 }, "");
  depth = history.state.depth;
  window.addEventListener("hashchange", () => {
    if (history.state?.depth == null) history.replaceState({ depth: depth + 1 }, "");
    depth = history.state.depth;
    const previous = state.route;
    state.route = parseRoute(location.hash);
    if (state.route.name !== previous.name || state.route.id !== previous.id) {
      state.filters = defaultFilters();
      if (state.route.id !== previous.id) state.season = 0;
    }
    if (state.route.id !== previous.id || state.route.episodeId !== previous.episodeId) {
      state.sourceIndex = 0;
    }
    state.confirm = null;
    if (state.route.name !== previous.name || state.route.id !== previous.id || state.route.mode !== previous.mode) {
      state.formError = ""; state.formMessage = "";
      if (state.route.name !== "cuenta") state.authReason = "";
      if (state.route.name === "ajustes") state.sources = null; // configuración fresca al entrar
      if (state.route.name === "admin") { state.admin = null; state.central.data = {}; state.central.editing = null; } // datos frescos al entrar
      state.listItems = {}; // las listas se vuelven a leer al entrar (pueden haber cambiado)
    }
    if (state.query) { state.query = ""; search.value = ""; }
    render({ focusHeading: state.route.name !== "ver" });
    window.scrollTo({ top: 0 });
  });

  // Si una imagen no carga, se quita y queda el degradado de respaldo.
  view.addEventListener("error", ev => { if (ev.target.tagName === "IMG") ev.target.remove(); }, true);

  render();
  catalog.load().then(() => {
    render();
    enrich.enrichInBackground(catalog.all(), queueRender);
  });
  return ctx;
}
