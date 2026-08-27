"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import useAuthStore from "../../store/authStore";

export default function ProtectedRoute({ children, requireSuperAdmin = false }) {
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);
  const hydrateFromStorage = useAuthStore((s) => s.hydrateFromStorage);

  useEffect(() => {
    hydrateFromStorage();
  }, [hydrateFromStorage]);

  useEffect(() => {
    if (!hydrated) return;
    if (!accessToken) {
      router.replace(requireSuperAdmin ? "/superadmin" : "/login");
      return;
    }
    if (requireSuperAdmin && user?.role !== "super_admin") {
      router.replace("/dashboard");
    }
  }, [hydrated, accessToken, user, requireSuperAdmin, router]);

  if (!hydrated || !accessToken) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-600">
        {hydrated ? "Redirecting…" : "Loading…"}
      </div>
    );
  }

  if (requireSuperAdmin && user?.role !== "super_admin") {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-600">
        Checking permissions…
      </div>
    );
  }

  return children;
}
