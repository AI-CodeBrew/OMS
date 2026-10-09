"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import useAuthStore from "../../store/authStore";
import { installSessionGuard } from "../../lib/sessionGuard";

export default function ProtectedRoute({ children, requireSuperAdmin = false }) {
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);
  const hydrateFromStorage = useAuthStore((s) => s.hydrateFromStorage);

  useEffect(() => {
    hydrateFromStorage();
  }, [hydrateFromStorage]);

  // Once per page load: an expired session refreshes itself, or signs the
  // user out and sends them to the login page with a message.
  useEffect(() => {
    try {
      installSessionGuard();
    } catch {
      // Supabase env missing - the app can't sign in at all then.
    }
  }, []);

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
