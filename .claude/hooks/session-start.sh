#!/bin/bash
# SessionStart hook for Claude Code on the web.
#
# The remote container clones the repo without node_modules, so Vitest, ESLint
# and the Next.js toolchain are all unavailable until dependencies are installed.
# This installs them up front so `npm test` and `npm run lint` work immediately.
#
# Local sessions are left alone — developers manage their own node_modules.
set -euo pipefail

# Only run in Claude Code on the web; local machines already have their deps.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# `npm install` (not `ci`) so the cached container layer can be reused across
# sessions; it is a no-op when node_modules is already present and current.
echo "[session-start] Installing npm dependencies..."
npm install --no-audit --no-fund

echo "[session-start] Dependencies ready — 'npm test' and 'npm run lint' are available."
