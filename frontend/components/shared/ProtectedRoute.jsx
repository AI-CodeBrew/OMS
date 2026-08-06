"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import useAuthStore from "../../store/authStore";

export default function ProtectedRoute({ children, requireSuperAdmin = false }) {
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    if (requireSuperAdmin && user?.role !== "super_admin") {
      router.replace("/orders");
    }
  }, [accessToken, user, requireSuperAdmin, router]);

  if (!accessToken) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-600">
        Redirecting to login…
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
