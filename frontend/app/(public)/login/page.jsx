"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "../../../components/shared/Button";
import InteractiveGrid from "../../../components/shared/InteractiveGrid";
import PasswordInput from "../../../components/shared/PasswordInput";
import authService, { ORG_SUSPENDED_CODE, takeLoginNotice } from "../../../services/authService";
import healthService from "../../../services/healthService";

function LogoMark({ className = "h-10 w-10" }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="oms-logo-g" x1="4" y1="2" x2="36" y2="38" gradientUnits="userSpaceOnUse">
          <stop stopColor="#60a5fa" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill="url(#oms-logo-g)" />
      <path d="M20 8.5l9.5 5.25v10.5L20 29.5l-9.5-5.25v-10.5L20 8.5z" fill="white" fillOpacity="0.22" />
      <path d="M20 8.5l9.5 5.25L20 19l-9.5-5.25L20 8.5z" fill="white" />
      <path d="M20 19v10.5l-9.5-5.25v-10.5L20 19z" fill="white" fillOpacity="0.55" />
      <path d="M20 19v10.5l9.5-5.25v-10.5L20 19z" fill="white" fillOpacity="0.8" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [healthHint, setHealthHint] = useState(null);

  // Left by the tenant layout when it signs out a user whose organization
  // was suspended mid-session.
  useEffect(() => {
    const notice = takeLoginNotice();
    if (notice) setError(notice);
  }, []);

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
      // Prove JWT works: protected health call before navigating. Also where
      // a suspended organization is caught - Supabase still signs them in.
      await healthService.getProtectedHealth();
      router.replace("/dashboard");
    } catch (err) {
      if (err.code === ORG_SUSPENDED_CODE) {
        await authService.logout();
      }
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
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* Left: product info */}
      <section className="relative hidden overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-brand-700 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <InteractiveGrid base="255,255,255" baseAlpha={0.08} glow="147,197,253" glowAlpha={0.6} />
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-white/5" />

        <a href="/" className="relative flex items-center gap-3">
          <LogoMark className="h-11 w-11 shadow-lg shadow-black/20" />
          <span className="leading-tight">
            <span className="block text-xl font-semibold tracking-wide">OMS</span>
            <span className="block text-[11px] uppercase tracking-[0.18em] text-slate-300">
              Order Management
            </span>
          </span>
        </a>

        <div className="relative max-w-lg">
          <h2 className="text-4xl font-semibold leading-tight">
            Run every order, from checkout to doorstep.
          </h2>
          <p className="mt-4 text-base text-slate-300">
            One platform for your sales channels, couriers and team. Fewer
            spreadsheets, faster dispatch, clearer numbers.
          </p>

          <ul className="mt-10 space-y-5">
            {[
              ["Unified orders", "Pull orders from all your stores into a single dashboard."],
              ["Courier booking", "Book shipments, print airway bills and track delivery status."],
              ["Multi-tenant & secure", "Separate workspaces with role-based access for every team."],
            ].map(([title, text]) => (
              <li key={title} className="flex gap-4">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/15">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path
                      fillRule="evenodd"
                      d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 111.4-1.4l3.8 3.8 6.8-6.8a1 1 0 011.4 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                </span>
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="text-sm text-slate-300">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-slate-400">
          &copy; {new Date().getFullYear()} OMS. All rights reserved.
        </p>
      </section>

      {/* Right: sign in */}
      <section className="relative flex items-center justify-center overflow-hidden bg-gradient-to-br from-white via-brand-50 to-slate-100 px-4 py-12">
        {/* square grid lines */}
        <InteractiveGrid />
        {/* decorative circles */}
        <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-brand-100/70" />
        <div className="pointer-events-none absolute right-24 top-40 h-24 w-24 rounded-full border-2 border-brand-200" />
        <div className="pointer-events-none absolute -bottom-28 -left-20 h-80 w-80 rounded-full bg-brand-100/60" />
        <div className="pointer-events-none absolute bottom-24 left-16 h-16 w-16 rounded-full bg-brand-200/60" />
        <div className="pointer-events-none absolute left-1/2 top-16 h-6 w-6 rounded-full bg-brand-300/50" />
        <div className="pointer-events-none absolute bottom-16 right-32 h-10 w-10 rounded-full border-2 border-brand-200" />

        <div className="relative w-full max-w-md">
          <a href="/" className="mb-8 flex items-center gap-3 lg:hidden">
            <LogoMark className="h-10 w-10" />
            <span className="leading-tight">
              <span className="block text-lg font-semibold text-slate-900">OMS</span>
              <span className="block text-[11px] uppercase tracking-[0.18em] text-slate-500">
                Order Management
              </span>
            </span>
          </a>

          <div className="rounded-2xl border border-white/60 bg-white/90 p-8 shadow-xl shadow-brand-900/10 ring-1 ring-slate-200/70 backdrop-blur">
            <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-md shadow-brand-600/30">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                <rect x="4" y="11" width="16" height="9" rx="2" />
                <path d="M8 11V8a4 4 0 118 0v3" />
              </svg>
            </span>
            <h1 className="text-2xl font-semibold text-slate-900">Welcome back</h1>
            <p className="mt-1 text-sm text-slate-500">
              Sign in to your account to continue.
            </p>

            <form onSubmit={onSubmit} className="mt-8 space-y-4">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">
                  Email
                </span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@company.com"
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

              <Button type="submit" loading={loading} className="w-full">
                Sign in
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
          <p className="mt-6 text-center text-xs text-slate-500">
            Protected by secure, role-based access.
          </p>
        </div>
      </section>
    </main>
  );
}
