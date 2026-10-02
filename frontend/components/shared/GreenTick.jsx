// Shared "this one is active/connected" indicator - same mark used across
// the Integrations page, the store switcher and the super-admin Stores
// list, so the meaning stays consistent everywhere it shows up.
export default function GreenTick({ className = "h-4 w-4" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={`shrink-0 text-green-500 ${className}`} aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="currentColor" opacity="0.15" />
      <path
        d="M6.5 10.2 9 12.5l4.5-5.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
