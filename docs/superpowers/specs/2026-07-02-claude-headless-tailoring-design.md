# Headless Claude Code as the tailoring LLM provider

## Problem

`generateBestResume()`'s generate → critique → revise loop (`chain.ts`, calling
`tailor.ts` and `critic.ts`) runs every tailoring request through OpenAI's API,
metered per token. A `spike/claude-headless-railway-token` branch (merged and
reverted via PR #37/#38/#40) proved that the `claude` CLI can authenticate
headlessly on Railway via `CLAUDE_CODE_OAUTH_TOKEN` — a token minted from an
existing Claude subscription (`claude setup-token`) — and complete a real
request without a browser or interactive login. That draws from the
subscription's included non-interactive usage rather than metered API
billing, and Christopher already pays for the subscription regardless.

Goal: make Claude (via the CLI, subscription auth) the default LLM backend
for the tailoring pipeline, without losing OpenAI as an escape hatch if the
subscription-auth path ever breaks in production.

## Scope

- `packages/agent/src/ai/llm.ts` — the single seam all three callers share.
- `packages/agent/package.json` — new dependency (`zod-to-json-schema`).
- `.env.example` — new/changed env vars.
- `docs/RAILWAY_SETUP.md` or equivalent — note the `CLAUDE_CODE_OAUTH_TOKEN`
  variable requirement (create if no such doc exists yet; otherwise append).

Out of scope, unchanged:
- `tailor.ts`, `critic.ts`, `fit-page.ts` — none of them call the provider
  directly; they only call `completeJSON()`, so nothing about their prompts,
  schemas, or retry expectations changes.
- The `Dockerfile`/`railway.json` (`@anthropic-ai/claude-code` is already
  installed in the image from the spike work; `CMD`/`startCommand` already
  restored to normal boot in PR #40).

## Design

### 1. Provider dispatch (`llm.ts`)

`completeJSON()` keeps its exact public signature. Internally it dispatches
on an `LLM_PROVIDER` env var:

```ts
export const LLM_PROVIDER = (process.env.LLM_PROVIDER ?? "claude") as "claude" | "openai";

export async function completeJSON<T>(schema, opts): Promise<T> {
  return LLM_PROVIDER === "openai"
    ? completeJSONOpenAI(schema, opts)
    : completeJSONClaude(schema, opts);
}
```

Today's `client()`/`chat.completions.create()` code becomes
`completeJSONOpenAI()`, moved verbatim — no behavior change to that path.

### 2. Claude backend (`completeJSONClaude`, new)

For each attempt (same `maxRetries` retry loop as today, error fed back into
the user prompt on retry — this loop shape doesn't change, only what runs
inside one attempt):

1. Convert the Zod `schema` to JSON Schema once via `zod-to-json-schema`.
2. The **system** prompt goes via `--system-prompt <string>` (full replace of
   Claude Code's default system prompt — the direct analog of OpenAI's
   `role: "system"` message, not `--append-system-prompt`, which layers on
   top of Claude Code's own agentic framing and would be wrong for a pure
   completion call). The **user** prompt (JD + résumé JSON, potentially
   large) is piped via **stdin** — Anthropic's own docs document this exact
   pattern (`cat file.txt | claude -p '...'`, capped at 10MB piped input) —
   with a short fixed instruction as the `-p` argument itself (e.g. "Follow
   the system prompt using the content provided on stdin."). Invoked via
   Node's `execFile` with an argument array, never shell-interpolated, so
   JD/résumé content can't cause shell injection regardless of what it
   contains.
3. Flags: `--output-format json --json-schema <converted-schema> --model
   <CLAUDE_MODEL or omitted>`. `CLAUDE_MODEL` env var, unset by default —
   when unset, no `--model` flag is passed and the CLI's own default model
   is used, so this doesn't need to track model-id churn.
4. **Cost/context control:** run the subprocess with `cwd` set to a
   fresh, empty scratch directory (`os.tmpdir()`-based, created per call,
   removed after) instead of the repo root. This prevents Claude Code from
   auto-discovering and loading this project's `CLAUDE.md`, memory, skills,
   and hooks — which the spike showed inflates a single trivial call to
   ~29k tokens. `--bare` is not usable here since bare mode requires
   `ANTHROPIC_API_KEY` and ignores `CLAUDE_CODE_OAUTH_TOKEN` entirely.
   **This mitigation is unverified in practice** — how far it actually cuts
   token usage is something to measure once built, not something this
   design can guarantee.
5. Parse stdout as JSON, take `.structured_output`, and — even though the
   CLI already validated it against the JSON Schema server-side — **still
   run it through the original Zod `schema.parse()`** before returning. This
   keeps one validation source of truth for both providers and preserves
   today's retry-on-validation-failure semantics unchanged (JSON Schema and
   a hand-written Zod schema can drift in what they express; Zod stays
   authoritative).
6. If `is_error` is true in the CLI's JSON response, or the process exits
   non-zero, or `structured_output` is missing, treat it as a validation
   failure for retry purposes (same code path as a Zod parse failure today)
   — so a transient Claude-side error gets one retry, same as a malformed
   JSON response does today.

### 3. Auth

`CLAUDE_CODE_OAUTH_TOKEN` — minted once via `claude setup-token`, set as a
Railway variable on the agent service (already proven working in the spike).
No code reads this directly; the `claude` CLI itself picks it up from the
process environment.

### 4. Env vars (`.env.example`)

```
# LLM provider: "claude" (default, subscription usage via headless CLI) or "openai"
LLM_PROVIDER=claude

# Required when LLM_PROVIDER=claude — minted via `claude setup-token`
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...

# Optional — pins a specific model for the claude path; omit to use the CLI's default
CLAUDE_MODEL=

# Required when LLM_PROVIDER=openai (or as a manual fallback)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
```

### 5. Fallback behavior

No automatic failover between providers. If the Claude path errors after
exhausting retries, `completeJSON()` throws — identical to today's OpenAI
behavior. Switching providers is a manual `LLM_PROVIDER=openai` env var
change + redeploy. Automatic cross-provider failover was considered and
rejected as speculative complexity: it's untested territory (two providers
billed completely differently) and not worth building until the Claude path
has real production runtime to show whether it's actually needed.

## Testing

Mirrors the existing pattern (`test-critic.ts` already "skips gracefully
when `OPENAI_API_KEY` is absent"):

- `completeJSONClaude` gets a live smoke test (new, alongside the existing
  `test-*.ts` scripts) that skips gracefully when `CLAUDE_CODE_OAUTH_TOKEN`
  is absent, and otherwise calls it with a trivial schema + prompt and
  asserts a validated object comes back — the CLI-level analog of what the
  spike script proved manually.
- `test-critic.ts`, `test-format.ts`, `test-grounding.ts` are unaffected;
  they exercise logic above `completeJSON` and don't care which provider
  answers it. Running them with `LLM_PROVIDER=claude` set (once the
  subscription token is available in a dev environment) exercises the new
  path end-to-end without any test code changes — this is a manual
  verification step during implementation, not a new automated test.

## Error handling

No change to the retry/error contract `completeJSON()` already exposes to
its three callers: it either returns a schema-valid `T` or throws after
`maxRetries + 1` attempts. Both providers honor that identically; callers
(`tailor.ts`, `critic.ts`, `fit-page.ts`) need zero changes.
