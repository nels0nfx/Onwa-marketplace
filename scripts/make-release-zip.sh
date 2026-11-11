#!/usr/bin/env bash
# Builds a COMPLETE source archive (not a patch) one directory above the repo: ../ONWA-v<version>.zip
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="$(node -p "require('./package.json').version")"
OUT="$(cd .. && pwd)/ONWA-v${VERSION}.zip"
node scripts/check-secrets.mjs
rm -f "$OUT"
zip -r -X "$OUT" . \
  -x 'node_modules/*' '*/node_modules/*' '.git/*' '.next/*' '*/.next/*' 'dist/*' '*/dist/*' \
     '.env' '.env.local' '.env.development' '.env.production' '.env.staging' '.env.test' \
     '*/.env' '*/.env.local' '*/.env.development' '*/.env.production' '*/.env.staging' '*/.env.test' \
     '*.tsbuildinfo' '.tmp-test/*' '*/.tmp-test/*' '*.zip' '.DS_Store'
echo "Created $OUT"
unzip -l "$OUT" | tail -n 1
