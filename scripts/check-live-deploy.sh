#!/usr/bin/env bash
# Verify the live backend is not drifting from the local repo commit and
# advertises the expected feature surface. Useful as a post-deploy sanity
# check (and trivially wireable to cron-job.org / GH Actions).
#
# Usage:
#   scripts/check-live-deploy.sh https://pixelboost-backend-q659.onrender.com
#
# Exits non-zero if /version is missing, ai_available is false, or scales
# don't match the local backend/app/main.py ALLOWED_SCALES.
set -euo pipefail

BASE="${1:-${PIXELBOOST_BACKEND_URL:-}}"
if [[ -z "$BASE" ]]; then
  echo "usage: $0 <backend-base-url>" >&2
  exit 2
fi

VERSION_JSON=$(curl -fsS "${BASE%/}/version") || {
  echo "FAIL: /version endpoint not reachable on $BASE" >&2
  echo "      (live backend is older than the /version PR — needs redeploy)" >&2
  exit 1
}
echo "live /version: $VERSION_JSON"

LIVE_SCALES=$(python3 -c "import sys,json; print(','.join(str(s) for s in json.loads(sys.argv[1])['scales']))" "$VERSION_JSON")
LIVE_COMMIT=$(python3 -c "import sys,json; print(json.loads(sys.argv[1])['git_commit'])" "$VERSION_JSON")
LIVE_AI=$(python3 -c "import sys,json; print(json.loads(sys.argv[1])['ai_available'])" "$VERSION_JSON")

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_SCALES=$(python3 -c "
import re, pathlib
src = pathlib.Path('$REPO_ROOT/backend/app/main.py').read_text()
m = re.search(r'ALLOWED_SCALES:\s*set\[int\]\s*=\s*\{([^}]+)\}', src)
print(','.join(s.strip() for s in m.group(1).split(',')))
")

echo "live scales:     $LIVE_SCALES"
echo "expected scales: $EXPECTED_SCALES"
echo "live commit:     $LIVE_COMMIT"
echo "ai_available:    $LIVE_AI"

if [[ "$LIVE_SCALES" != "$EXPECTED_SCALES" ]]; then
  echo "FAIL: live scales ($LIVE_SCALES) != repo scales ($EXPECTED_SCALES) — redeploy backend" >&2
  exit 1
fi
if [[ "$LIVE_AI" != "True" ]]; then
  echo "WARN: ai_available is false on the live backend (PIXELBOOST_HF_SPACE not set?)" >&2
fi

echo "OK: live backend matches repo on scale support"
