#!/usr/bin/env bash
# ===== RELEASE — bump version, log it, save restore branch release/vX.Y.Z =====
# usage: scripts/release.sh 1.1.0 "what changed"
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
[[ $# -eq 2 && "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'usage: release.sh X.Y.Z "note"'; exit 1; }
v="$1"; note="$2"
git fetch -q origin 2>/dev/null || true
git rev-parse -q --verify "refs/remotes/origin/release/v$v" >/dev/null && { echo "v$v already exists"; exit 1; }
prev=$(grep -oP "VERSION = '\K[^']+" js/config.js)                         # version live before this one
sed -i "s/VERSION = '[^']*'/VERSION = '$v'/" js/config.js sw.js
printf '## %s — %s\n- %s\n- previous: v%s (rollback: scripts/rollback.sh %s)\n\n' "$v" "$(date +%F)" "$note" "$prev" "$prev" \
  | cat - CHANGELOG.md > CHANGELOG.tmp && mv CHANGELOG.tmp CHANGELOG.md
git add js/config.js sw.js CHANGELOG.md
git commit -qm "release v$v: $note"
git push -q origin HEAD:main "HEAD:refs/heads/release/v$v"                    # deploy + restore point
echo "released v$v (was v$prev)"
