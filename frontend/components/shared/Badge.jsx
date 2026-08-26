"use client";

const VARIANTS = {
  neutral: "bg-slate-100 text-slate-700",
  brand: "bg-brand-100 text-brand-700",
  green: "bg-green-100 text-green-700",
  red: "bg-red-100 text-red-700",
  amber: "bg-amber-100 text-amber-700",
};

export default function Badge({ children, variant = "neutral", className = "" }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${VARIANTS[variant] || VARIANTS.neutral} ${className}`}
    >
      {children}
    </span>
  );
}
