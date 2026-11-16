"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import useAuthStore from "../../../../store/authStore";
import { invalidateViewCache } from "../../../../lib/viewCache";
import adminTeamService, { exitTargetFor } from "../../../../services/adminTeamService";

// The super admin's All Orders tab: the Dispatch Hub's own Orders view
// (same cards, table and actions), over EVERY store - Hub or not. Opens
// straight into it; the header's back arrow comes back to the panel.
export default function AllOrdersPage() {
  const router = useRouter();
  const enterStore = useAuthStore((s) => s.enterStore);

  useEffect(() => {
    let alive = true;
    adminTeamService
      .me()
      .catch(() => ({ is_owner: true }))
      .then((access) => {
        if (!alive) return;
        // After the panel's own "leave any store" step on arrival (the
        // layout's effect runs after this page's), so it isn't undone.
        setTimeout(() => {
          enterStore({
            hub: true,
            allStores: true,
            name: "All Orders",
            modules: ["oms", "wms"],
            exitTo: exitTargetFor(access, ["all_orders", "critical_orders"], "/admin/organizations"),
          });
          invalidateViewCache();
          router.replace("/orders");
        }, 0);
      });
    return () => {
      alive = false;
    };
  }, [enterStore, router]);

  return <p className="text-sm text-slate-500">Opening All Orders…</p>;
}
