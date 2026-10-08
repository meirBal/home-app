#!/usr/bin/env bash
# ===== ROLLBACK — restore app files of an older tag as a NEW release (history never rewritten) =====
# DB migrations (sql/) and config (keys) are never rolled back: schema only moves forward.
# usage: scripts/rollback.sh 1.0.0
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
[[ $# -eq 1 ]] || { echo "usage: rollback.sh X.Y.Z"; git tag; exit 1; }
old="$1"
git rev-parse -q --verify "refs/tags/v$old" >/dev/null || { echo "no tag v$old"; git tag; exit 1; }
cur=$(grep -oP "VERSION = '\K[^']+" js/config.js)
IFS=. read -r a b c <<< "$cur"; next="$a.$b.$((c + 1))"
keep=(':!CHANGELOG.md' ':!scripts' ':!sql' ':!js/config.js')
git diff --name-only --diff-filter=A "v$old" HEAD -- . "${keep[@]}" | xargs -r git rm -q   # files added since
git checkout "v$old" -- . "${keep[@]}"
git add -A -- . "${keep[@]}"
exec scripts/release.sh "$next" "rollback to v$old"
