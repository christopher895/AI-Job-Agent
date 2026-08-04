# Private auth for the web app + agent API

## Problem

The app is currently fully unauthenticated — the web app (Next.js) and the
agent API (Express) are both reachable by anyone who has the URL, and the
agent API's URL is additionally baked into the client JS bundle via
`NEXT_PUBLIC_API_URL`, so it can be discovered even by someone who only knows
the web app's URL. Christopher wants only himself able to access his data
(master resume, tailored resumes, applied-jobs log, preferences). This is
step one of a two-part effort; a separate, later spec will cover a public
playground where other people can try the tailoring pipeline with their own
LLM token — that is explicitly out of scope here and must not share
infrastructure in a way that complicates it, but doesn't need to be
designed for yet either.

## Scope

- `packages/web/middleware.ts` — new. Guards every page except `/login`,
  redirecting unauthenticated visitors there.
- `packages/web/app/api/auth/[...nextauth]/route.ts` (or Auth.js v5
  equivalent path) — new. Google OAuth provider, single-email allowlist via
  a `signIn` callback.
- `packages/web/app/login/page.tsx` — new. "Sign in with Google" page.
- `packages/web/app/api/proxy/[...path]/route.ts` — new. Catch-all route
  handler: verifies the session server-side, forwards the request to the
  agent API with `INTERNAL_API_SECRET` attached, streams the response back.
- `packages/web/lib/api.ts` — base URL changes from
  `process.env.NEXT_PUBLIC_API_URL` (public, client-side) to a relative
  `/api/proxy` path (same-origin, no public env var needed). Add a shared
  401 handler that redirects to `/login`.
- `packages/agent/src/api/index.ts` — CORS middleware replaced with a
  shared-secret check: reject any request whose `X-Internal-Secret` header
  doesn't match `INTERNAL_API_SECRET`. Origin-based CORS goes away since the
  only caller is now the Next.js server, not a browser.
- `.env.example` (both packages) — add `AUTH_SECRET`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `AUTH_ALLOWED_EMAIL`, `INTERNAL_API_SECRET`,
  `AGENT_API_URL`; remove `NEXT_PUBLIC_API_URL`.
- Railway (both environments) — set the new env vars, delete
  `NEXT_PUBLIC_API_URL`, register `localhost:3000` and both Railway web URLs
  as authorized redirect URIs on the Google OAuth client.

Out of scope:
- The public playground / bring-your-own-token flow for other users —
  separate future spec.
- Any change to what data exists or how it's structured — this is purely an
  access-control layer in front of the existing app.
- Rate limiting, audit logging, or multi-device session management beyond
  what Auth.js provides by default.

## Design

### Architecture: BFF proxy

The browser currently calls the agent API directly
(`packages/web/lib/api.ts` → `fetch(NEXT_PUBLIC_API_URL + path)` from
client components). Gating only the Next.js pages would leave the agent API
itself wide open to anyone who extracts its URL from the client bundle.

Instead, the Next.js server becomes the only party that talks to the agent
API. The browser calls same-origin `/api/proxy/*` route handlers; those
handlers verify the Auth.js session server-side, then forward the request
to `AGENT_API_URL` (now a private, server-only env var) with
`X-Internal-Secret: $INTERNAL_API_SECRET` attached. The agent API trusts
that header and nothing else — no more origin-based CORS, since its only
caller is a server, not a browser.

This means:
- A visitor with no session gets rejected at the proxy, before any agent
  API call happens.
- Someone who finds the agent API's real Railway URL and hits it directly
  gets a 401 — the shared secret isn't obtainable client-side.
- `packages/web/lib/api.ts` keeps its existing function signatures; only
  the base URL and a 401 interceptor change, so the 8 client components
  that import it are unaffected.

### Sign-in: Google OAuth, single-email allowlist

Auth.js (NextAuth v5) with the Google provider. In the `signIn` callback,
reject unless `profile.email === process.env.AUTH_ALLOWED_EMAIL`. Session
strategy: JWT, stored in an httpOnly cookie, 30-day expiry (Auth.js's
default rolling-session behavior extends it on use).

Prerequisite (manual, Christopher does this once): create an OAuth client
in Google Cloud Console, add authorized redirect URIs for
`http://localhost:3000/api/auth/callback/google` and the production/staging
web URLs' equivalents.

### Middleware

`packages/web/middleware.ts` checks for a valid Auth.js session on every
request except `/login` and the Auth.js internal routes
(`/api/auth/*`); unauthenticated requests are redirected to `/login`. The
proxy routes (`/api/proxy/*`) additionally re-verify the session
server-side (not just trusting middleware ran) since they're the actual
security boundary.

### Agent API changes

Replace the hand-rolled CORS middleware in `packages/agent/src/api/index.ts`
with:
```ts
app.use((req, res, next) => {
  if (req.headers["x-internal-secret"] !== process.env.INTERNAL_API_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
});
```
`WEB_URL` / `APP_URL` env vars remain (still used for email links), but are
no longer used for CORS origin checks.

### Error handling

- Expired/missing session hitting a page → middleware redirect to
  `/login`.
- Expired session mid-session (cookie lapses while a tab is open) → a
  proxy call returns 401 → `lib/api.ts`'s fetch wrapper catches 401 and
  redirects to `/login`.
- Direct hit to the agent API without the correct secret → 401, regardless
  of caller.
- Google account not matching `AUTH_ALLOWED_EMAIL` → sign-in rejected,
  bounced back to `/login` with an error message, no session issued.

### Local dev

Same Google OAuth client works for `localhost:3000` (Google allows multiple
redirect URIs per client). `INTERNAL_API_SECRET` can be any shared
placeholder value across the local `packages/web/.env` and
`packages/agent/.env` files — it only needs to match between the two local
processes, not production.

### Testing

- Unit: the `AUTH_ALLOWED_EMAIL` check in the `signIn` callback (allowed
  email passes, any other email rejected); the agent API's shared-secret
  middleware (correct secret passes, missing/wrong secret → 401).
- Manual, via `/run`: full sign-in flow with the allowed Google account;
  confirm a non-allowed account is rejected; confirm session persists
  across a page reload; confirm visiting a protected page while signed out
  redirects to `/login`; confirm `curl`-ing the agent API directly (no
  secret header) returns 401; confirm the web app still functions
  end-to-end through the proxy (tailor a resume, edit it, mark applied).
