"use client";

export default function EditableField({ label, value, onChange, editing, type = "text" }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      {editing ? (
        <input
          type={type}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="mt-0.5 w-full rounded-md border border-surface-border px-2 py-1 text-sm outline-none focus:border-brand-500"
        />
      ) : (
        <div className="text-sm text-slate-900">{value || "N/A"}</div>
      )}
    </div>
  );
}
