FROM node:20-slim

# ── Build tools ──────────────────────────────────────────────────────────────
# poppler-utils provides pdfinfo, used by fit-page.ts to count PDF pages
# (Tectonic's PDF 1.5 output has compressed object streams, so page count
# can't be scraped from raw PDF bytes).
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# ── Claude Code CLI (headless `claude -p` calls, authenticated via
# CLAUDE_CODE_OAUTH_TOKEN — subscription usage, not metered API billing) ─────
RUN npm install -g @anthropic-ai/claude-code

# ── Tectonic (statically-linked musl binary — zero runtime deps) ─────────────
RUN curl -fsSL \
      "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%400.15.0/tectonic-0.15.0-x86_64-unknown-linux-musl.tar.gz" \
    | tar xzf - -C /usr/local/bin \
  && chmod +x /usr/local/bin/tectonic

# ── Tectonic font cache (baked into the image) ───────────────────────────────
# Tectonic downloads TeX Live resources lazily on first use. Without this step
# the first render in each fresh container fetches fonts mid-request, and a 429
# from the bundle CDN kills it outright ("Cannot proceed without .vf ... for PDF
# output"). Compiling the warm-up document here populates the cache at build
# time so runtime renders never touch the network.
#
# TECTONIC_CACHE_DIR is set before the RUN so the build and the running
# container agree on one path regardless of $HOME.
#
# Copied on its own (ahead of the app source) so this ~45MB layer is only
# rebuilt when the template itself changes, not on every code change.
ENV TECTONIC_CACHE_DIR=/opt/tectonic-cache
COPY Resume_Template/czresume.cls Resume_Template/cache-warmup.tex /tmp/tectonic-warmup/
RUN cd /tmp/tectonic-warmup \
  && tectonic cache-warmup.tex \
  && test -f cache-warmup.pdf \
  && rm -rf /tmp/tectonic-warmup

WORKDIR /app

# ── npm dependencies (layer-cached) ─────────────────────────────────────────
COPY package.json package-lock.json ./
COPY packages/agent/package.json ./packages/agent/
COPY packages/web/package.json ./packages/web/

RUN npm ci

# ── Playwright system libraries + Chromium (for JD auto-fetch + HTML fallback)
RUN node_modules/.bin/playwright install-deps chromium \
 && node_modules/.bin/playwright install chromium

# ── Application source ───────────────────────────────────────────────────────
COPY packages/agent/src ./packages/agent/src
COPY packages/agent/tsconfig.json ./packages/agent/
COPY Resume_Template ./Resume_Template

RUN npm run build --workspace=packages/agent

# Tectonic is on PATH but make the env var explicit so render-pdf.ts always
# resolves it even if PATH changes in future base image updates.
ENV TECTONIC_PATH=/usr/local/bin/tectonic

CMD ["node", "packages/agent/dist/index.js"]
