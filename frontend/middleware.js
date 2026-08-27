import { NextResponse } from "next/server";

const PUBLIC_PATHS = ["/", "/login"];

/** Super-admin UI — hidden entirely unless client IP is allowlisted. */
const SUPER_ADMIN_PATHS = ["/superadmin", "/admin", "/system-health", "/tenants"];

function parseAllowlist() {
  const raw = process.env.ADMIN_IP_ALLOWLIST || "127.0.0.1,::1";
  return new Set(
    raw
      .split(",")
      .map((ip) => ip.trim())
      .filter(Boolean),
  );
}

function getClientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  // Local `next dev` often has no forwarded headers.
  return request.ip || "127.0.0.1";
}

function isSuperAdminPath(pathname) {
  return SUPER_ADMIN_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function middleware(request) {
  const { pathname } = request.nextUrl;

  if (isSuperAdminPath(pathname)) {
    const allowlist = parseAllowlist();
    const clientIp = getClientIp(request);
    if (!allowlist.has(clientIp)) {
      // Look like the route does not exist (no login page flash).
      return NextResponse.rewrite(new URL("/not-found-admin", request.url));
    }
  }

  if (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  // Auth token lives in localStorage (client). Middleware only soft-redirects
  // unauthenticated cookie sessions when we add cookie-based auth later.
  // Layout-level ProtectedRoute enforces JWT presence today.
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
