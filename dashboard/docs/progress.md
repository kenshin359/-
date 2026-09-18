# 進捗記録

## 2026-09-16 着手
- 環境確認: Node v22.22.2 / npm 10.9.7 / PostgreSQLサーバー無し→SQLite採用（spec.md参照）/ npmレジストリ疎通OK
- create-next-app@15.1.6 でスキャフォールド（TS/Tailwind/App Router/src-dir）
- 依存導入: prisma, @prisma/client, next-auth@4.24.11, bcryptjs, recharts, zod, vitest, tsx
- docs: spec.md / metrics.md / data-contracts.md 作成

### 状態管理（受入条件対応）
| 項目 | 状態 |
|---|---|
| 認証・ロール制御 | 完了（credentials+JWT、middleware全ページ保護、viewer書込API 403をサーバー側で検証） |
| ダッシュボード（経営サマリー） | 完了（KPI5・モール別・日別推移・目標vs着地・スパークライン4・ウォーターフォール・TOP10・パイプライン・タスク・提案・アラート。1440px/390pxスクリーンショットで確認） |
| 指標辞書・検算テスト | 完了（Vitest 17件成功。固定データは元データ→計算で検証、画面ハードコードなし） |
| デモデータ分離 | 完了（demo=true、実データが入ると自動切替・バッジ表示） |
| ルールベース提案・アラート | 初期版（広告費率超過・原価未登録・帰属売上未取得。閾値設定UIは次工程） |
| CSV取込 | 未実装（次工程。データ仕様は data-contracts.md 確定済み） |
| 12メニュー各画面 | ダッシュボード・データ連携設定は実装済み。他10画面はプレースホルダ（次工程） |
| 本番API連携 | 外部条件待ち（認証情報未提供・画面に「未接続」表示） |
| LLM提案 | 外部条件待ち（ルールベースは初期版に実装） |

### 判断記録
- DBはSQLite（環境にPostgres無し）。金額integer円・率はアプリ計算のため移行容易。
- UIキット不採用（依存削減・画像忠実再現優先）。
- デモデータは org=demo 固定・実データ集計から排他。

## 2026-09-16 初回実装完了
- Prismaスキーマ全23モデル＋SQLiteマイグレーション＋デモシード（30日分・固定乱数）
- metrics集計サービス（compute/format/types）＋検算テスト17件成功
- next-auth（credentials・JWT・3ロール）＋middleware＋ログイン画面
- 経営サマリー画面（Recharts。headless撮影時に系列が消えるため isAnimationActive=false を指定）
- `npm run build` 成功、本番モードで起動し 1440px/390px スクリーンショット確認

## 2026-09-16 配置準備（北野さん回答: レンタルサーバーで全員閲覧）
- 判断: 共用レンタルサーバーはNode常駐不可のため **VPS + Docker（Postgres + Caddy自動HTTPS）** を標準構成に決定（docs/ops.md）
- 追加: `output: standalone` / Dockerfile / docker-compose.yml / Caddyfile / .env.production.example / docker-entrypoint.sh（起動時に migrate deploy）
- Postgres用スキーマ `prisma/postgres/schema.prisma` と初期マイグレーションSQL（23テーブル）を `scripts/sync-postgres-schema.sh` でオフライン生成
- 公開運用対策: ログイン10回失敗で15分ロック（同一メール）
- 検証: 検算17件成功 / standaloneビルドを本番同様に起動し、adminログイン→KPI表示・viewerのPOST 403・ロック動作をPlaywrightで確認
- 未検証: Docker イメージのビルドはこの開発環境にDockerデーモンが無いため未実施（VPS上での初回 `docker compose up` で確認する）

## 2026-09-16 初期ユーザー（北野さん回答: 代表 塚本崚太郎 / 取締役 北野拳慎）
- 2名を管理者として登録（実メール未提供のため仮ログインID *@libetee.local。ユーザー管理画面で実メールに変更可能）
- 各種マスター管理 > ユーザー管理（管理者のみ）: 一覧・追加・パスワード変更・削除。サーバーアクション側でも admin 検証。最後の管理者と自分自身は削除不可。監査ログ記録
- CLI `scripts/create-user.ts`（サーバー初回セットアップ用）
- ログイン画面のデモアカウント表示を削除（公開運用のため。デモ情報はREADMEのみ）
- 検証: 北野さんアカウントでログイン→ユーザー管理表示→画面から追加→削除、viewerは拒否表示、をPlaywrightで確認

## 2026-09-16 配置先決定: Vercel ＋ Neon（北野さん回答）
- `vercel.json`（buildCommand: prisma generate → migrate deploy → bootstrap-admin → next build、region hnd1）
- `scripts/bootstrap-admin.ts`: ユーザー0人かつ INITIAL_ADMIN_* 設定時のみ初回管理者を作成
- Postgresスキーマに `directUrl`（Neonプーリング対策）。`output: standalone` はVercelでは無効化
- ログインロックをDB保存（LoginFailureテーブル）に変更: サーバーレスでもプロセス間で共有される
- 北野さんのログインIDを実メールに変更（開発DBのみ・コミットしない）。塚本さんの実メールは未受領
- docs/ops.md にVercel手順（料金注意: Hobbyは商用不可→Pro必須）を追記
- 未検証: Vercel上での実デプロイ（アカウント作成待ち）。ローカルでは検算・ビルド・ロック動作を再確認

## 2026-09-18 合算CPA管理画面（北野さん依頼: 合算CPA Excelをウェブで管理）
- 新テーブル `CpaDaily`（日別×媒体広告費・日別×チャネル個数・スーツケース売上税込・メモ）。Postgres差分マイグレーション `20260918000000_cpa_daily`
- 指標: `src/lib/metrics/cpa.ts`（合算CPA・広告比率・合格/注意/超過・7日移動・月次集計）＋検算9件（`cpa.test.ts`）。Excelと同じ式（判定は客単価×15%/20%）
- 画面 `/ads/cpa`: 月切替、サマリー（月間CPA・比率・累計・判定日数・媒体/チャネル内訳）、日別推移グラフ（目標/許容ライン）、日別表、行ごとの入力/編集/削除（editor以上）、Excel「日次」貼り付け取込（見出しで対応付け・UPSERT）、判定基準の変更（admin）
- サイドバーに「合算CPA管理」を追加。ロール検証はサーバーアクション側で実施（viewer拒否）
- Excelの数値は公開リポジトリのためコミットしない（画面から貼り付けて取り込む運用）
- Vercel: Next.js 15.5.25 へ更新（脆弱バージョン検出でデプロイ停止していた）、NEXTAUTH_SECRET 未設定時のフォールバック、`/api/health` 追加

## 次の作業
1. CSV取込UI（マッピング→プレビュー→検証→確定、UPSERT・取込履歴・原本保持）
2. 売上・利益／広告分析／商品分析画面（指標辞書ベース）
3. 目標・タスク・仕入れの編集UI（editor以上）
4. 提案ルールの閾値設定画面＋提案→タスク化ボタン
5. Playwright E2E（ログイン→取込→ダッシュボード反映の主要導線）
6. 合算CPA: GitHub Actions（大怪獣ワチソンCPA）から `/ads/cpa` へ自動投入するAPI（トークン認証）・ダッシュボードKPIへの合算CPA表示
