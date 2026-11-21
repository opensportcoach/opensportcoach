#!/usr/bin/env bash
# Start a coach session with the OpenSportCoach app's channel loaded (docs/DESIGN.md (the app)).
#
# Usage: ./scripts/coach.sh [--spike] [claude args...]
#   --spike   two throwaway athletes (ann, bob) in a temp folder: nothing real is touched.
#             Follow app/channel/SPIKE.md.
#
# Run it in a terminal (Terminal.app, or the desktop app's terminal panel). The channel needs the
# development-channel flag during the research preview, and Claude Code shows a warning dialog for
# it at every start: a person has to accept it. The session runs in auto mode (decided 2026-10-08):
# Garmin writes are held by scripts/hooks/confirm_gate.py, which no permission mode bypasses.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"

# Never inherit a binding: the new session gets its own id and binds the normal way.
unset OSC_SESSION OSC_ATHLETE
# Started from inside a Claude Code session, the environment carries that session's plumbing, which
# a separate CLI can't use. Drop it so the CLI runs on its own login, as from a plain terminal.
if [ -n "${CLAUDECODE:-}" ]; then
  for v in $(env | cut -d= -f1); do
    case "$v" in
      CLAUDECODE|CLAUDE_CODE_ENTRYPOINT|CLAUDE_CODE_SSE_PORT|CLAUDE_AGENT_SDK_VERSION|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_PREVIEW_*|ANTHROPIC_BASE_URL|USE_LOCAL_OAUTH|USE_STAGING_OAUTH) unset "$v" ;;
    esac
  done
fi

find_claude() {
  if command -v claude >/dev/null 2>&1; then command -v claude; return 0; fi
  for p in "$HOME/.local/bin/claude" "$HOME/.claude/local/claude"; do
    if [ -x "$p" ]; then echo "$p"; return 0; fi
  done
  # The desktop app's bundled copy. The layout has moved before: <version>/claude.app/... became
  # <version>/<hash>/claude.app/... — so search inside each version, newest first.
  local base="$HOME/Library/Application Support/Claude/claude-code" v hit
  [ -d "$base" ] || return 1
  for v in $(ls "$base" | grep -E '^[0-9]+(\.[0-9]+)*$' | sort -t. -k1,1nr -k2,2nr -k3,3nr); do
    hit="$(find "$base/$v" -maxdepth 5 -path '*/claude.app/Contents/MacOS/claude' -type f 2>/dev/null | head -1)"
    if [ -n "$hit" ]; then echo "$hit"; return 0; fi
  done
  return 1
}

CLAUDE="$(find_claude)" || { echo "✗ Claude Code CLI not found. Install it: https://code.claude.com/docs/en/setup" >&2; exit 1; }
NODE="$(command -v node)" || { echo "✗ node not found (Node 24+ runs the app's channel server)." >&2; exit 1; }
if [ ! -d app/channel/node_modules ]; then
  echo "→ installing the channel server's dependencies (first run) ..."
  (cd app/channel && npm ci --no-audit --no-fund)
fi
# The UI the server serves: built once, rebuilt whenever its source is newer than the build.
if [ ! -d app/web/node_modules ]; then
  echo "→ installing the app's UI dependencies (first run) ..."
  (cd app/web && npm ci --no-audit --no-fund)
fi
if [ ! -f app/web/dist/index.html ] || [ -n "$(find app/web/src app/web/index.html -newer app/web/dist/index.html -print -quit)" ]; then
  echo "→ building the app's UI ..."
  (cd app/web && npm run build --silent >/dev/null)
fi

if [ "${1:-}" = "--spike" ]; then
  shift
  SPIKE="$(mktemp -d -t osc-spike)"
  for n in ann bob; do
    mkdir -p "$SPIKE/athletes/$n"
    printf '{"display": "%s", "garmin": {"display_name": "spike-%s", "full_name": "%s (spike)"}}\n' \
      "$(echo "${n:0:1}" | tr a-z A-Z)${n:1}" "$n" "$(echo "$n" | tr a-z A-Z)" > "$SPIKE/athletes/$n/athlete.json"
  done
  mkdir -p "$SPIKE/data/sessions"
  echo '{"athlete": "bob"}' > "$SPIKE/data/sessions/sess-bob-spike"   # for the "second athlete" check
  export OSC_ATHLETES_ROOT="$SPIKE/athletes" OSC_DATA_ROOT="$SPIKE/data"
  echo "SPIKE — throwaway athletes Ann and Bob in $SPIKE. Nothing real is touched."
  echo "Follow app/channel/SPIKE.md."
fi

# The MCP config is written per launch, with absolute paths, so it works from any shell.
CFG_DIR="$(mktemp -d -t osc-app)"
CFG="$CFG_DIR/mcp.json"
.venv/bin/python - "$CFG" "$NODE" "$REPO/app/channel/server.ts" <<'EOF'
import json, os, sys
cfg, node, server = sys.argv[1:4]
env = {k: os.environ[k] for k in ("OSC_ATHLETES_ROOT", "OSC_DATA_ROOT") if k in os.environ}
json.dump({"mcpServers": {"osc-app": {"command": node, "args": [server], "env": env}}}, open(cfg, "w"), indent=2)
EOF

exec "$CLAUDE" --mcp-config "$CFG" --dangerously-load-development-channels server:osc-app \
  --permission-mode auto "$@"
