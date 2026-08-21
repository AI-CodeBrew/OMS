import { create } from "zustand";
import useAuthStore from "./authStore";

export const useTenantStore = create((set) => ({
  organizationId: null,
  organizationName: null,

  syncFromAuth: () => {
    const user = useAuthStore.getState().user;
    set({
      organizationId: user?.organization_id || null,
      organizationName: user?.organization_name || null,
    });
  },

  setOrganization: ({ organizationId, organizationName }) => {
    set({ organizationId, organizationName });
  },

  clear: () => set({ organizationId: null, organizationName: null }),
}));

export default useTenantStore;
