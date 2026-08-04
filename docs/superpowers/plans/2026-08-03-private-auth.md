# Private Auth (Google Sign-In + Locked-Down Agent API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the web app and agent API behind Google OAuth restricted to Christopher's email, with the Next.js server acting as the only caller of the agent API so the agent's URL and credentials never reach the browser.

**Architecture:** Next.js server-side session (Auth.js v5, Google provider, JWT cookie) protects every page via middleware. A catch-all Next.js route handler (`/api/proxy/*`) re-checks the session and forwards to the agent API with a private shared secret (`X-Internal-Secret`) that only the two servers know. The agent API rejects anything without that header, replacing today's origin-based CORS.

**Tech Stack:** next-auth (Auth.js) v5, Express (existing), no new test framework — pure-logic tests follow this repo's existing pattern of standalone `tsx` scripts with `console.log` + `process.exit(pass ? 0 : 1)` (see `packages/agent/src/ai/test-format.ts`), run via `npm run test:<name>`.

## Global Constraints

- Single allowed identity: sign-in must reject every Google account except the one in `AUTH_ALLOWED_EMAIL` — no multi-user support here (that's a separate future project).
- The agent API must reject any request lacking a valid `X-Internal-Secret` header, regardless of origin — this replaces CORS, it does not sit alongside it.
- `NEXT_PUBLIC_API_URL` must be fully removed (env var, Dockerfile build-arg, and all references) — the agent's URL becomes a private, server-only value.
- Session cookie: JWT strategy, 30-day `maxAge`, httpOnly (Auth.js default).
- npm workspaces monorepo (`packages/web`, `packages/agent`) — install deps with `--workspace=packages/<name>` from the repo root.
- No unrelated refactors: `packages/web/lib/api.ts`'s existing per-call error-handling duplication (`request`/`requestBlob`/`requestBlobWithFilename` each parse errors inline) is preserved as-is; the 401 check is added to each of the three, not factored into a new shared helper.
- Work happens in an isolated git worktree (branch `feat/auth-lockdown` created off `main`; the design spec and this plan are already committed there).

---

### Task 1: Email allowlist function (web)

**Files:**
- Create: `packages/web/lib/auth-allowlist.ts`
- Create: `packages/web/lib/test-auth-allowlist.ts`
- Modify: `packages/web/package.json` (add `tsx` devDependency, add `test:auth-allowlist` script)

**Interfaces:**
- Produces: `isAllowedEmail(email: string | null | undefined): boolean`, exported from `packages/web/lib/auth-allowlist.ts`. Reads `process.env.AUTH_ALLOWED_EMAIL`. Task 3's `signIn` callback consumes this.

- [ ] **Step 1: Install `tsx` as a devDependency in `packages/web` and add the test script**

Run from repo root:
```bash
npm install --save-dev --workspace=packages/web tsx@^4.16.2
```

Edit `packages/web/package.json`, add to `"scripts"`:
```json
"test:auth-allowlist": "tsx lib/test-auth-allowlist.ts"
```

- [ ] **Step 2: Write the failing test**

Create `packages/web/lib/test-auth-allowlist.ts`:
```ts
import { isAllowedEmail } from "./auth-allowlist";

process.env.AUTH_ALLOWED_EMAIL = "me@example.com";

const cases: [string | null | undefined, boolean][] = [
  ["me@example.com", true],
  ["ME@EXAMPLE.COM", true],
  ["someoneelse@example.com", false],
  [null, false],
  [undefined, false],
  ["", false],
];

let pass = true;
for (const [input, expected] of cases) {
  const actual = isAllowedEmail(input);
  const ok = actual === expected;
  if (!ok) pass = false;
  console.log(`${ok ? "✓" : "✗"} isAllowedEmail(${JSON.stringify(input)}) = ${actual} (expected ${expected})`);
}

console.log(pass ? "\n✓ auth-allowlist test PASSED" : "\n✗ auth-allowlist test FAILED");
process.exit(pass ? 0 : 1);
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:auth-allowlist --workspace=packages/web`
Expected: FAIL — `Cannot find module './auth-allowlist'`

- [ ] **Step 4: Write minimal implementation**

Create `packages/web/lib/auth-allowlist.ts`:
```ts
export function isAllowedEmail(email: string | null | undefined): boolean {
  const allowed = process.env.AUTH_ALLOWED_EMAIL;
  if (!allowed || !email) return false;
  return email.toLowerCase() === allowed.toLowerCase();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:auth-allowlist --workspace=packages/web`
Expected: all six cases print `✓`, final line `✓ auth-allowlist test PASSED`, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add packages/web/lib/auth-allowlist.ts packages/web/lib/test-auth-allowlist.ts packages/web/package.json packages/web/package-lock.json package-lock.json
git commit -m "feat: add email-allowlist check for auth"
```

---

### Task 2: Internal-secret middleware (agent)

**Files:**
- Create: `packages/agent/src/api/internal-secret.ts`
- Create: `packages/agent/src/api/test-internal-secret.ts`
- Modify: `packages/agent/package.json` (add `test:internal-secret` script)

**Interfaces:**
- Produces: `requireInternalSecret(req, res, next): void`, an Express middleware exported from `packages/agent/src/api/internal-secret.ts`. Reads `process.env.INTERNAL_API_SECRET`, compares to the `x-internal-secret` request header. Task 7 mounts this on `/api` in `packages/agent/src/index.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/agent/src/api/test-internal-secret.ts`:
```ts
import type { Request, Response } from "express";
import { requireInternalSecret } from "./internal-secret";

process.env.INTERNAL_API_SECRET = "test-secret";

function run(headerValue: string | undefined): { calledNext: boolean; status: number | null } {
  let calledNext = false;
  let status: number | null = null;
  const req = {
    headers: headerValue !== undefined ? { "x-internal-secret": headerValue } : {},
  } as unknown as Request;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json() {
      return this;
    },
  } as unknown as Response;
  requireInternalSecret(req, res, () => {
    calledNext = true;
  });
  return { calledNext, status };
}

const correct = run("test-secret");
const wrong = run("nope");
const missing = run(undefined);

console.log("correct secret:", correct, "| wrong secret:", wrong, "| missing secret:", missing);

const pass =
  correct.calledNext === true &&
  correct.status === null &&
  wrong.calledNext === false &&
  wrong.status === 401 &&
  missing.calledNext === false &&
  missing.status === 401;

console.log(pass ? "\n✓ internal-secret test PASSED" : "\n✗ internal-secret test FAILED");
process.exit(pass ? 0 : 1);
```

Edit `packages/agent/package.json`, add to `"scripts"`:
```json
"test:internal-secret": "tsx src/api/test-internal-secret.ts"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:internal-secret --workspace=packages/agent`
Expected: FAIL — `Cannot find module './internal-secret'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/agent/src/api/internal-secret.ts`:
```ts
import type { Request, Response, NextFunction } from "express";

export function requireInternalSecret(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.INTERNAL_API_SECRET;
  const provided = req.headers["x-internal-secret"];
  if (!expected || provided !== expected) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:internal-secret --workspace=packages/agent`
Expected: `✓ internal-secret test PASSED`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/api/internal-secret.ts packages/agent/src/api/test-internal-secret.ts packages/agent/package.json
git commit -m "feat: add shared-secret middleware for agent API"
```

---

### Task 3: Auth.js config + Google provider (web)

**Files:**
- Modify: `packages/web/package.json` (add `next-auth` dependency)
- Create: `packages/web/auth.ts`
- Create: `packages/web/app/api/auth/[...nextauth]/route.ts`

**Interfaces:**
- Consumes: `isAllowedEmail` from `packages/web/lib/auth-allowlist.ts` (Task 1).
- Produces: `auth`, `signIn`, `signOut`, `handlers` exported from `packages/web/auth.ts`. Task 4 (login/sign-out), Task 5 (middleware), and Task 6 (proxy) all consume `auth` (and Task 4 additionally consumes `signIn`/`signOut`).

- [ ] **Step 1: Install `next-auth`**

Run from repo root:
```bash
npm install --workspace=packages/web next-auth@5.0.0-beta.32
```

- [ ] **Step 2: Write `auth.ts`**

Create `packages/web/auth.ts`:
```ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { isAllowedEmail } from "./lib/auth-allowlist";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  callbacks: {
    async signIn({ profile }) {
      return isAllowedEmail(profile?.email);
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});
```

- [ ] **Step 3: Write the route handler**

Create `packages/web/app/api/auth/[...nextauth]/route.ts`:
```ts
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 4: Verify it builds**

Run: `npm run build --workspace=packages/web`
Expected: build succeeds (this will only fully exercise the OAuth flow once `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`AUTH_SECRET` are set — Task 9 covers that end-to-end check). A missing `AUTH_SECRET` at build time is fine; Auth.js only requires it at runtime.

- [ ] **Step 5: Commit**

```bash
git add packages/web/auth.ts packages/web/app/api/auth packages/web/package.json packages/web/package-lock.json package-lock.json
git commit -m "feat: add Auth.js config with Google provider and email allowlist"
```

---

### Task 4: Login page + sign-out (web)

**Files:**
- Create: `packages/web/app/login/page.tsx`
- Create: `packages/web/lib/actions.ts`
- Modify: `packages/web/components/Nav.tsx:1-125` (wire the existing chevron button to sign out)

**Interfaces:**
- Consumes: `signIn`, `signOut` from `packages/web/auth.ts` (Task 3).
- Produces: `signOutAction(): Promise<void>` server action exported from `packages/web/lib/actions.ts`, consumed by `Nav.tsx`.

- [ ] **Step 1: Write the login page**

Create `packages/web/app/login/page.tsx`:
```tsx
import { signIn } from "@/auth";

export default function LoginPage() {
  return (
    <div className="h-full w-full flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 w-full max-w-sm text-center">
        <h1 className="text-lg font-semibold text-gray-900 mb-1">Resume Tailor</h1>
        <p className="text-sm text-gray-500 mb-6">Sign in to continue</p>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="w-full rounded-lg bg-violet-600 px-4 py-2.5 text-white text-sm font-medium hover:bg-violet-700 transition-colors"
          >
            Sign in with Google
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the sign-out server action**

Create `packages/web/lib/actions.ts`:
```ts
"use server";

import { signOut } from "@/auth";

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
```

- [ ] **Step 3: Wire the sign-out action into `Nav.tsx`**

In `packages/web/components/Nav.tsx`, add the import at the top (after the existing `usePathname` import):
```ts
import { signOutAction } from "../lib/actions";
```

Replace the existing chevron button (currently inert) at the bottom of the file:
```tsx
        <button className="text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0">
          <ChevronUpIcon />
        </button>
```
with:
```tsx
        <button
          onClick={() => signOutAction()}
          title="Sign out"
          className="text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0"
        >
          <ChevronUpIcon />
        </button>
```

- [ ] **Step 4: Verify it builds**

Run: `npm run build --workspace=packages/web`
Expected: build succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/web/app/login packages/web/lib/actions.ts packages/web/components/Nav.tsx
git commit -m "feat: add login page and wire sign-out button"
```

---

### Task 5: Middleware route protection (web)

**Files:**
- Create: `packages/web/middleware.ts`

**Interfaces:**
- Consumes: `auth` from `packages/web/auth.ts` (Task 3).

- [ ] **Step 1: Write the middleware**

Create `packages/web/middleware.ts`:
```ts
import { NextResponse } from "next/server";
import { auth } from "./auth";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;
  const isPublicPage = pathname === "/login";
  const isAuthApi = pathname.startsWith("/api/auth");
  const isApiRoute = pathname.startsWith("/api/");

  if (isLoggedIn || isPublicPage || isAuthApi) {
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
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build --workspace=packages/web`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/web/middleware.ts
git commit -m "feat: add middleware to gate pages and API routes behind auth"
```

---

### Task 6: BFF proxy route handler (web)

**Files:**
- Create: `packages/web/app/api/proxy/[...path]/route.ts`

**Interfaces:**
- Consumes: `auth` from `packages/web/auth.ts` (Task 3); env vars `AGENT_API_URL`, `INTERNAL_API_SECRET`.
- Produces: HTTP endpoint `/api/proxy/*` (any method), consumed by Task 8's `packages/web/lib/api.ts`.

- [ ] **Step 1: Write the proxy route handler**

Create `packages/web/app/api/proxy/[...path]/route.ts`:
```ts
import { NextRequest } from "next/server";
import { auth } from "@/auth";

const AGENT_API_URL = process.env.AGENT_API_URL ?? "http://localhost:3001/api";

async function handle(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  const session = await auth();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { path } = await params;
  const targetUrl = `${AGENT_API_URL}/${path.join("/")}${req.nextUrl.search}`;

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const body = hasBody ? await req.arrayBuffer() : undefined;

  const headers: Record<string, string> = {
    "X-Internal-Secret": process.env.INTERNAL_API_SECRET ?? "",
  };
  const contentType = req.headers.get("content-type");
  if (contentType) headers["Content-Type"] = contentType;

  const agentRes = await fetch(targetUrl, {
    method: req.method,
    headers,
    body: hasBody && body && body.byteLength > 0 ? body : undefined,
  });

  const resHeaders = new Headers();
  const outContentType = agentRes.headers.get("content-type");
  if (outContentType) resHeaders.set("content-type", outContentType);
  const disposition = agentRes.headers.get("content-disposition");
  if (disposition) resHeaders.set("content-disposition", disposition);

  return new Response(agentRes.body, { status: agentRes.status, headers: resHeaders });
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build --workspace=packages/web`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/web/app/api/proxy
git commit -m "feat: add BFF proxy route forwarding to the agent API"
```

---

### Task 7: Wire shared-secret middleware into the agent server

**Files:**
- Modify: `packages/agent/src/index.ts` (full file, shown below)

**Interfaces:**
- Consumes: `requireInternalSecret` from `packages/agent/src/api/internal-secret.ts` (Task 2).

- [ ] **Step 1: Replace the CORS middleware with the shared-secret check**

Replace the full contents of `packages/agent/src/index.ts`:
```ts
import "./polyfills";
import "./db/pool"; // load dotenv first
import express from "express";
import { initSchema } from "./db/schema";
import { startScheduler } from "./cron/scheduler";
import apiRouter from "./api/index";
import { requireInternalSecret } from "./api/internal-secret";

const app = express();

app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.use("/api", requireInternalSecret, apiRouter);

async function main() {
  await initSchema();
  startScheduler();

  const port = process.env.PORT ?? 3001;
  app.listen(port, () => {
    console.log(`Agent running on http://localhost:${port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

This drops the old origin-based CORS block entirely (no browser calls this server directly anymore) and mounts `requireInternalSecret` only under `/api`, leaving `/health` open for Railway's health checks.

- [ ] **Step 2: Manually verify locally**

In `packages/agent/.env`, set `INTERNAL_API_SECRET=local-dev-secret`. Start the agent:
```bash
npm run dev --workspace=packages/agent
```

In another terminal:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/health
# Expected: 200

curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/resumes
# Expected: 401 (no secret header)

curl -s -o /dev/null -w "%{http_code}\n" -H "X-Internal-Secret: local-dev-secret" http://localhost:3001/api/resumes
# Expected: 200
```

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/index.ts
git commit -m "feat: replace agent CORS with shared-secret check"
```

---

### Task 8: Point the web app at the proxy (web)

**Files:**
- Modify: `packages/web/lib/api.ts:1` and the three fetch functions (`request`, `requestBlob`, `requestBlobWithFilename`)

**Interfaces:**
- Consumes: `/api/proxy/*` endpoint (Task 6).

- [ ] **Step 1: Change the base URL**

In `packages/web/lib/api.ts`, replace line 1:
```ts
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";
```
with:
```ts
const API = "/api/proxy";
```

- [ ] **Step 2: Add 401 handling to `request`**

Replace:
```ts
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
```
with:
```ts
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = "/login";
    throw new Error("unauthorized");
  }
  if (!res.ok) {
```

- [ ] **Step 3: Add the same 401 handling to `requestBlob`**

Replace:
```ts
async function requestBlob(method: string, path: string, body?: unknown): Promise<Blob> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
```
with:
```ts
async function requestBlob(method: string, path: string, body?: unknown): Promise<Blob> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = "/login";
    throw new Error("unauthorized");
  }
  if (!res.ok) {
```

- [ ] **Step 4: Add the same 401 handling to `requestBlobWithFilename`**

Replace:
```ts
async function requestBlobWithFilename(
  method: string,
  path: string,
): Promise<{ blob: Blob; filename: string | null }> {
  const res = await fetch(`${API}${path}`, { method });
  if (!res.ok) {
```
with:
```ts
async function requestBlobWithFilename(
  method: string,
  path: string,
): Promise<{ blob: Blob; filename: string | null }> {
  const res = await fetch(`${API}${path}`, { method });
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = "/login";
    throw new Error("unauthorized");
  }
  if (!res.ok) {
```

- [ ] **Step 5: Verify it builds**

Run: `npm run build --workspace=packages/web`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/web/lib/api.ts
git commit -m "feat: route web app API calls through the auth proxy"
```

---

### Task 9: Env vars, Dockerfile cleanup, Google Cloud setup, and end-to-end verification

**Files:**
- Modify: `.env.example`
- Modify: `Dockerfile.web:13-18`
- Modify: `README.md:240`, `README.md:254`
- Modify: `CLAUDE.md` (Environment Variables section)

**Interfaces:** None (final integration task — no new code interfaces).

- [ ] **Step 1: Update `.env.example`**

Remove this line:
```
# Agent API URL — used by the web app to call the agent (baked in at Next.js build time)
NEXT_PUBLIC_API_URL=http://localhost:3001/api
```

Add in its place:
```
# Agent API URL — server-only; the web app's Next.js server proxies to this, the browser never sees it
AGENT_API_URL=http://localhost:3001/api

# Auth — Google sign-in restricted to a single email
# Generate with: openssl rand -base64 33
AUTH_SECRET=
# Set to true when deployed behind a reverse proxy (Railway) so Auth.js trusts the forwarded host
AUTH_TRUST_HOST=true
# From a Google Cloud OAuth client (console.cloud.google.com > APIs & Services > Credentials)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
# The only Google account allowed to sign in
AUTH_ALLOWED_EMAIL=zhanggopher895@gmail.com

# Shared secret between the web app's proxy and the agent API — any random string,
# must match between packages/web and packages/agent
INTERNAL_API_SECRET=
```

- [ ] **Step 2: Remove the `NEXT_PUBLIC_API_URL` build arg from `Dockerfile.web`**

In `Dockerfile.web`, delete these lines:
```dockerfile
# Next.js inlines NEXT_PUBLIC_* vars into the client bundle at build time, not
# runtime — a Railway service Variable of the same name has no effect unless
# it's threaded in here as a build arg. Railway auto-supplies build args that
# match a configured service variable name, so no extra Railway config needed.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

```
(Leave the surrounding `RUN npm ci` / `COPY packages/web ./packages/web` / `RUN npm run build --workspace=packages/web` lines untouched.)

- [ ] **Step 3: Update `README.md` and `CLAUDE.md`**

In `README.md`, replace line 240:
```
NEXT_PUBLIC_API_URL=http://localhost:3001/api   # agent API URL — used by the web app, baked in at build time
```
with:
```
AGENT_API_URL=http://localhost:3001/api   # agent API URL — server-only, proxied by the web app's Next.js server
AUTH_SECRET=...                            # session cookie signing secret (openssl rand -base64 33)
AUTH_TRUST_HOST=true                       # required behind Railway's reverse proxy
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
AUTH_ALLOWED_EMAIL=zhanggopher895@gmail.com
INTERNAL_API_SECRET=...                    # shared secret between the web proxy and the agent API
```

Replace line 254:
```
Both services share the same Railway Postgres instance. Set `WEB_URL` on the agent service to the web service's Railway URL, and `NEXT_PUBLIC_API_URL` on the web service to the agent's Railway URL (with a trailing `/api`).
```
with:
```
Both services share the same Railway Postgres instance. Set `WEB_URL` on the agent service to the web service's Railway URL, and `AGENT_API_URL` on the web service to the agent's Railway URL (with a trailing `/api`). Set `INTERNAL_API_SECRET` to the same value on both services. Set `AUTH_SECRET`, `AUTH_TRUST_HOST=true`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `AUTH_ALLOWED_EMAIL` on the web service only.
```

In `CLAUDE.md`, in the `Environment Variables` section, replace:
```
NEXT_PUBLIC_API_URL            # agent API URL the web app calls — baked in at Next.js build time (needs a Docker build arg on Railway, not just a runtime env var)
```
with:
```
AGENT_API_URL                  # agent API URL the web app's server proxies to — private, server-only, not exposed to the browser
AUTH_SECRET                    # session cookie signing secret for Auth.js
AUTH_TRUST_HOST                # set to "true" on Railway (behind a reverse proxy)
GOOGLE_CLIENT_ID               # Google OAuth client, from console.cloud.google.com
GOOGLE_CLIENT_SECRET
AUTH_ALLOWED_EMAIL             # the only Google account allowed to sign in
INTERNAL_API_SECRET            # shared secret between the web app's proxy and the agent API
```

- [ ] **Step 4: Commit the env/Dockerfile/docs cleanup**

```bash
git add .env.example Dockerfile.web README.md CLAUDE.md
git commit -m "chore: replace NEXT_PUBLIC_API_URL with private auth env vars"
```

- [ ] **Step 5: Create the Google OAuth client (manual, one-time)**

1. Go to `console.cloud.google.com` → select or create a project.
2. APIs & Services → OAuth consent screen → External (or Internal if using Workspace) → fill in app name/email → publish.
3. APIs & Services → Credentials → Create Credentials → OAuth client ID → Application type: Web application.
4. Authorized redirect URIs, add all of:
   - `http://localhost:3000/api/auth/callback/google`
   - `https://web-production-d867c.up.railway.app/api/auth/callback/google`
   - `https://web-staging-f1cd.up.railway.app/api/auth/callback/google`
5. Copy the generated Client ID and Client Secret.

- [ ] **Step 6: Local end-to-end verification**

In `packages/web/.env.local` and `packages/agent/.env`, fill in real values:
- `AUTH_SECRET` (from `openssl rand -base64 33`)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (from Step 4)
- `AUTH_ALLOWED_EMAIL=zhanggopher895@gmail.com`
- `INTERNAL_API_SECRET` — same value in both `.env` files
- `AGENT_API_URL=http://localhost:3001/api` (web only)

Run both services:
```bash
npm run dev --workspace=packages/agent
npm run dev --workspace=packages/web
```

Manually verify in the browser:
1. Visit `http://localhost:3000/` while signed out → redirected to `/login`.
2. Click "Sign in with Google", sign in with `zhanggopher895@gmail.com` → redirected to `/`, dashboard loads.
3. Click the chevron/profile button in the sidebar → signed out, redirected to `/login`.
4. Sign in again; tailor a resume end-to-end (`/tailor` → generate → edit in `/resume/[id]` → download PDF) to confirm the proxy correctly forwards JSON and binary (PDF) responses.
5. In a separate browser profile (or incognito), attempt to sign in with a different Google account → rejected, stays on `/login` with an error.
6. With the web app's dev server running, `curl http://localhost:3001/api/resumes` directly (no header) → confirm 401, proving the agent API isn't reachable except through the proxy.

- [ ] **Step 7: Deploy — update Railway env vars (production and staging)**

For each of the two Railway environments (`production`, `staging`), on **both** the web service and the agent service:
1. Remove the `NEXT_PUBLIC_API_URL` variable (web service only — it was never on the agent service).
2. Add `AGENT_API_URL` (web service) pointing at that environment's agent URL (e.g. `https://job-agentagent-production.up.railway.app/api`).
3. Add `AUTH_SECRET`, `AUTH_TRUST_HOST=true`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_ALLOWED_EMAIL` (web service).
4. Add `INTERNAL_API_SECRET` to **both** the web and agent services in that environment, same value. Use a different value per environment (production vs. staging) — don't reuse the same secret across environments.
5. Redeploy both services in each environment.
6. Repeat the manual verification from Step 5 against the live production URL.
