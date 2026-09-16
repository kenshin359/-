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

## 本番DB（Postgres）への移行

1. `prisma/schema.prisma` の `provider = "sqlite"` を `postgresql` に変更
2. `.env` の `DATABASE_URL` をPostgresの接続文字列へ
3. `npx prisma migrate dev --name init-postgres` でマイグレーション再生成
4. 金額は整数（円）・率はアプリ層計算のため、データ変換は不要

## 運用メモ

- 実データ（demo=false）が1件でも入るとダッシュボードは自動で実データ表示へ切替わる（デモは常に集計から除外）
- 未接続の外部連携は「データ連携設定」画面に未接続と表示される（成功と偽らない）
- 書込権限はサーバー側でも検証している（viewerのPOSTは403）
