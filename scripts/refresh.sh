#!/usr/bin/env bash
# The UNCONDITIONAL data refresh. Fixed steps per source, no decisions about what the data means.
#
# This is what is left of daily.sh after 2026-09-01, when the athlete pointed out that the
# loop was ".sh driven rather than skill driven". He was right: daily.sh hardcoded ten
# steps and an order, which is the skill's job. Six of those ten are CONDITIONAL —
# progression only matters if a new session exists, the catalog harvest only if that
# session carried exercise sets, the sync check only if the repo changed. Running them
# unconditionally is why the output was a wall of text whether or not he had trained.
#
# THE LINE: a fixed transformation is a script. A branch that depends on interpretation
# is the skill. Everything below is a fixed transformation.
#
# Usage: ./scripts/refresh.sh [days-back, default 4]                 (inside a bound Claude session)
#        ./scripts/refresh.sh --athlete <name> [days-back]            (in a terminal)
#
# DEFAULT IS 4, NOT 2 (2026-08-18). A session logged in the evening often syncs after that
# day's pull has run, so a 2-day window can miss it entirely.
#
# MULTI-ATHLETE (2026-09-24). Every step acts for ONE athlete — the session's binding, or
# --athlete in a terminal — and the resume state lives in that athlete's cache, so one
# athlete's half-finished refresh can never be "resumed" as the other's.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${1:-}" = "--athlete" ]; then export OSC_ATHLETE="${2:?--athlete needs a name}"; shift 2; fi
PY="${OSC_PY:-.venv/bin/python}"          # OSC_PY: tests only (a stub that records the steps)
ATHLETE="$($PY scripts/whoami.py --name)"   # fails closed when no athlete is selected
DIR="$($PY scripts/whoami.py --data-dir)"
DAYS="${1:-4}"
mkdir -p "$DIR"
STATE="$DIR/.refresh-state"
LOCK="$DIR/.refresh-lock"
echo "refresh for $ATHLETE"

# One refresh per athlete at a time (2026-10-10, docs/DESIGN.md (app audit) H1). The app's Refresh button and the
# coach session can both start one; two runs writing one cache at once would interleave the pulls.
# A second caller waits for the first (up to REFRESH_LOCK_WAIT seconds), then runs — its own pull is
# still the freshest. A lock whose owner died is taken over.
waited=0
until mkdir "$LOCK" 2>/dev/null; do
  owner="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then
    echo "(taking over a refresh lock left by process $owner, which is gone)"
    rm -rf "$LOCK"
    continue
  fi
  if [ "$waited" -eq 0 ]; then echo "another refresh for $ATHLETE is running — waiting for it to finish"; fi
  if [ "$waited" -ge "${REFRESH_LOCK_WAIT:-600}" ]; then
    echo "gave up after ${waited}s: another refresh for $ATHLETE is still running" >&2
    exit 75
  fi
  sleep 2
  waited=$((waited + 2))
done
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

step() {  # step <name> <command...>
  local name="$1"; shift
  if [ "${FORCE:-0}" != "1" ] && grep -qx "$name" "$STATE" 2>/dev/null; then
    echo "=== $name (done in the run that stopped — skipping; FORCE=1 to redo) ==="
    return
  fi
  echo "=== $name ==="
  "$@"
  echo "$name" >> "$STATE"
}

# Resuming is for a run that STOPPED: sync_workouts has died mid-run on a ConnectionResetError
# three times, and each time the whole refresh had to repeat including the pulls. Until
# 2026-10-10 the state lived for the whole day, so every refresh after the first COMPLETE one
# skipped all four steps: the app's Refresh button, an evening check-in and "re-run today's
# analysis" pulled nothing and said nothing (docs/DESIGN.md (app audit) H1). Now a finished run writes
# `complete`, and the next run starts clean; only an unfinished run of the same day resumes.
if [ -f "$STATE" ] && [ "$(head -1 "$STATE")" = "$(date +%F)" ] && [ "$(tail -1 "$STATE")" != "complete" ]; then
  echo "(resuming today's unfinished refresh)"
else
  date +%F > "$STATE"
fi

# One step per source the athlete has (athlete.json → sources; scripts/sources.py). Strava has no step:
# its MCP is read by the coach inside a session, never by a script (see /osc-daily).
SOURCES="$($PY scripts/sources.py)"
if grep -qx garmin <<< "$SOURCES"; then
  step "pull health (${DAYS}d)"     $PY scripts/pull_health.py --days "$DAYS" --force
  step "pull activities (${DAYS}d)" $PY scripts/pull_activities.py --days "$DAYS" --force
fi
if grep -qx files <<< "$SOURCES"; then
  step "import files (inbox)"     $PY scripts/import_files.py
fi
if grep -qx strava <<< "$SOURCES"; then
  step "strava: expire old records" $PY scripts/import_strava.py --prune
fi
step "duplicates across sources"  $PY scripts/sources.py reconcile
step "dashboard export"           $PY scripts/export_dashboard_data.py
step "health baseline"            $PY scripts/update_health_baseline.py
echo "complete" >> "$STATE"

echo
echo "refresh complete. Conditional analysis is the skill's job — see .claude/skills/osc-daily/"
