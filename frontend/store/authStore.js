import { create } from "zustand";

const STORAGE_KEY = "oms_auth";

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

  hydrateFromStorage: () => {
    if (typeof window === "undefined" || get().hydrated) return;
    const persisted = loadPersisted();
    set({
      accessToken: persisted?.accessToken || null,
      refreshToken: persisted?.refreshToken || null,
      user: persisted?.user || null,
      hydrated: true,
    });
  },

  setSession: ({ accessToken, refreshToken, user }) => {
    const next = { accessToken, refreshToken, user };
    persist(next);
    set({ ...next, hydrated: true });
  },

  clearSession: () => {
    persist({ accessToken: null });
    set({ accessToken: null, refreshToken: null, user: null, hydrated: true });
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

export default useAuthStore;
