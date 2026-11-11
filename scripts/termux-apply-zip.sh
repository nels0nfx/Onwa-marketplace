#!/data/data/com.termux/files/usr/bin/env bash
# Usage: bash scripts/termux-apply-zip.sh ~/storage/downloads/ONWA-v0.1.0.zip [repo-dir]
set -euo pipefail
ZIP="${1:?Usage: termux-apply-zip.sh <path-to-zip> [repo-dir]}"
REPO="${2:-$HOME/Onwa-marketplace}"
[ -f "$ZIP" ] || { echo "Zip not found: $ZIP"; exit 1; }
[ -d "$REPO/.git" ] || { echo "Not a git repo: $REPO"; exit 1; }
pkg list-installed 2>/dev/null | grep -q '^unzip/' || pkg install -y unzip
cd "$REPO"
git pull --rebase origin main || true
unzip -o "$ZIP" -d "$REPO"
git status --short | head -n 40
echo "Review above, then: git add . && git commit -m 'ONWA' && git push origin main"
