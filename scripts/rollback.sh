#!/usr/bin/env bash
# ===== ROLLBACK — restore files of an older tag as a NEW release (history is never rewritten) =====
# usage: scripts/rollback.sh 1.0.0
set -euo pipefail
old="$1"
git rev-parse "v$old" >/dev/null || { echo "no tag v$old"; git tag; exit 1; }
cur=$(grep -oP "VERSION = '\K[^']+" js/config.js)
IFS=. read -r a b c <<< "$cur"; next="$a.$b.$((c + 1))"
git checkout "v$old" -- . ':!CHANGELOG.md' ':!scripts'
exec scripts/release.sh "$next" "rollback to v$old"
