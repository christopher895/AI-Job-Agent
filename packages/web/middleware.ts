import { NextResponse } from "next/server";
import { auth } from "./auth";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;
  const isPublicPage = pathname === "/login";
  const isAuthApi = pathname.startsWith("/api/auth");
  const isApiRoute = pathname.startsWith("/api/");

  if (isAuthApi) {
    return;
  }

  if (isLoggedIn) {
    // Already signed in — don't show the login page (e.g. after hitting back post-sign-in).
    if (isPublicPage) {
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
