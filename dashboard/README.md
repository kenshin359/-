# Libetee 経営AIダッシュボード

ECの売上・利益・広告・在庫・タスクを1画面で判断するための業務ダッシュボード。

## セットアップ（初回）

```bash
cd dashboard
npm install
cp .env.example .env        # NEXTAUTH_SECRET を `openssl rand -base64 32` で生成して設定
npx prisma migrate dev      # SQLite DB作成
npx tsx prisma/seed.ts      # デモデータ投入（demo=true、実データとは分離）
npm run dev                 # http://localhost:3000
```

デモアカウント（シード投入時のみ）:

| ロール | メール | パスワード |
|---|---|---|
| 管理者 | admin@demo.local | admin1234 |
| 編集者 | editor@demo.local | editor1234 |
| 閲覧者 | viewer@demo.local | viewer1234 |

本番投入前にデモユーザーを削除し、実ユーザーを登録すること。

## テスト

```bash
npx vitest run   # 指標の検算テスト（docs/metrics.md の固定データ）
npm run build    # 型チェック込みのビルド
```

## ドキュメント（docs/）

- `spec.md` — 仕様・範囲・受入条件・技術選定
- `metrics.md` — 指標辞書（全画面共通の計算定義。ここが正）
- `data-contracts.md` — 統一CSVとDBの粒度規則
- `progress.md` — 進捗・状態管理・判断記録
- `line-ai-setup.md` — LINE公式アカウントのAI自動応答（AI公式ライン）の設定手順

## 本番配置（Vercel + Neon Postgres）

手順は `docs/ops.md` 冒頭。Vercel の Root Directory を `dashboard` にし、環境変数（DATABASE_URL / DIRECT_URL / NEXTAUTH_SECRET / NEXTAUTH_URL / INITIAL_ADMIN_*）を設定して Deploy するだけ。`vercel.json` の buildCommand がマイグレーションと初回管理者作成まで行う。
代替として VPS + Docker の手順も同じ文書にある。Postgres用スキーマは `prisma/postgres/`（`scripts/sync-postgres-schema.sh` で開発用SQLiteスキーマから再生成）。
共用レンタルサーバーや Wix では動作しません（Node.js 実行環境が必要）。

## 運用メモ

- 実データ（demo=false）が1件でも入るとダッシュボードは自動で実データ表示へ切替わる（デモは常に集計から除外）
- 未接続の外部連携は「データ連携設定」画面に未接続と表示される（成功と偽らない）
- 書込権限はサーバー側でも検証している（viewerのPOSTは403）
