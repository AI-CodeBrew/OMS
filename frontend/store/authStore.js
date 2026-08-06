import { create } from "zustand";

const STORAGE_KEY = "oms_auth";

function loadPersisted() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persist(state) {
  if (typeof window === "undefined") return;
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

const initial = loadPersisted();

export const useAuthStore = create((set, get) => ({
  accessToken: initial?.accessToken || null,
  refreshToken: initial?.refreshToken || null,
  user: initial?.user || null,
  hydrated: typeof window !== "undefined",

  setSession: ({ accessToken, refreshToken, user }) => {
    const next = { accessToken, refreshToken, user };
    persist(next);
    set(next);
  },

  clearSession: () => {
    persist({ accessToken: null });
    set({ accessToken: null, refreshToken: null, user: null });
  },

  isAuthenticated: () => Boolean(get().accessToken),

  isSuperAdmin: () => get().user?.role === "super_admin",
}));

export default useAuthStore;
