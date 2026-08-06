import { NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login"];

export function middleware(request) {
  const { pathname } = request.nextUrl;

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
