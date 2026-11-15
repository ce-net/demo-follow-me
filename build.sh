#!/usr/bin/env bash
# Bundle the page: src/app.ts (+ follow.ts and the generated clients in sdk/) -> site/follow-me/app.js.
set -euo pipefail
cd "$(dirname "$0")"
npx -y esbuild@0.20.2 src/app.ts --bundle --format=esm --target=es2022 --outfile=site/follow-me/app.js --log-level=warning
cp src/follow.ts site/follow-me/follow.ts
echo "built site/follow-me/app.js"
