"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import useAuthStore from "../../../../store/authStore";
import { invalidateViewCache } from "../../../../lib/viewCache";
import adminTeamService, { exitTargetFor } from "../../../../services/adminTeamService";

// The super admin's Critical Orders tab: every store's critical orders (the
// same Critical Orders screen a store has), Hub store or not, in one place.
// Opens straight into it, like All Orders; the back arrow leaves it.
export default function CriticalOrdersAdminPage() {
  const router = useRouter();
  const enterStore = useAuthStore((s) => s.enterStore);

  useEffect(() => {
    let alive = true;
    adminTeamService
      .me()
      .catch(() => ({ is_owner: true }))
      .then((access) => {
        if (!alive) return;
        // A staff login with All Orders sees everything there; with only
        // Critical Orders it's limited to this one page.
        const level = access.permissions?.critical_orders;
        const pages =
          access.is_owner || access.permissions?.all_orders ? null : { "oms.critical_orders": level || "read" };
        // After the panel's own "leave any store" step on arrival (the
        // layout's effect runs after this page's), so it isn't undone.
        setTimeout(() => {
          enterStore({
            hub: true,
            allStores: true,
            critical: true,
            name: "Critical Orders",
            modules: ["oms", "wms"],
            pages,
            exitTo: exitTargetFor(access, ["critical_orders", "all_orders"], "/admin/organizations"),
          });
          invalidateViewCache();
          router.replace("/critical-orders");
        }, 0);
      });
    return () => {
      alive = false;
    };
  }, [enterStore, router]);

  return <p className="text-sm text-slate-500">Opening Critical Orders…</p>;
}
