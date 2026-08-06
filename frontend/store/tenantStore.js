import { create } from "zustand";
import useAuthStore from "./authStore";

export const useTenantStore = create((set) => ({
  tenantId: null,
  tenantName: null,

  syncFromAuth: () => {
    const user = useAuthStore.getState().user;
    set({
      tenantId: user?.tenant_id || null,
      tenantName: user?.tenant_name || null,
    });
  },

  setTenant: ({ tenantId, tenantName }) => {
    set({ tenantId, tenantName });
  },

  clear: () => set({ tenantId: null, tenantName: null }),
}));

export default useTenantStore;
