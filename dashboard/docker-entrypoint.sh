#!/bin/sh
set -e
# 起動時にマイグレーションを適用（冪等）。SEED_DEMO=1 のときだけデモデータ投入。
node node_modules/prisma/build/index.js migrate deploy --schema prisma/postgres/schema.prisma
if [ "$SEED_DEMO" = "1" ]; then
  node node_modules/tsx/dist/cli.mjs prisma/seed.ts
fi
exec node server.js
