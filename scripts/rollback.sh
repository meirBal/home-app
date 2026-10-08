#!/usr/bin/env bash
# ===== ROLLBACK — restore app files of release/vX.Y.Z as a NEW release (history never rewritten) =====
# DB migrations (sql/) and config (keys) are never rolled back: schema only moves forward.
# usage: scripts/rollback.sh 1.0.0
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
[[ $# -eq 1 ]] || { echo "usage: rollback.sh X.Y.Z"; exit 1; }
git fetch -q origin
ref="origin/release/v$1"
git rev-parse -q --verify "$ref" >/dev/null || { echo "no release v$1"; git branch -r | grep release/; exit 1; }
IFS=. read -r a b c <<< "$(grep -oP "VERSION = '\K[^']+" js/config.js)"
keep=(':!CHANGELOG.md' ':!scripts' ':!sql' ':!js/config.js')
git diff --name-only --diff-filter=A "$ref" HEAD -- . "${keep[@]}" | xargs -r git rm -q   # files added since
git checkout "$ref" -- . "${keep[@]}"
git add -A -- . "${keep[@]}"
exec scripts/release.sh "$a.$b.$((c + 1))" "rollback to v$1"
