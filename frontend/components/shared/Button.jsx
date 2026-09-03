"use client";

export function Spinner({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`h-4 w-4 animate-spin ${className}`} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// loading forces disabled and swaps in a spinner ahead of the label, so
// every button in the app gets the same "operation is running" feedback
// for free instead of each call site inventing its own "…"-suffixed text.
// The label stays on screen (not replaced) so the button doesn't
// visually jump width when loading starts.
export default function Button({
  children,
  type = "button",
  variant = "primary",
  disabled = false,
  loading = false,
  className = "",
  ...props
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
  const variants = {
    primary: "bg-brand-800 text-white hover:bg-brand-900 focus:ring-brand-700",
    secondary:
      "border border-surface-border bg-white text-slate-800 hover:bg-slate-50 focus:ring-brand-500",
    danger: "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500",
  };

  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${base} ${variants[variant] || variants.primary} ${className}`}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}
