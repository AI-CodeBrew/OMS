// Logo marks for every integration, shared by the tenant Integrations
// page and the super admin's so a store and the platform team see the
// same mark for the same service.

export function ShopifyLogo({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M17.3 5.3c-.1-.1-.3-.2-.4-.2l-1.5-.1-1.1-1.1c-.1-.1-.3-.1-.4-.1l-.6.2c-.1-.3-.3-.6-.5-.8-.4-.5-1-.7-1.6-.6-.1 0-.2 0-.3.1-.2-.2-.4-.4-.7-.5-1.4-.5-2.9.5-3.5 2.4l-1.3.4c-.4.1-.4.1-.5.5L3.5 19l10.4 2 5.6-1.2c0-.1-2.1-14.4-2.2-14.5ZM11.4 4c-.4.1-.9.3-1.3.5.1-.5.4-1 .8-1.3.4.2.5.5.5.8ZM10 3.1c.1 0 .2 0 .3.1-.5.4-.9 1-1.1 1.7l-1 .3c.3-1 1-1.9 1.8-2.1Zm-.7 4.2c0 .1-1.3.4-1.3.4S7.3 6.4 8.6 6.1c.3-.9.7-1.6 1.2-2 .1 0 .1-.1.2-.1.4.5.6 1.2.6 2-.4.1-.9.2-1.3.3Zm2.3-.7c-.4.1-.8.2-1.3.4.1-.6.2-1.2-.1-1.7l.1-.1c.6-.1 1 .5 1.3 1.4Z"
        fill="#95BF47"
      />
      <path
        d="M16.9 5.1l-1.5-.1-1.1-1.1c-.1-.1-.3-.1-.4-.1l-.6.2c-.1-.3-.3-.6-.5-.8-.4-.5-1-.7-1.6-.6l-.5 15.9 5.6-1.2c0-.1-2.1-14.4-2.2-14.5.4 0 .8.1.8.1Z"
        fill="#5E8E3E"
      />
      <path
        d="M12.5 8.9l-.6 1.8s-.6-.3-1.4-.3c-1.1 0-1.2.7-1.2.9 0 .9 2.5 1.3 2.5 3.6 0 1.8-1.1 2.9-2.6 2.9-1.8 0-2.8-1.1-2.8-1.1l.5-1.6s1 .9 1.9.9c.6 0 .8-.5.8-.8 0-1.2-2.1-1.3-2.1-3.4 0-1.7 1.2-3.4 3.7-3.4.9.1 1.3.5 1.3.5Z"
        fill="#FFFFFE"
      />
    </svg>
  );
}

export function SmartlaneLogo({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M3 8.5 12 4l9 4.5-9 4.5-9-4.5Z" fill="#111827" />
      <path
        d="M3 15.5 12 11l9 4.5-9 4.5-9-4.5Z"
        fill="none"
        stroke="#111827"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Generic on purpose - OMS Courier is the platform's own service, so it
// doesn't wear the logo of the courier account behind it.
export function OmsCourierLogo({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M2 7h11v9H2z" stroke="#111827" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M13 10h4l4 3v3h-8z" stroke="#111827" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="6.5" cy="18" r="1.8" stroke="#111827" strokeWidth="1.5" />
      <circle cx="17.5" cy="18" r="1.8" stroke="#111827" strokeWidth="1.5" />
    </svg>
  );
}

// Stacked on two lines so the 10-char name still fits inside the 48px tile.
export function BarqRaftarWordmark({ className }) {
  return (
    <span
      className={`flex flex-col items-center font-black italic leading-none tracking-tight ${className || ""}`}
    >
      <span className="text-red-600">Barq</span>
      <span className="text-slate-900">Raftar</span>
    </span>
  );
}

export function PostExWordmark({ className }) {
  return (
    <span className={`font-extrabold tracking-tight ${className || ""}`}>
      <span className="text-blue-800">POST</span>
      <span className="text-red-600">EX</span>
    </span>
  );
}

// Badge = the small white rounded-square icon tile. Shared by the tenant
// Integrations page and the super admin's, so both render the exact same
// logo mark.
export function Badge({ Logo, size = 12, wordmark = false }) {
  const dim = size === 12 ? "h-12 w-12" : size === 14 ? "h-14 w-14" : "h-11 w-11";
  return (
    <span
      className={`flex ${dim} shrink-0 items-center justify-center rounded-xl border border-surface-border bg-white shadow-sm ${
        wordmark ? "px-2" : ""
      }`}
    >
      {wordmark ? <Logo className="text-[11px]" /> : <Logo className="h-6 w-6" />}
    </span>
  );
}
