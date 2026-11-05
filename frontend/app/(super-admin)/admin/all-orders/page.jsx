"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import useAuthStore from "../../../../store/authStore";
import { invalidateViewCache } from "../../../../lib/viewCache";

// The super admin's All Orders tab: the Dispatch Hub's own Orders view
// (same cards, table and actions), over EVERY store - Hub or not. Opens
// straight into it; the header's back arrow comes back to the panel.
export default function AllOrdersPage() {
  const router = useRouter();
  const enterStore = useAuthStore((s) => s.enterStore);

  useEffect(() => {
    // After the panel's own "leave any store" step on arrival (the layout's
    // effect runs after this page's), so it isn't undone right away.
    const timer = setTimeout(() => {
      enterStore({ hub: true, allStores: true, name: "All Orders", modules: ["oms", "wms"] });
      invalidateViewCache();
      router.replace("/orders");
    }, 0);
    return () => clearTimeout(timer);
  }, [enterStore, router]);

  return <p className="text-sm text-slate-500">Opening All Orders…</p>;
}
