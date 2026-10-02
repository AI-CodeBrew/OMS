import { useMemo } from "react";
import { create } from "zustand";

const STORAGE_KEY = "oms_auth";
// sessionStorage, so each browser tab can act as a different store.
const ACTING_STORE_KEY = "oms_acting_store";

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
  // operating, or { hub: true, name, modules, storeCount } while operating
  // the Dispatch Hub (several stores at once - see useEffectiveUser below).
  actingStore: null,

  hydrateFromStorage: () => {
    if (typeof window === "undefined" || get().hydrated) return;
    const persisted = loadPersisted();
    const user = persisted?.user || null;
    set({
      accessToken: persisted?.accessToken || null,
      refreshToken: persisted?.refreshToken || null,
      user,
      actingStore: user?.role === "super_admin" ? loadActingStore() : null,
      hydrated: true,
    });
  },

  enterStore: (store) => {
    persistActingStore(store);
    set({ actingStore: store });
  },

  exitStore: () => {
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
    set({ accessToken: null, refreshToken: null, user: null, actingStore: null, hydrated: true });
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

/** The user as tenant screens should see them: a super admin operating a
 * store acts as its org admin; operating the Dispatch Hub acts as an org
 * admin of no single store (isDispatchHub: true - components that need to
 * know, e.g. ModuleSidebar, OrdersTable's Store column, check that flag). */
export function useEffectiveUser() {
  const user = useAuthStore((s) => s.user);
  const actingStore = useAuthStore((s) => s.actingStore);
  return useMemo(() => {
    if (!user || user.role !== "super_admin" || !actingStore) return user;
    return {
      ...user,
      organization_id: actingStore.id || null,
      organization_name: actingStore.name,
      modules: actingStore.modules || [],
      is_manual_store: Boolean(actingStore.is_manual_store),
      isOrgAdmin: true,
      isDispatchHub: Boolean(actingStore.hub),
    };
  }, [user, actingStore]);
}

export default useAuthStore;
