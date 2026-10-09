#!/usr/bin/env bash
# ===== RELEASE — bump version, log it, save restore branch release/vX.Y.Z =====
# usage: scripts/release.sh 1.1.0 "what changed"          (home app)
#        APP=book scripts/release.sh 1.0.0 "what changed" (book/ app → branch release/book-vX.Y.Z)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
[[ $# -eq 2 && "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'usage: release.sh X.Y.Z "note"'; exit 1; }
v="$1"; note="$2"; app="${APP:-}"; app="${app%/}"
[[ -z $app || -f $app/js/config.js ]] || { echo "unknown APP=$app"; exit 1; }
dir=${app:+$app/}; tag="release/${app:+$app-}v$v"; cfg="${dir}js/config.js"; log="${dir}CHANGELOG.md"
files=("$cfg"); [[ -z $app ]] && files+=(sw.js)
git fetch -q origin 2>/dev/null || true
git rev-parse -q --verify "refs/remotes/origin/$tag" >/dev/null && { echo "$tag already exists"; exit 1; }
prev=$(grep -oP "VERSION = '\K[^']+" "$cfg")                              # version live before this one
sed -i "s/VERSION = '[^']*'/VERSION = '$v'/" "${files[@]}"
if [[ -f $log ]]; then back="previous: v$prev (rollback: ${app:+APP=$app }scripts/rollback.sh $prev)"; else back="first release"; : > "$log"; fi
printf '## %s — %s\n- %s\n- %s\n\n' "$v" "$(date +%F)" "$note" "$back" \
  | cat - "$log" > "$log.tmp" && mv "$log.tmp" "$log"
git add "${files[@]}" "$log"
git commit -qm "release ${app:+$app }v$v: $note"
git push -q origin HEAD:main "HEAD:refs/heads/$tag"                           # deploy + restore point
echo "released ${app:+$app }v$v (was v$prev)"
