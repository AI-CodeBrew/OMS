"use client";

import { createContext, useContext } from "react";

// Where an integration page's "Integrations /" breadcrumb leads: the
// store's own Integrations page by default, or the super admin's OMS
// Courier tab when the same page is managing FynkTech's own account
// (app/(super-admin)/admin/oms-courier/(accounts)/layout.jsx).
const IntegrationsHomeContext = createContext({ href: "/integrations", label: "Integrations" });

export const IntegrationsHomeProvider = IntegrationsHomeContext.Provider;

export function useIntegrationsHome() {
  return useContext(IntegrationsHomeContext);
}
