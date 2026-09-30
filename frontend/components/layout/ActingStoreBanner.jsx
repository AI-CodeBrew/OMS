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
    router.push("/admin/stores");
  }

  return (
    // Fixed rather than in-flow: the tenant header/sidebar/main are sized
    // against a 4rem header, so an in-flow bar would break that layout.
    <div className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-3xl items-center justify-between gap-3 rounded-xl bg-amber-400 px-4 py-2.5 text-sm text-amber-950 shadow-lg ring-1 ring-amber-600/30">

      <p className="min-w-0 truncate">
        <span className="font-semibold">Super Admin</span> — operating store{" "}
        <span className="font-semibold">{actingStore.name}</span>. Every action you take is
        applied to this store and logged.
      </p>
      <button
        type="button"
        onClick={exit}
        className="shrink-0 rounded-md bg-amber-950 px-3 py-1 text-xs font-semibold text-amber-50 transition hover:bg-amber-900"
      >
        Exit store
      </button>
    </div>
  );
}
