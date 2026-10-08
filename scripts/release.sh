#!/usr/bin/env bash
# ===== RELEASE — bump version, log it, tag it (every deploy = new restorable version) =====
# usage: scripts/release.sh 1.1.0 "what changed"
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
[[ $# -eq 2 && "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'usage: release.sh X.Y.Z "note"'; exit 1; }
v="$1"; note="$2"
git rev-parse -q --verify "refs/tags/v$v" >/dev/null && { echo "v$v already exists"; exit 1; }
live=$(git describe --tags --abbrev=0 2>/dev/null || echo none)          # version actually deployed before
sed -i "s/VERSION = '[^']*'/VERSION = '$v'/" js/config.js sw.js
printf '## %s — %s\n- %s\n- previous: %s (rollback: scripts/rollback.sh %s)\n\n' "$v" "$(date +%F)" "$note" "$live" "${live#v}" \
  | cat - CHANGELOG.md > CHANGELOG.tmp && mv CHANGELOG.tmp CHANGELOG.md
git add js/config.js sw.js CHANGELOG.md
git commit -qm "release v$v: $note" && git tag -a "v$v" -m "$note"
git remote | grep -q . && git push -q && git push -q --tags
echo "released v$v (was $live)"
