"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "../../../components/shared/Button";
import PasswordInput from "../../../components/shared/PasswordInput";
import authService from "../../../services/authService";
import healthService from "../../../services/healthService";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [healthHint, setHealthHint] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await authService.login(email, password);
      if (data.user?.role === "super_admin") {
        await authService.logout();
        setError("Use the super admin portal to sign in.");
        return;
      }
      // Prove JWT works: protected health call before navigating
      await healthService.getProtectedHealth();
      router.replace("/dashboard");
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function pingApi() {
    setHealthHint(null);
    try {
      const data = await healthService.getPublicHealth();
      setHealthHint(`API ${data.status} · ${data.service}`);
    } catch (err) {
      setHealthHint(err.message || "API unreachable");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 via-brand-50 to-slate-200 px-4">
      <div className="w-full max-w-md rounded-xl border border-surface-border bg-white p-8 shadow-sm">
        <div className="mb-8">
          <a
            href="/"
            className="text-sm font-semibold uppercase tracking-wide text-brand-600 hover:underline"
          >
            OMS
          </a>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Sign in</h1>
          <p className="mt-1 text-sm text-slate-500">
            Multi-tenant order management
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Email
            </span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
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
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <div className="mt-6 flex items-center justify-between border-t border-surface-border pt-4 text-xs text-slate-500">
          <button
            type="button"
            onClick={pingApi}
            className="text-brand-600 hover:underline"
          >
            Check API health
          </button>
          {healthHint ? <span>{healthHint}</span> : null}
        </div>
      </div>
    </main>
  );
}
