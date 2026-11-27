"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import useAuthStore from "../../../../store/authStore";
import adminTeamService, { exitTargetFor } from "../../../../services/adminTeamService";
import { lastPage } from "../../../../lib/pageMemory";

// Where a limited login lands in the Hub - its first page.
const HUB_LANDING = [
  ["oms.dashboard", "/dashboard"],
  ["oms.orders", "/orders"],
  ["oms.critical_orders", "/critical-orders"],
  ["wms.returns_desk", "/returns"],
  ["reports", "/reports"],
  ["batch", "/batch"],
  ["tickets", "/tickets"],
];

// The sidebar's Dispatch Hub opens straight into the Hub - its Dashboard,
// Orders and the rest - like All Orders (user, 2026-11-26). The old page
// in between (Hub stores and per-order rates) is gone: stores go in and out
// of the Hub from the Stores page's "Add to Hub / Remove from Hub".
export default function DispatchHubPage() {
  const router = useRouter();
  const enterStore = useAuthStore((s) => s.enterStore);

  useEffect(() => {
    let alive = true;
    const open = (access) => {
      if (!alive) return;
      // A super admin staff login sees only the Hub pages its role gives.
      const pages = access && !access.is_owner ? access.hub_pages || {} : null;
      const first = pages ? HUB_LANDING.find(([key]) => pages[key]) : null;
      // After the panel's own "leave any store" step on arrival (the
      // layout's effect runs after this page's), so it isn't undone.
      setTimeout(() => {
        if (!alive) return;
        enterStore({
          hub: true,
          name: "Dispatch Hub",
          modules: ["oms", "wms"],
          pages,
          // Leaving the Hub: the first other super admin page this login
          // has (none: no way out but log out).
          exitTo: exitTargetFor(access, ["dispatch_hub"], "/admin/organizations"),
        });
        // Back where the Hub was left - its page and card, its data shown
        // at once (user, 2026-11-27); its first page on the first visit.
        // Replaced, not added: Back from there goes to the page before it -
        // this one would only open the Hub again.
        router.replace(lastPage() || (first ? first[1] : "/dashboard"));
      }, 0);
    };
    // The access this login already has opens the Hub at once (user,
    // 2026-11-27); only the first visit waits for it.
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

  return <p className="text-sm text-slate-500">Opening Dispatch Hub…</p>;
}
