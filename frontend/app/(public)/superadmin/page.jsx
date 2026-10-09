"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "../../../components/shared/Button";
import InteractiveGrid from "../../../components/shared/InteractiveGrid";
import PasswordInput from "../../../components/shared/PasswordInput";
import authService, { takeLoginNotice } from "../../../services/authService";

// Chrome paints autofilled fields light blue; keep them white like the rest.
const AUTOFILL =
  "[&:-webkit-autofill]:[-webkit-text-fill-color:#0f172a] [&:-webkit-autofill]:shadow-[inset_0_0_0_1000px_#ffffff]";

function ShieldIcon({ className }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 3l8 3v6c0 4.5-3.2 8.2-8 9-4.8-.8-8-4.5-8-9V6l8-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

// Orbit tones: the same animation is drawn twice, once clipped to each half of
// the page. On the dark half it is light, on the light half it is dark.
const TONES = {
  onDark: {
    ringOuter: "border-white/25",
    ringMid: "border-white/15",
    ringInner: "border-[#d4a853]/40",
    chip: "border-white/20 bg-[#eef2fb] text-[#0a1a33]",
    chipAccent: "border-[#d4a853] bg-[#d4a853] text-[#0a1a33]",
    dot: "bg-[#d4a853]",
    dotAlt: "bg-white",
    chipDot: "bg-[#0a1a33]",
    core: "bg-[#d4a853] text-[#0a1a33]",
    coreRing: "border-[#d4a853]/40",
  },
  onLight: {
    ringOuter: "border-[#0a1a33]/25",
    ringMid: "border-[#0a1a33]/15",
    ringInner: "border-[#0a1a33]/35",
    chip: "border-[#0a1a33] bg-[#0a1a33] text-white",
    chipAccent: "border-[#0a1a33] bg-[#16294a] text-[#e8cf9a]",
    dot: "bg-[#0a1a33]",
    dotAlt: "bg-[#0a1a33]/60",
    chipDot: "bg-[#d4a853]",
    core: "bg-[#0a1a33] text-white",
    coreRing: "border-[#0a1a33]/30",
  },
};

function Orbit({ tone, clip }) {
  const t = TONES[tone];
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[5] hidden lg:block"
      style={{ clipPath: clip }}
    >
      <div className="absolute left-1/2 top-1/2 -ml-[190px] -mt-[190px] h-[380px] w-[380px] scale-[0.72]">
        <div className={`absolute inset-0 rounded-full border border-dashed ${t.ringOuter}`} />
        <div className={`absolute inset-[70px] rounded-full border ${t.ringMid}`} />
        <div className={`absolute inset-[125px] rounded-full border ${t.ringInner}`} />

        {/* outer orbit */}
        <div className="absolute inset-0 animate-spin [animation-duration:60s]">
          {[
            [0, "Organizations"],
            [120, "Couriers"],
            [240, "Channels"],
          ].map(([angle, label]) => (
            <div
              key={label}
              className="absolute left-1/2 top-1/2 h-0 w-0"
              style={{ transform: `rotate(${angle}deg) translateY(-190px)` }}
            >
              <div className="absolute h-0 w-0" style={{ transform: `rotate(${-angle}deg)` }}>
                <div className="absolute h-0 w-0 animate-spin [animation-direction:reverse] [animation-duration:60s]">
                  <span
                    className={`absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium ${t.chip}`}
                  >
                    <span className={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${t.chipDot}`} />
                    {label}
                  </span>
                </div>
              </div>
            </div>
          ))}
          <span className={`absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ${t.dot}`} />
        </div>

        {/* inner orbit */}
        <div className="absolute inset-0 animate-spin [animation-direction:reverse] [animation-duration:40s]">
          {[
            [60, "Orders"],
            [240, "Users"],
          ].map(([angle, label]) => (
            <div
              key={label}
              className="absolute left-1/2 top-1/2 h-0 w-0"
              style={{ transform: `rotate(${angle}deg) translateY(-120px)` }}
            >
              <div className="absolute h-0 w-0" style={{ transform: `rotate(${-angle}deg)` }}>
                <div className="absolute h-0 w-0 animate-spin [animation-duration:40s]">
                  <span
                    className={`absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium ${t.chipAccent}`}
                  >
                    {label}
                  </span>
                </div>
              </div>
            </div>
          ))}
          <span className={`absolute left-1/2 top-[70px] h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${t.dotAlt}`} />
        </div>

        {/* core */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <span className={`absolute -inset-3 rounded-full border ${t.coreRing}`} />
          <span className={`relative flex h-20 w-20 items-center justify-center rounded-full ${t.core}`}>
            <ShieldIcon className="h-9 w-9" />
          </span>
        </div>
      </div>
    </div>
  );
}

export default function SuperAdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Left by lib/sessionGuard.js when the session expired.
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
    <main className="relative grid h-screen overflow-hidden lg:grid-cols-2">
      {/* Left: text, dark theme */}
      <section className="relative hidden items-center overflow-hidden bg-[#0a1a33] px-16 lg:flex xl:px-24">
        <InteractiveGrid
          base="255,255,255"
          baseAlpha={0.06}
          glow="212,168,83"
          glowAlpha={0.6}
        />
        <div className="relative z-10 max-w-sm">
          <p className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.25em] text-[#d4a853]">
            <span className="h-px w-8 bg-[#d4a853]/60" />
            OMS &middot; Control Center
          </p>
          <h2 className="mt-4 text-4xl font-semibold leading-[1.1] text-white">
            One console.
            <span className="block text-[#d4a853]">Every tenant.</span>
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-slate-400">
            Onboard organizations, wire up couriers and channels, and control
            who gets in, all from the same place.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-slate-300">
            {[
              "Create, suspend and manage every tenant",
              "Configure couriers and sales channels",
              "Role-based access for every user",
            ].map((t) => (
              <li key={t} className="flex items-center gap-3">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#d4a853]" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Right: sign in, light theme */}
      <section className="relative flex items-center justify-center overflow-hidden bg-slate-50 px-4 lg:justify-end lg:pl-16 lg:pr-12 xl:pr-20">
        <InteractiveGrid
          base="10,26,51"
          baseAlpha={0.07}
          glow="180,130,40"
          glowAlpha={0.5}
        />
        {/* decorative circles, same navy/gold as the text side */}
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#0a1a33]" />
        <div className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full border border-[#d4a853]/50" />
        <div className="pointer-events-none absolute right-52 top-14 h-5 w-5 rounded-full bg-[#d4a853]" />
        <div className="pointer-events-none absolute right-72 top-32 h-14 w-14 rounded-full border-2 border-[#0a1a33]/25" />
        <div className="pointer-events-none absolute -bottom-20 -right-16 h-56 w-56 rounded-full bg-[#0a1a33]" />
        <div className="pointer-events-none absolute bottom-24 right-6 h-8 w-8 rounded-full bg-[#d4a853]/80" />
        <div className="pointer-events-none absolute -bottom-10 right-44 h-24 w-24 rounded-full border-2 border-[#0a1a33]/20" />
        <div className="relative z-10 w-full max-w-sm">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0a1a33] text-[#d4a853]">
              <ShieldIcon className="h-6 w-6" />
            </span>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[#0a1a33]">
              OMS &middot; Control Center
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-300/50">
            <h1 className="text-2xl font-semibold text-slate-900">Super Admin</h1>
            <p className="mt-1 text-sm text-slate-500">
              Restricted access. Sign in to continue.
            </p>

            <form onSubmit={onSubmit} className="mt-7 space-y-5">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-slate-700">
                  Admin email
                </span>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                      <rect x="2.5" y="4.5" width="15" height="11" rx="2" />
                      <path d="M3 6l7 5 7-5" />
                    </svg>
                  </span>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="admin@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={`w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-[#0a1a33] focus:ring-4 focus:ring-[#0a1a33]/10 ${AUTOFILL}`}
                  />
                </div>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-slate-700">
                  Password
                </span>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 z-10 flex items-center text-slate-400">
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                      <rect x="4" y="9" width="12" height="8" rx="2" />
                      <path d="M7 9V6.5a3 3 0 016 0V9" />
                    </svg>
                  </span>
                  <PasswordInput
                    required
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    className={`!rounded-lg !border-slate-300 !bg-white !py-2.5 !pl-10 text-slate-900 placeholder-slate-400 focus:!border-[#0a1a33] focus:!ring-4 focus:!ring-[#0a1a33]/10 ${AUTOFILL}`}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </label>

              {error ? (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              ) : null}

              <Button
                type="submit"
                loading={loading}
                className="w-full !rounded-lg !bg-[#0a1a33] !py-2.5 hover:!bg-[#16294a]"
              >
                Sign in to console
              </Button>
            </form>
          </div>
        </div>
      </section>

      {/* Orbit centered on the seam: light on the dark half, dark on the light half */}
      <Orbit tone="onDark" clip="inset(0 50% 0 0)" />
      <Orbit tone="onLight" clip="inset(0 0 0 50%)" />
    </main>
  );
}
