"use client";

export default function Checkbox({ checked, onChange, indeterminate = false, ...props }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      ref={(el) => {
        if (el) el.indeterminate = indeterminate;
      }}
      className="h-4 w-4 rounded border-surface-border text-brand-600 focus:ring-brand-500"
      {...props}
    />
  );
}
