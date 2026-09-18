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
# 接続先ホストだけをログに出す（パスワードは出さない）。失敗時に「どこへ繋ごうとしたか」が分かるように
db_host() { printf '%s' "$1" | sed -E 's#^[a-z]+://[^@]*@##; s#[/?].*$##'; }
echo "INFO: DATABASE_URL host = $(db_host "$DATABASE_URL")"
echo "INFO: DIRECT_URL   host = $(db_host "$DIRECT_URL")"
case "$(db_host "$DIRECT_URL")" in
  db.*.supabase.co*)
    echo "WARN: DIRECT_URL が Supabase の Direct connection（IPv6専用）です。Vercel からは到達できず migrate deploy が失敗します。Session pooler（*.pooler.supabase.com:5432）に変えてください（docs/ops.md）"
    ;;
esac
npx prisma generate --schema prisma/postgres/schema.prisma
npx prisma migrate deploy --schema prisma/postgres/schema.prisma
npx tsx scripts/bootstrap-admin.ts
next build
