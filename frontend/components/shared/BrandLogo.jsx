// The OMS logo (user, 2026-11-27: "use it anywhere we use icons or logos").
// The one mark the app shows for itself - headers, sign-in pages, the OMS
// Courier tile, the landing page. File: public/brand/oms-logo.png (round,
// transparent corners; the original is oms-logo-original.png). The
// browser-tab / home-screen icons are app/icon.png, app/favicon.ico and
// app/apple-icon.png, made from the same file.
export const BRAND_LOGO_SRC = "/brand/oms-logo.png";

export default function BrandLogo({ className = "h-8 w-8", alt = "OMS" }) {
  return (
    // A plain img: a small static file, no next/image config needed.
    <img
      src={BRAND_LOGO_SRC}
      alt={alt}
      draggable={false}
      className={`shrink-0 select-none rounded-full object-contain ${className}`}
    />
  );
}
