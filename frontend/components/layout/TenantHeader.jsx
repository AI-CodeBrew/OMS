"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import Dropdown from "../shared/Dropdown";
import authService from "../../services/authService";
import useAuthStore from "../../store/authStore";
import { MODULES } from "./moduleNav";

function BellIcon({ className }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path
        d="M10 2.5c-2.2 0-4 1.8-4 4v2.3c0 .5-.2 1-.5 1.4L4.5 11.5A1 1 0 0 0 5.3 13h9.4a1 1 0 0 0 .8-1.6L14.5 10.2a2 2 0 0 1-.5-1.4V6.5c0-2.2-1.8-4-4-4Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M8.3 16a1.8 1.8 0 0 0 3.4 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({ className }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path d="M5 7.5 10 12.5 15 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function TenantHeader({ activeModule }) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  function logout() {
    authService.logout();
    router.replace("/login");
  }

  return (
    <header className="sticky top-0 z-40 bg-brand-800">
      <div className="grid h-16 grid-cols-[1fr_auto_1fr] items-center px-6">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold tracking-tight text-white">OMS</span>
        </div>

        <nav className="flex items-center gap-1 text-sm">
          {MODULES.map((m) => {
            const isActive = m.key === activeModule;
            return (
              <Link
                key={m.key}
                href={m.href}
                className={`whitespace-nowrap rounded-md border-b-2 px-3 py-2 font-medium transition ${
                  isActive
                    ? "border-white bg-white/15 text-white"
                    : "border-transparent text-brand-100 hover:bg-white/10 hover:text-white"
                }`}
              >
                {m.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center justify-end gap-4">
          <button
            type="button"
            className="relative rounded-md p-2 text-brand-100 hover:bg-white/10 hover:text-white"
            title="Notifications"
          >
            <BellIcon className="h-5 w-5" />
          </button>

          <Dropdown
            align="right"
            trigger={
              <span className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-white hover:bg-white/10">
                {user?.email}
                <ChevronIcon className="h-4 w-4 text-brand-100" />
              </span>
            }
            items={[
              { key: "settings", label: "Settings", onClick: () => router.push("/settings") },
              { key: "divider", divider: true },
              { key: "logout", label: "Log out", onClick: logout },
            ]}
          />
        </div>
      </div>
    </header>
  );
}
