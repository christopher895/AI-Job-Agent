FROM node:20-slim

# ── Build tools ──────────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# ── Tectonic (statically-linked musl binary — zero runtime deps) ─────────────
RUN curl -fsSL \
      "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%400.15.0/tectonic-0.15.0-x86_64-unknown-linux-musl.tar.gz" \
    | tar xzf - -C /usr/local/bin \
  && chmod +x /usr/local/bin/tectonic

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
COPY tsconfig.json ./

RUN npm run build --workspace=packages/agent

# Tectonic is on PATH but make the env var explicit so render-pdf.ts always
# resolves it even if PATH changes in future base image updates.
ENV TECTONIC_PATH=/usr/local/bin/tectonic

CMD ["node", "packages/agent/dist/index.js"]
