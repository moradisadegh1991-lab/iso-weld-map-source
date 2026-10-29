#!/bin/bash
# Graphify in every cloud session: the CLI, the /graphify skill for Claude Code,
# and a code graph of this repo (graphify-out/, ignored by git) to query with
# `graphify query|path|explain` instead of grepping. Code only: no model, no key,
# nothing leaves the machine. A failure here never blocks the session.
set -uo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
export PATH="$HOME/.local/bin:$PATH"
cd "${CLAUDE_PROJECT_DIR:-.}"

if ! command -v uv >/dev/null 2>&1; then
  echo "graphify: uv is not installed, skipped" >&2
  exit 0
fi

# [sql] so the migrations (db/migrations/*.sql) are in the graph
if ! command -v graphify >/dev/null 2>&1; then
  uv tool install "graphifyy[sql]" >&2 || { echo "graphify: install failed, skipped" >&2; exit 0; }
fi

# the /graphify skill, registered for this container's Claude Code
graphify install --platform claude >&2 || echo "graphify: skill not registered" >&2

# the graph: incremental after the first build (its cache lives in graphify-out/)
graphify update . >&2 || echo "graphify: graph not built" >&2

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$CLAUDE_ENV_FILE"
fi
exit 0
