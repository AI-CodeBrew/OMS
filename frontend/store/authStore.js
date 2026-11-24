import { useMemo } from "react";
import { create } from "zustand";
import { setViewCacheScope } from "../lib/viewCache";

const STORAGE_KEY = "oms_auth";
// sessionStorage, so each browser tab can act as a different store.
const ACTING_STORE_KEY = "oms_acting_store";
// An organization login's "All stores" view (StoreSwitcher) - per tab too.
const ORG_ALL_STORES_KEY = "oms_org_all_stores";

function loadOrgAllStores() {
  try {
    return window.sessionStorage.getItem(ORG_ALL_STORES_KEY) === "1";
  } catch {
    return false;
  }
}

function persistOrgAllStores(on) {
  try {
    if (on) window.sessionStorage.setItem(ORG_ALL_STORES_KEY, "1");
    else window.sessionStorage.removeItem(ORG_ALL_STORES_KEY);
  } catch {
    // storage unavailable - lasts only until reload
  }
}

function loadActingStore() {
  try {
    const raw = window.sessionStorage.getItem(ACTING_STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persistActingStore(store) {
  try {
    if (store) window.sessionStorage.setItem(ACTING_STORE_KEY, JSON.stringify(store));
    else window.sessionStorage.removeItem(ACTING_STORE_KEY);
  } catch {
    // storage unavailable - acting store then lasts only until reload
  }
}

// The store / Hub a super admin last left (Exit, or Back out to the admin
// panel) - so Back (or Forward) onto one of its pages opens it again instead
// of jumping to Stores (user, 2026-11-24). Per browser tab, like the store.
const LAST_ACTING_STORE_KEY = "oms_last_acting_store";

function rememberLastActingStore(store) {
  try {
    if (store) window.sessionStorage.setItem(LAST_ACTING_STORE_KEY, JSON.stringify(store));
    else window.sessionStorage.removeItem(LAST_ACTING_STORE_KEY);
  } catch {
    // storage unavailable - Back then lands on Stores, as before
  }
}

/** The store / Hub last left in this tab, or null. */
export function lastActingStore() {
  try {
    const raw = window.sessionStorage.getItem(LAST_ACTING_STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function loadPersisted() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persist(state) {
  if (!state.accessToken) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      accessToken: state.accessToken,
      refreshToken: state.refreshToken,
      user: state.user,
    })
  );
}

export const useAuthStore = create((set, get) => ({
  // Always starts unauthenticated, on both the server render and the
  // first client render - reading localStorage synchronously here would
  // make that first client render diverge from the server-rendered HTML
  // and trigger a hydration error. hydrateFromStorage() populates the
  // real session from a useEffect (see ProtectedRoute), which only runs
  // after hydration completes.
  accessToken: null,
  refreshToken: null,
  user: null,
  hydrated: false,
  // { id, name, modules, is_manual_store } of the store a super admin is
  // operating, { hub: true, name, modules, storeCount } while operating
  // the Dispatch Hub (several stores at once - see useEffectiveUser below),
  // or { platform: true, id, name } while managing FynkTech's own courier
  // accounts on the OMS Courier tab (see enterPlatform).
  actingStore: null,
  // An organization's own login (never the super admin) viewing every store
  // of its organization together - read-only (backend middleware
  // ORG_ALL_STORES_HEADER). Set from the header's store switcher.
  orgAllStores: false,

  hydrateFromStorage: () => {
    if (typeof window === "undefined" || get().hydrated) return;
    const persisted = loadPersisted();
    const user = persisted?.user || null;
    set({
      accessToken: persisted?.accessToken || null,
      refreshToken: persisted?.refreshToken || null,
      user,
      actingStore: user?.role === "super_admin" ? loadActingStore() : null,
      orgAllStores: Boolean(user) && user.role !== "super_admin" && loadOrgAllStores(),
      hydrated: true,
    });
  },

  enterStore: (store) => {
    persistActingStore(store);
    set({ actingStore: store });
  },

  // Acts as the hidden platform org that holds FynkTech's own courier
  // accounts. Deliberately not persisted: a reload starts clean and the OMS
  // Courier layout enters it again, so the panel is never left acting as
  // the platform org after leaving that tab.
  enterPlatform: (org) => {
    set({ actingStore: { ...org, platform: true } });
  },

  setOrgAllStores: (on) => {
    persistOrgAllStores(Boolean(on));
    set({ orgAllStores: Boolean(on) });
  },

  exitStore: () => {
    const leaving = get().actingStore;
    // Not the OMS Courier tab's platform org - that one is never returned to by Back.
    if (leaving && !leaving.platform) rememberLastActingStore(leaving);
    persistActingStore(null);
    set({ actingStore: null });
  },

  setSession: ({ accessToken, refreshToken, user }) => {
    const next = { accessToken, refreshToken, user };
    persist(next);
    set({ ...next, hydrated: true });
  },

  clearSession: () => {
    persist({ accessToken: null });
    persistActingStore(null);
    rememberLastActingStore(null);
    persistOrgAllStores(false);
    set({ accessToken: null, refreshToken: null, user: null, actingStore: null, orgAllStores: false, hydrated: true });
  },

  isAuthenticated: () => Boolean(get().accessToken),

  isSuperAdmin: () => get().user?.role === "super_admin",

  isOrgAdmin: () => get().user?.role === "org_admin" || get().user?.isOrgAdmin === true,

  hasModule: (moduleKey) => {
    const user = get().user;
    if (!user) return false;
    if (user.role === "super_admin" || user.role === "org_admin" || user.isOrgAdmin) {
      return true;
    }
    return (user.modules || []).includes(moduleKey);
  },
}));

/** Whose data the screens are showing: the signed-in user, their org, and
 * the store a super admin is operating. Changes on login, logout, and
 * entering/leaving a store. */
export function accountKey(state) {
  const { user, actingStore, orgAllStores } = state;
  if (!user) return "";
  // The Hub, All Orders and Critical Orders have no store id - their flags
  // tell them apart.
  const acting = actingStore
    ? `${actingStore.hub ? "hub" : actingStore.platform ? "platform" : ""}:${actingStore.id || ""}` +
      `${actingStore.allStores ? ":all" : ""}${actingStore.critical ? ":critical" : ""}`
    : "";
  return `${user.id}|${user.organization_id || ""}|${acting}|${orgAllStores ? "all" : ""}`;
}

// Orders/Dashboard payloads are cached in memory per tab (lib/viewCache),
// kept apart per login and per store / Hub it operates - so another
// account never sees this one's orders, and Back into the Hub or a store
// shows its last data at once.
useAuthStore.subscribe((state, prev) => {
  if (accountKey(state) !== accountKey(prev)) setViewCacheScope(accountKey(state));
});

/** The user as tenant screens should see them: a super admin operating a
 * store acts as its org admin; operating the Dispatch Hub acts as an org
 * admin of no single store (isDispatchHub: true - components that need to
 * know, e.g. ModuleSidebar, OrdersTable's Store column, check that flag). */
export function useEffectiveUser() {
  const user = useAuthStore((s) => s.user);
  const actingStore = useAuthStore((s) => s.actingStore);
  const orgAllStores = useAuthStore((s) => s.orgAllStores);
  return useMemo(() => {
    // An organization login's "All stores": the multi-store screens (store
    // column, store filter - same as the super admin's All Orders), and
    // view-only (moduleNav.canWritePage; the backend refuses changes too).
    if (user && user.role !== "super_admin" && orgAllStores) {
      return {
        ...user,
        organization_name: "All stores",
        isDispatchHub: true,
        isAllOrders: true,
        isOrgAllStores: true,
      };
    }
    if (!user || user.role !== "super_admin" || !actingStore) return user;
    return {
      ...user,
      organization_id: actingStore.id || null,
      organization_name: actingStore.name,
      modules: actingStore.modules || [],
      is_manual_store: Boolean(actingStore.is_manual_store),
      isOrgAdmin: true,
      isDispatchHub: Boolean(actingStore.hub),
      // A super admin staff login's Hub pages (null = every page).
      pages: actingStore.hub ? actingStore.pages || null : user.pages,
      // The super admin's All Orders tab - the hub's view over every store.
      isAllOrders: Boolean(actingStore.hub && actingStore.allStores),
      // The super admin's Critical Orders tab - every store's critical orders.
      isCriticalOrders: Boolean(actingStore.hub && actingStore.allStores && actingStore.critical),
    };
  }, [user, actingStore, orgAllStores]);
}

export default useAuthStore;
