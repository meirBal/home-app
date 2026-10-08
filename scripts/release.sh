#!/usr/bin/env bash
# ===== RELEASE — bump version everywhere, log it, tag it (every deploy = new restorable version) =====
# usage: scripts/release.sh 1.1.0 "what changed"
set -euo pipefail
v="$1"; note="$2"
[[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "version must be X.Y.Z"; exit 1; }
git rev-parse "v$v" >/dev/null 2>&1 && { echo "v$v already exists"; exit 1; }
prev=$(grep -oP "VERSION = '\K[^']+" js/config.js)
sed -i "s/VERSION = '[^']*'/VERSION = '$v'/" js/config.js sw.js
printf '## %s — %s\n- %s\n- previous: v%s (rollback: scripts/rollback.sh %s)\n\n' "$v" "$(date +%F)" "$note" "$prev" "$prev" \
  | cat - CHANGELOG.md > CHANGELOG.tmp && mv CHANGELOG.tmp CHANGELOG.md
git add -A && git commit -qm "release v$v: $note" && git tag -a "v$v" -m "$note"
git push -q && git push -q --tags
echo "released v$v (was v$prev)"
