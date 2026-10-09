"use client";

import { useRouter } from "next/navigation";
import useAuthStore from "../../store/authStore";
import { invalidateViewCache } from "../../lib/viewCache";

export default function ActingStoreBanner() {
  const router = useRouter();
  const actingStore = useAuthStore((s) => s.actingStore);
  const exitStore = useAuthStore((s) => s.exitStore);

  if (!actingStore) return null;

  function exit() {
    exitStore();
    invalidateViewCache();
    router.push(actingStore.hub ? "/admin/dispatch-hub" : "/admin/stores");
  }

  return (
    // Fixed rather than in-flow: the tenant header/sidebar/main are sized
    // against a 4rem header, so an in-flow bar would break that layout.
    // Just the exit button - it's the only way back out of a store/the Hub
    // from the tenant screens.
    <button
      type="button"
      onClick={exit}
      className="fixed bottom-3 right-3 z-50 rounded-md bg-amber-400 px-3 py-1.5 text-xs font-semibold text-amber-950 shadow-lg ring-1 ring-amber-600/30 transition hover:bg-amber-300"
    >
      {actingStore.hub ? "Exit Dispatch Hub" : "Exit store"}
    </button>
  );
}
