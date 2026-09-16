# 運用手順（サーバー配置・更新・バックアップ）

最終更新: 2026-09-16

## 0. サーバーの種類について（重要）

このアプリは Node.js のサーバープロセスとして動きます。**共用レンタルサーバー（ロリポップ／さくらのレンタルサーバ／エックスサーバー共用プラン等）は Node.js アプリを常駐できないため動きません。**
「レンタルサーバー」として契約するなら **VPS**（さくらのVPS／Xserver VPS／ConoHa VPS／KAGOYA 等、月1,000〜2,000円台の2GBメモリ以上プラン）を選んでください。VPSなら Docker で下記の手順どおりに配置でき、全員がブラウザから同じURLで閲覧できます。

推奨: メモリ2GB以上 / Ubuntu 24.04 / Docker（compose plugin）/ 独自ドメイン or VPS付属のサブドメイン。

## 1. 初回配置（VPS・Docker）

```bash
# 1) サーバーに Docker を入れる（Ubuntu）
curl -fsSL https://get.docker.com | sh

# 2) リポジトリを取得
git clone <このリポジトリのURL> libetee && cd libetee/dashboard

# 3) 環境変数
cp .env.production.example .env
# .env を編集: DOMAIN / NEXTAUTH_URL / NEXTAUTH_SECRET(openssl rand -base64 32) / POSTGRES_PASSWORD(openssl rand -base64 24)
# 初回だけ SEED_DEMO=1 にするとデモデータとデモユーザーが入る

# 4) DNS: DOMAIN の A レコードを VPS の IP に向ける（Caddy が Let's Encrypt で自動HTTPS化）

# 5) 起動
docker compose up -d --build
docker compose logs -f app   # "Ready" が出れば起動完了
```

ブラウザで `https://<DOMAIN>` を開き、デモユーザーでログインできることを確認。

### 初回後に必ずやること
- 実ユーザーを登録する。最初の管理者はCLIで作る（以降は画面「各種マスター管理 > ユーザー管理」で追加可能）:
  ```bash
  docker compose exec app node node_modules/tsx/dist/cli.mjs scripts/create-user.ts \
    --email 本人のメール --name "塚本 崚太郎" --role admin --password "10文字以上"
  ```
- デモユーザー（*@demo.local）をユーザー管理画面から削除する
- `.env` の `SEED_DEMO` を `0` に戻す（次回起動時にデモを再投入しない）
- `.env` はサーバー上にだけ置き、Git にコミットしない

## 2. 更新（コード変更の反映）

```bash
cd libetee/dashboard
git pull
docker compose up -d --build     # DBマイグレーションは起動時に自動適用
```

## 3. バックアップ／復元（Postgres）

```bash
# バックアップ（毎日 cron 推奨）
docker compose exec -T db pg_dump -U libetee libetee | gzip > backup_$(date +%F).sql.gz
# 復元
gunzip -c backup_YYYY-MM-DD.sql.gz | docker compose exec -T db psql -U libetee libetee
```

cron 例（毎日3時、7日分保持）:
```
0 3 * * * cd /path/to/libetee/dashboard && docker compose exec -T db pg_dump -U libetee libetee | gzip > /backup/db_$(date +\%F).sql.gz && find /backup -name 'db_*.sql.gz' -mtime +7 -delete
```

## 4. セキュリティ（公開運用の最低ライン）
- HTTPS必須（Caddyが自動）。HTTPのみでの運用禁止
- ログインは同一メールで15分内10回失敗で15分ロック（アプリ内蔵）
- 3000番ポートは localhost にしか公開していない（compose設定）。VPSのファイアウォールは 22/80/443 のみ開放
- パスワードは12文字以上を推奨。退職者アカウントは即削除
- `.env` の秘密は再発行できるので、漏えい疑い時は `NEXTAUTH_SECRET` と `POSTGRES_PASSWORD` を変更して再起動

## 5. スキーマ変更時（開発者向け）
`prisma/schema.prisma`（SQLite・開発用）を変更したら `sh scripts/sync-postgres-schema.sh` で Postgres 用スキーマと初期SQLを再生成してコミットする。運用開始後の変更は初期SQLの再生成ではなく、`prisma/postgres/migrations/` に差分マイグレーションを追加する（`prisma migrate diff --from-migrations ... --to-schema-datamodel ... --script`）。

## 6. Docker を使わない場合（VPSに直接 Node を入れる）
Node 22 + PostgreSQL 16 + PM2 + Caddy(または nginx) を入れ、`.env` を設定して:
```bash
npm ci && npx prisma generate --schema prisma/postgres/schema.prisma && npm run build
npx prisma migrate deploy --schema prisma/postgres/schema.prisma
pm2 start node --name libetee -- .next/standalone/server.js
```
