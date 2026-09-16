#!/bin/sh
# Vercel のビルドコマンド。DIRECT_URL 未設定時は DATABASE_URL で代用（Neonのプール接続でも migrate deploy は通る）
set -e
if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: 環境変数 DATABASE_URL が空です。Vercel の Settings > Environment Variables で設定してください。"
  exit 1
fi
if [ -z "$DIRECT_URL" ]; then
  echo "WARN: DIRECT_URL が空のため DATABASE_URL を代用します"
  export DIRECT_URL="$DATABASE_URL"
fi
npx prisma generate --schema prisma/postgres/schema.prisma
npx prisma migrate deploy --schema prisma/postgres/schema.prisma
npx tsx scripts/bootstrap-admin.ts
next build
