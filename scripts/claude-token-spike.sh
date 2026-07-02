#!/bin/sh
# SPIKE — throwaway. Confirms `claude -p` authenticates via CLAUDE_CODE_OAUTH_TOKEN
# (subscription usage) inside the actual Railway container, not just locally.
# Delete this file and the railway.json / Dockerfile lines that reference it
# once the spike is done — see docs/RAILWAY_CLAUDE_SPIKE.md if you kept it.

echo "=== claude-code headless spike ==="
echo "node: $(node --version)"

if command -v claude >/dev/null 2>&1; then
  echo "claude CLI found: $(claude --version)"
else
  echo "FAIL: claude CLI not found on PATH"
  echo "=== end spike ==="
  exec node packages/agent/dist/index.js
fi

# Report which credentials are present WITHOUT ever printing their values.
echo "ANTHROPIC_API_KEY set: ${ANTHROPIC_API_KEY:+yes}"
echo "ANTHROPIC_AUTH_TOKEN set: ${ANTHROPIC_AUTH_TOKEN:+yes}"
echo "CLAUDE_CODE_OAUTH_TOKEN set: ${CLAUDE_CODE_OAUTH_TOKEN:+yes}"

# Canary: proves whether Railway is injecting ANY service variables into this
# container at all, independent of the token name/value. Set TEST_VAR=hello123
# on the same service in Railway before redeploying.
echo "TEST_VAR set: ${TEST_VAR:+yes} value=${TEST_VAR}"

# Ground truth: every env var NAME actually present in this container (never
# values) so we stop relying on the Railway UI and just read what's real.
echo "--- all env var names in this container ---"
env | cut -d= -f1 | sort
echo "--- end env var names ---"

echo "--- running claude -p smoke test (no --bare: bare mode ignores CLAUDE_CODE_OAUTH_TOKEN) ---"
claude -p "Reply with exactly: OK" --output-format json
echo "--- smoke test exit code: $? ---"

echo "=== end spike ==="

# Fall through to the real app so the deploy doesn't just crash-loop.
exec node packages/agent/dist/index.js
