import { NextResponse } from "next/server";
import { auth } from "./auth";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;
  const isPublicPage = pathname === "/login" || pathname === "/playground";
  const isAuthApi = pathname.startsWith("/api/auth");
  const isPublicApi = pathname.startsWith("/api/playground");
  const isApiRoute = pathname.startsWith("/api/");

  if (isAuthApi || isPublicApi) {
    return;
  }

  if (isLoggedIn) {
    // Already signed in — don't show the login page (e.g. after hitting back post-sign-in).
    // /playground stays reachable while signed in; it's a public demo, not an auth page.
    if (pathname === "/login") {
      return NextResponse.redirect(new URL("/", req.nextUrl));
    }
    return;
  }

  if (isPublicPage) {
    return;
  }

  if (isApiRoute) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return NextResponse.redirect(new URL("/login", req.nextUrl));
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|apple-icon.png|icon.svg).*)"],
};
