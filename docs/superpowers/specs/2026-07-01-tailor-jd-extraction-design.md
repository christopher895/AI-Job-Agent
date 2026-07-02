# Better JD extraction + title/company auto-fill for /tailor

## Problem

When a job URL is pasted into `/tailor` and "Fetch JD" is clicked, two things go wrong:

1. **Imprecise JD text.** `fetchJd()` in `packages/agent/src/scraper/fetch-jd.ts` strips only semantic tags (`nav, header, footer, aside, script, style, [role=navigation]`) and then tries a fixed list of class/id selectors (`CONTAINER_SELECTORS`). Sites that use plain `<div>`s for cookie banners, nav, and footer (instead of semantic tags) — e.g. Bank of America's `tal.net` ATS pages, which have no `<main>` tag and no matching class/id — fall through to `$("body").text()`, pulling in cookie-consent banner text, GTM `<iframe>`/`<noscript>` content, and footer legal boilerplate along with the real job description.
2. **Job title / company never auto-populate.** These fields are only pre-filled when the user arrives via an email alert's deep link (`?jobUrl=&title=&company=`). Pasting a raw URL directly into `/tailor` never attempts to extract title/company from the fetched page, so `TailorForm.tsx` leaves both blank.

## Scope

Changes are confined to the "fetch JD from an arbitrary pasted URL" path:
- `packages/agent/src/scraper/fetch-jd.ts`
- `packages/agent/src/api/routes/tailor.ts`
- `packages/web/components/TailorForm.tsx`
- `packages/web/lib/api.ts` (type update)

Out of scope: the per-company scraper adapters (`packages/agent/src/scraper/adapters/*`) used for the 20 monitored career pages — that path is already tuned per-platform and unaffected.

## Design

### 1. Extraction pipeline (`fetch-jd.ts`)

Add `jsdom` and `@mozilla/readability` as dependencies.

New flow inside `tryCheerio` (and mirrored in `tryPlaywright`):

1. Fetch/render HTML as today.
2. Strip known-noise elements via cheerio before any extraction:
   - Tags: `script, style, noscript, iframe`
   - Existing tag strip: `nav, header, footer, aside, [role=navigation]`
   - Cookie/consent banners by keyword, since these are frequently plain `<div>`s that evade tag-based stripping: `[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i], [class*="gdpr" i]`
3. Run `@mozilla/readability`'s `Readability(doc).parse()` on the cleaned HTML (via `jsdom`) and use `.textContent` (whitespace-collapsed) as the JD body if it meets `MIN_LENGTH`.
4. If Readability's output is too short, fall back to the existing `CONTAINER_SELECTORS` heuristic, and if that also fails, fall back further to raw `$("body").text()` — same last-resort behavior as today, just moved one step further down the chain.

`tryPlaywright` changes from returning `document.body.innerText` to returning the full rendered `page.content()` HTML, which is then run through the same strip-and-Readability pipeline used by `tryCheerio` (extracted into a shared helper) rather than duplicating logic.

### 2. Title / company extraction (new, same file)

From the same parsed document:
- Grab the first `<h1>` text.
- Grab the `<title>` tag text and split on common separators: `" | ", " - ", " — ", " · ", " • "`.
- If a split segment's normalized text matches the `h1` text, use `h1` as the clean `title` and the *other* segment as the `company` guess.
- Otherwise (no `h1` match, or no separator found), fall back to: last split segment = `company`, remaining joined segments = `title`. If `<title>` has no separator at all, return `title` only, leave `company` undefined.

These are best-effort fallbacks — never guaranteed correct, always user-editable before generating.

`fetchJd()`'s return type becomes:

```ts
export type FetchJdResult = {
  text: string;
  method: "cheerio" | "playwright" | "failed";
  title?: string;
  company?: string;
};
```

### 3. API wiring (`packages/agent/src/api/routes/tailor.ts`)

- `POST /tailor/fetch-jd` — response gains `title`/`company` alongside `text`/`method`.
- `POST /tailor` (main generate route) — if the caller didn't supply `jobTitle`/`company` in the request body and the JD was fetched from a URL (not pasted text), fill `jobTitle`/`company` from the fetch result before calling `generateBestResume` and saving the `tailored_resumes` row. This covers the case where a user pastes a URL and clicks "Generate" directly, skipping the separate "Fetch JD" step.

### 4. Frontend wiring

- `packages/web/lib/api.ts` — `fetchJd` return type gains optional `title`/`company`.
- `packages/web/components/TailorForm.tsx` — in `handleFetchJd()`, after a successful fetch: `if (!title.trim() && result.title) setTitle(result.title)`, same pattern for `company`. Never overwrites a non-empty field (whether user-typed or pre-filled from an email link's query params).

## Testing

Add `packages/agent/src/scraper/test-fetch-jd.ts`, following the existing manual `test-*.ts` script convention (see `packages/agent/src/ai/test-format.ts`) rather than a formal test framework (none is currently in use in this package):
- Saved local HTML fixture from the Bank of America `tal.net` page (the one that motivated this work).
- Assert the extracted text excludes cookie-banner text ("Strictly Necessary cookies"), GTM noise, and footer legal boilerplate.
- Assert extracted title/company match `"Global Technology Summer Analyst 2027 - Software Engineer and Mainframe Analyst"` / `"Bank of America"`.
- Add an `npm run test:fetch-jd` script entry mirroring `test:format`/`test:critic`.

## Error handling

No change to existing error-handling behavior: `validateUrl()` SSRF checks stay as-is; `fetchJd()` still returns `{ text: "", method: "failed" }` on total failure, and both API routes keep their existing failure responses (400 for fetch failure, prompting the user to paste JD text manually).
