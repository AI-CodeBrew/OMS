"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import useAuthStore from "../../../../store/authStore";
import adminTeamService, { exitTargetFor } from "../../../../services/adminTeamService";
import { lastPage } from "../../../../lib/pageMemory";

// The super admin's Critical Orders tab: every store's critical orders (the
// same Critical Orders screen a store has), Hub store or not, in one place.
// Opens straight into it, like All Orders; the back arrow leaves it.
export default function CriticalOrdersAdminPage() {
  const router = useRouter();
  const enterStore = useAuthStore((s) => s.enterStore);

  useEffect(() => {
    let alive = true;
    const open = (access) => {
      if (!alive) return;
      // A staff login with All Orders sees everything there; with only
      // Critical Orders it's limited to this one page.
      const level = access.permissions?.critical_orders;
      const pages =
        access.is_owner || access.permissions?.all_orders ? null : { "oms.critical_orders": level || "read" };
      // After the panel's own "leave any store" step on arrival (the
      // layout's effect runs after this page's), so it isn't undone.
      setTimeout(() => {
        if (!alive) return;
        enterStore({
          hub: true,
          allStores: true,
          critical: true,
          name: "Critical Orders",
          modules: ["oms", "wms"],
          pages,
          exitTo: exitTargetFor(access, ["critical_orders", "all_orders"], "/admin/organizations"),
        });
        // Back where it was left, shown at once (user, 2026-11-27).
        router.replace(lastPage() || "/critical-orders");
      }, 0);
    };
    // The access this login already has opens it at once; only the first
    // visit waits for it.
    const known = adminTeamService.cachedMe();
    if (known) open(known);
    else
      adminTeamService
        .me()
        .catch(() => ({ is_owner: true }))
        .then(open);
    return () => {
      alive = false;
    };
  }, [enterStore, router]);

  return <p className="text-sm text-slate-500">Opening Critical Orders…</p>;
}
