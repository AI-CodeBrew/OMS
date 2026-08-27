"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "../../../components/shared/Button";
import PasswordInput from "../../../components/shared/PasswordInput";
import authService from "../../../services/authService";

export default function SuperAdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await authService.login(email, password);
      if (data.user?.role !== "super_admin") {
        await authService.logout();
        setError("This portal is for super admins only.");
        return;
      }
      router.replace("/admin/organizations");
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-950/80 p-8 shadow-lg backdrop-blur">
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-wide text-amber-400">
            OMS
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-white">Super Admin</h1>
          <p className="mt-1 text-sm text-slate-400">
            Sign in to manage organizations
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-300">
              Email
            </span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-300">
              Password
            </span>
            <PasswordInput
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {error ? (
            <p className="rounded-md bg-red-950/50 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          ) : null}

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </main>
  );
}
