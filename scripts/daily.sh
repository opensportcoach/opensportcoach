#!/usr/bin/env bash
# RETIRED 2026-09-03. This used to be the daily loop. It is now a shim.
#
# "I feel this is very .sh driven rather than skill driven." — the athlete, and they were right.
# This script hardcoded ten steps and an order, which is the skill's job — and six of
# the ten were CONDITIONAL. Running them unconditionally is why the daily output was a
# wall of text whether or not he had trained.
#
#   the unconditional half  ->  scripts/refresh.sh   (4 steps, resumable)
#   the conditional half    ->  .claude/skills/osc-daily/SKILL.md
#
# Kept as a shim rather than deleted because the old path is in muscle memory and in
# several logs. It forwards to refresh.sh and tells you where the rest went.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "NOTE: daily.sh is retired. Forwarding to refresh.sh."
echo "      The conditional analysis now lives in the /osc-daily skill."
echo
exec ./scripts/refresh.sh "$@"
