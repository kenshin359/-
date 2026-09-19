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
| 12メニュー各画面 | ダッシュボード・データ連携設定・タスク管理・資料庫（2026-09-18追加）は実装済み。他9画面はプレースホルダ（次工程） |
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

## 2026-09-18 業務学習（北野さん指示「リベティメイン業務の学習を進めて」）
- `docs/business.md` を新設: リポジトリ内の運用コード・設定・文書（daily-report-system / CLAUDE.md / workflows）から、商品体系・チャネル・広告媒体・組織・1日の運用サイクル・KPI閾値・Kintoneアプリ・A-J復号をまとめ、ダッシュボードとのギャップ11件（G-1〜G-11）と質問7件を整理
- 主なギャップ: 一次データソースはKintone（連携候補に無い）／売上は注文日・税込（metrics.md は出荷日・税抜）／媒体にブランド軸・TikTok/TDA/案件等が無い／目標のイベント日加重が未対応／合算CPA（スーツケース個数ベース・¥4,500/¥6,000）が未定義／在庫はFBA・CSの2倉庫
- 判断: `metrics.md` は変更せず、業務側の実態と差分を business.md に記録して次工程の設計判断に回す（数値・定義は出典付き、推測なし）
- Vercel本番のデプロイ失敗（730503d・0aae410 が12〜20秒でエラー）を調査: 同コミットはローカルで `tsc` と `next build` 成功 → コード起因ではなく環境側（DB接続）の可能性が高い。Vercel連携からログが取れず未確定。対策として `scripts/vercel-build.sh` に接続先ホストのログと Supabase Direct connection（IPv6専用）への警告を追加、`ops.md` の DIRECT_URL 手順を Session pooler に修正

## 2026-09-18 タスク管理・資料庫（北野さん指示: 他社ポータルのスクショを60点の基準とし、上回る管理パネルを作る）
- 決定（北野さん回答）: 範囲=タスク管理＋資料庫／タスクの正=Kintoneタスク管理(38)と双方向同期／編集権限=editor以上は全員分を編集可
- タスク管理 `/tasks`: 担当者別カンバン（自分を先頭・Kintoneの選択肢順）、朝礼と同じ観点の絞り込み（期限超過・本日期限・P1未完了・昨日完了）、チーム絞り込み・検索、丸クリックで完了／ホバーで状態変更（楽観更新）、右パネルで編集。柳井ルールをフォームで強制（期限・完了の定義が必須、撤退基準欄）。列ごとの負荷表示（期限超過あり／多め8件以上／余裕あり3件以下）
- Kintone連携 `src/lib/kintone.ts` / `src/lib/tasks.ts`: 環境変数 KINTONE_BASE_URL / KINTONE_TASK_APP_ID / KINTONE_API_TOKEN_TASK が揃えばKintoneを直接読み書き（レコード全件取得・追加・更新、ドロップダウン選択肢もアプリから取得）。未設定・接続失敗時は「未接続」を画面に表示しローカルDBで動作（成功と偽らない）。データ連携設定画面に接続状態を表示
- 資料庫 `/documents`: Googleドライブ等のリンクをカテゴリ・部署付きで登録（Document モデル追加）。URLから種類（フォルダ/ドキュメント/スプレッドシート/スライド/PDF）を判定してアイコン表示、カテゴリ件数チップ・検索、編集・削除は editor 以上（サーバーアクションで検証・監査ログ）
- 共通: サイドバーを lucide アイコンに統一し「資料庫」を追加、Noto Sans JP・フォーカスリング・選択色・スクロールバーを共通トークン化（globals.css）、共通部品 `src/components/ui.tsx`（ボタン・入力・通知・空状態・右パネル）
- DB: Task に Kintone同項目（team/assigneeName/doneDef/kPriority/impact/yanai/memo/kintoneId）、Document を追加。SQLite・Postgres とも**差分マイグレーション**（`20260918000000_tasks_kintone_fields_documents`）。※ `scripts/sync-postgres-schema.sh` は init を再生成する方式のため今回は使わず、`prisma migrate diff` で増分SQLを生成した（本番DBに適用済みの init を書き換えないため）
- 検証: 検算17件成功・tsc・lint・`next build` 成功。Playwright（1440/390）で /tasks /documents のスクリーンショット、資料登録→表示、タスク完了→件数減、viewer で編集ボタン非表示、ページ横スクロール無し、コンソールエラー無しを確認。Kintone実接続は認証情報未受領のため未検証
- 未確定（要確認）: 資料庫のカテゴリ初期値、Kintone APIトークンの発行（アプリ38・閲覧/追加/編集）

## 2026-09-18 PRO版（経営・業務管理OS）着手（北野さん指示: STANDARDを残しPROを追加、承認待ちにせず並列で進める）
- 設計書 `docs/pro-plan.md`（現状構成・機能一覧・不足点12・STANDARD維持範囲・PRO機能14・IA/画面遷移・DB/API追加・セキュリティ・優先順位・4週ロードマップ）、リーダー向け `docs/reports/2026-09-18-中間報告.md`
- 土台（P0）: 権限5段階（User.level: ceo/director/manager/leader/staff ＋ teamCode/title/kintoneName/lineUserId/skills、`src/lib/rbac.ts` requireLevel・機密redact）／STANDARD⇄PRO切替（Cookie・ヘッダー）／PRO用サイドバー（既存12メニューは折りたたみで温存）／⌘K横断検索（画面・社員・タスク・資料・部署、一般社員は自チームのみ）／クイックアクション（＋タスク／＋資料／＋メモ／＋報告）／PROモバイル下部ナビ
- モデル追加（差分マイグレーション3本、既存列は無変更）: Team / Project / Kpi / KpiValue / Report / Alert / Note / LineGroup / LineMessage / FollowUp / ScheduledPost、Task に projectCode/kpiCode/progress/requestedByUserId/holdReason/lastActivityAt、Document に tags/docType
- セキュリティ: `/api/health` の接続先ホスト・ユーザー数を非公開化。Vercel cron `/api/line/cron`（10分ごと）を vercel.json に追加
- 並列実装（6エージェント・担当ファイル分離）: ①経営ダッシュボード＋アラートセンター（Kintone KPI(30)読み取り含む） ②今日やること＋部署ダッシュボード ③社員・組織＋PRO設定 ④タスク2.0＋KPI×タスク＋報告 ⑤LINE監査役（Webhook・追いかけ・定時投稿・監査ログ） ⑥資料庫2.0（タグ横断検索・Drive任意）
- 判断: 既存画面・API・DB列は削除も改名もしない。売上系の実データはKintone KPI(30)からの読み取りで先に出し、CSV取込UIは後回し。LINEは招待後のメッセージのみ対象（過去ログ不可）と明記

## 2026-09-18 PRO ④ タスク2.0・KPI×タスク・報告（並列実装の担当分）
- タスク2.0 `/pro/tasks`（`src/lib/pro/tasks2.ts`）: listTasks() に PRO 項目（進捗率・プロジェクト・KPI・保留理由・依頼元）をローカル Task 行から重ねる。Kintone 由来は kintoneId で紐づく「影の行」に保存（Kintone には書かない）。状態「保留」= Kintone は確認待ちのまま＋ローカル holdReason（Kintone 備考に【保留】理由 を追記、解除で除去）。優先度 緊急/高/中/低 ⇄ P1〜P4 を併記。タブ: ボトルネック（止まっている仕事=期限超過∪確認待ち滞留(3日超)∪保留、担当者別/部署別の負荷バー）／部署×状態（クリックで一覧へ絞り込み）／プロジェクト（進捗=紐づくタスク平均、＋新規はコード自動）／一覧（部署・担当・優先度・状態・期限・プロジェクトで絞り込み、進捗スライダー、右パネルで TaskForm＋PRO項目）
- KPI `/pro/kpi`・`/pro/kpi/[code]`（`src/lib/pro/kpi.ts`）: 初期6件（月間売上・広告比率・合算CPA・ROAS・低評価レビュー・期限超過タスク）を空のときだけ投入、全て source=manual・出典 business.md §6。判定は down=「超えたら」注意/危険（¥4,500以下🟢・¥6,000以下🟡・超🔴＝buildCpaSheet.py と同じ）、up=「下回ったら」。値が無ければ「未取得」（推測で埋めない）。素の SVG スパークライン（30/90日）、値の記録（リーダー以上）、定義編集（管理職以上）、「改善タスクを作る」（createTask→kpiCode 紐づけ・依頼元記録）、完了タスクの作成時→最新の前後比較
- 報告 `/pro/reports`（`src/lib/pro/reports.ts`）: 日報/週報/中間報告、本文JSON {数字・学び・次・課題・依頼}（朝礼の順）。一覧（部署/種類/期間）・詳細パネル・作成/編集（作成者自動、下書き/提出）・確認済み（リーダー以上）。「リーダー向け中間報告を生成」（管理職以上）はタスク状況＋未解決アラートから決定的テンプレートで下書き（LLM不使用、売上は「未取得」と明記）。一般社員は自分と自チームの報告のみ（サーバー側で絞る）。`?new=1` でフォームを開く（クイックアクション連携）
- 検証: vitest 25件追加（優先度変換・保留表示・ボトルネック・マトリクス・プロジェクト進捗/コード・中間報告・KPI判定/書式/valueAt）→ 全105件成功。tsc・lint クリーン。dev DB（ローカル21件）で listTasks2→hold→resume の往復、KPI 前後比較、中間報告生成を確認
- 判断: overdue_tasks の閾値は「1件で注意・3件で危険」を「超えたら」判定に合わせて warn=0 / danger=2 で登録。進捗100%でも状態は自動で完了にしない（完了は Kintone 側の状態が正）

## 2026-09-18 PRO版 第1回統合（並列6エージェントの成果を統合）
- 実装: 経営ダッシュボード／今日やること／アラートセンター／部署／タスク2.0／KPI／報告／資料庫2.0／社員・組織／PRO設定／LINE監査役（Webhook・追いかけ・定時投稿・監査ログ）。詳細と自己採点は `docs/pro-plan.md` §11
- 統合検証: tsc・lint クリーン、vitest 105件成功、`next build` 成功。Playwright で STANDARD 5画面＋PRO 15画面を 1440/390 で撮影（プレースホルダ無し・横スクロール無し・コンソールエラー無し）、⌘K 検索ヒット、クイックメモ保存、閲覧者(staff)の /pro → /pro/today リダイレクトと制限画面を確認
- 統合時の修正: 閲覧者で /pro/line が500 → 権限通知の表示に変更／報告フィルタの幅／スマホのモード切替を短縮／Target のデモ値は実データが無い間は使わない／タスク状態変更で PRO 画面も再検証／`?q=` でタスク検索を初期化
- LINE用に `src/middleware.ts` の認証除外へ `api/line` を追加（署名／Bearer で自己認証）。`vercel.json` に cron（10分ごと）
- 未接続（認証情報待ち）: Kintone KPI(30) / タスク(38) トークン、LINE チャネルシークレット／アクセストークン／CRON_SECRET、Google Drive サービスアカウント（任意）
## 2026-09-18 合算CPA管理画面（北野さん依頼: 合算CPA Excelをウェブで管理）
- 新テーブル `CpaDaily`（日別×媒体広告費・日別×チャネル個数・スーツケース売上税込・メモ）。Postgres差分マイグレーション `20260918000000_cpa_daily`
- 指標: `src/lib/metrics/cpa.ts`（合算CPA・広告比率・合格/注意/超過・7日移動・月次集計）＋検算9件（`cpa.test.ts`）。Excelと同じ式（判定は客単価×15%/20%）
- 画面 `/ads/cpa`: 月切替、サマリー（月間CPA・比率・累計・判定日数・媒体/チャネル内訳）、日別推移グラフ（目標/許容ライン）、日別表、行ごとの入力/編集/削除（editor以上）、Excel「日次」貼り付け取込（見出しで対応付け・UPSERT）、判定基準の変更（admin）
- サイドバーに「合算CPA管理」を追加。ロール検証はサーバーアクション側で実施（viewer拒否）
- Excelの数値は公開リポジトリのためコミットしない（画面から貼り付けて取り込む運用）
- Vercel: Next.js 15.5.25 へ更新（脆弱バージョン検出でデプロイ停止していた）、NEXTAUTH_SECRET 未設定時のフォールバック、`/api/health` 追加

## 2026-09-18 本番公開（Vercel + Supabase）
- 原因: Vercel の DIRECT_URL/DATABASE_URL のユーザー名が `postgres`（pooler では `postgres.<project-ref>` が必要）かつパスワード不一致 → P1000。北野さんから受領した Vercel トークンで環境変数を API から書き換え（DATABASE_URL=Transaction pooler 6543 + pgbouncer、DIRECT_URL=Session pooler 5432、NEXTAUTH_SECRET/CRON_SECRET 自動生成、NEXTAUTH_URL、KINTONE_*_APP_ID、INITIAL_ADMIN_*）し、API から本番デプロイを起動
- Vercel Hobby は cron が1日1回までのため `/api/line/cron` を `0 1 * * *`（10:00 JST）に変更
- 結果: https://libetee-dashboard.vercel.app `/api/health` = `{"ok":true,"db":"ok","secretSource":"env","commit":"2d59710"}`。初回管理者（北野さん）でログイン成功（セッション発行を確認）。INITIAL_ADMIN_* は作成後に削除
- 補足: GitHub からの push で Vercel の自動デプロイが 09:00 UTC 以降動いていない（Hobby の日次デプロイ上限か Webhook 不達の可能性）。本番反映は当面 API からの手動起動（`scratchpad/setdb.sh` 相当）か Vercel 画面の Redeploy で行う
- 要対応: チャットに貼られた Vercel トークンと DB パスワードは作り直す（トークンは Vercel → Tokens で削除、DB は Supabase で Reset）

## 2026-09-19 目標・予実管理（/targets）— イベント加重の日別目標（A8）
- 朝礼（`daily-report-system/scripts/newsDaily.py` / `buildChoreiSheet.py`）と同じ式を実装: **日次目標 = 月間目標 × その日の重み ÷ 月内の重みの合計**
- 判定も朝礼と同一しきい値: 達成率100%以上=好調／70%以上=まずまず／未満=要改善（`GOOD_RATE` / `FAIR_RATE`）
- `src/lib/metrics/daily-target.ts`（純関数・検算10件）＋ `src/lib/target-data.ts`（実績との突合）＋ `/targets` 画面
- イベントカレンダーは `src/data/events/` にコピーして持つ（Vercelは dashboard/ だけをビルドするため）。更新は `sh scripts/sync-events.sh`（目録 `index.ts` も自動生成）
- `/pro` の本日売上の判定色も、KPI報告に日別目標が無ければカレンダー配分で判定するようにした（`computeMonthlyOverview` に `dailyTargets` を追加、`todayTargetSource` で出どころを明示）
- 月間目標は Target テーブルの登録値が最優先、無ければカレンダーの値（デモデータしか無い間は Target を使わない）
- 未来日・未取込の日は空欄のまま（0で埋めない）。カレンダー未設定の月は「未設定」を表示
- 検証: 検算158件成功、本番ビルド成功、ダミー実績を入れて /targets を描画確認（9/1の重み2.0→目標¥5,000,000＝1.1億×2÷44.0 を確認）後にダミーは削除

## 次の作業
1. CSV取込UI（マッピング→プレビュー→検証→確定、UPSERT・取込履歴・原本保持）
2. 売上・利益／広告分析／商品分析画面（指標辞書ベース）
3. 目標・タスク・仕入れの編集UI（editor以上）
4. 提案ルールの閾値設定画面＋提案→タスク化ボタン
5. Playwright E2E（ログイン→取込→ダッシュボード反映の主要導線）
6. 合算CPA: GitHub Actions（大怪獣ワチソンCPA）から `/ads/cpa` へ自動投入するAPI（トークン認証）・ダッシュボードKPIへの合算CPA表示

## 2026-09-18 本番に実数を表示（Kintone トークン無しで動く取込経路）
- 北野さん指摘「数値が記載されていない」→ 本番は Kintone KPI トークン未設定のため 売上・広告費が「未接続」だった
- 対応: 日次KPIキャッシュ `KpiDaily`（Postgres 差分マイグレーション `20260918120000_kpi_daily`）＋ `/api/pro/ingest`（Bearer INGEST_SECRET／CRON_SECRET、UPSERT）＋ `kpi-kintone.ts` の「Kintone → 取込キャッシュ → 未接続」フォールバック。/pro では「売上・広告費: 取込データ（最終 …）」と出所を明示
- 取込元: 既存の GitHub Actions（月次SKU別まとめ＝`===DAILY_CH_B===`、広告費レポート dump＝`===ADCOST_DAILY_B===`）の A-J ログを `scripts/ingest-from-dumps.mjs` で復号（当日分と未来日は除外）
- 不具合: 初回の送信が 405 → 原因は Vercel の WAF ではなく `src/middleware.ts` が `/api/pro/ingest` をログイン画面へ 307 していたため。認証除外に追加（route 側で Bearer 検証）
- 自動化: `.github/workflows/dashboard-ingest.yml`（毎朝 11:20 JST＝広告費レポート 11:02 の後／手動可）。GitHub Secrets に `INGEST_SECRET`（Vercel と同じ値）が必要。値はチャット・リポジトリに置かない
- 追加: PRO「KPI」画面が取込済みでも「未取得」だったため、`src/lib/pro/kpi.ts` に取込データからの自動算出を追加（手入力 KpiValue が無い KPI のみ。月間売上=当月累計、合算CPA=累計広告費÷累計個数、広告比率=累計広告費÷累計スーツケース売上。ROAS は帰属売上が無いので算出しない）。検算2件追加（vitest 116件）
- 本番確認（7e17212）: `/api/pro/ingest` へ 9/1〜9/17 の17日分を投入 → `/pro` に 今月売上 ¥50,577,130・広告費率 12.8%・本日売上（9/17）¥1,613,388、`/ads/cpa` に 月間合算CPA ¥4,387・広告比率 13.3% が表示
- 2026-09-19: 取込ワークフローの初回スケジュール実行（run 35429220874）は Kintone 集計まで成功、送信は `INGEST_SECRET` 未登録で失敗。ログから 9/18 分を手動投入（kpiDaily 18件）。広告費の主媒体CSVが未添付の日は合算CPA行を送らず「未入力」のままにするよう `scripts/ingest-from-dumps.mjs` を修正（0円で「合格」に見える誤判定を防ぐ）

## 2026-09-19 商品分析（商品別×チャネル別売上）
- 北野取締役の依頼「商品別で Amazon／楽天／自社サイト／その他の売上を把握」。売上明細(29)の明細行に s_product・s_channel・s_amount があるため、月次SKU別まとめに `===DAILY_CH_PROD_B===`（日別×媒体×商品の個数・金額）を追加出力し、`/api/pro/ingest` の `productDaily` で取込（同一日は全行置換）
- テーブル `ProductSalesDaily`（差分マイグレーション `20260919100000_product_sales_daily`）。チャネルは4区分に正規化し元表記を rawChannel に保持
- 集計 `src/lib/metrics/product-sales.ts`（行列・構成比・客単価・日別推移）＋検算4件（vitest 120件）。指標辞書に「商品別売上」「商品構成比」を追記
- 画面 `/products`（STANDARD 商品分析）: 月切替・チャネル別合計・商品×チャネル表（セル内に各チャネル比率）・商品名クリックで日別推移
- 本番検証: 9/1〜18 の318行を投入。商品別合計 ¥53,805,740 ＝ 日別売上合計と一致。現時点のチャネルは 楽天／Amazon／自社サイト のみ（「その他」は表記が現れた時点で自動集約し、元表記を画面に明示）

## 2026-09-19 制作依頼ボード（LP画像作成依頼シートの可視化・紐付け1件目）
- 北野取締役「一つずつ紐付けして」→ 最初に、追加操作なしで繋げる LP画像作成依頼シート（リンク共有）を接続。gviz/CSV はフィルタで隠れた行（001〜014）が落ちるため xlsx エクスポートを `xlsx`（SheetJS）で読む（`src/lib/sheets/google-sheet.ts`、5分キャッシュ）
- 集計 `src/lib/metrics/creative-requests.ts`: 見出し行の自動検出、見出し無しの状態列の推定、納期の自由記入の解釈（本日＝依頼日／明日＝+1／日付／不明）、未完了・納期超過・本日・作成者別・依頼者別・NO.重複。検算5件（vitest 125件）
- 画面 `/pro/creative`（PROメニュー「制作依頼」・一般社員も閲覧可）。アラートセンターに `creative_overdue`（3日以上🔴／未満🟡、リンクは /pro/creative）
- 環境変数 `SHEET_LP_REQUESTS_ID` / `SHEET_LP_REQUESTS_TAB`（Vercel に設定済み）。シートは読むだけ・書き込みなし
- 注意: 共有されたログイン一覧シート（ID/パスワード平文）が「リンクを知っている全員」で公開状態 → 北野取締役へ共有制限とパスワード変更を要請。パスワードは記録していない

## 2026-09-19 SNS投稿カレンダー（紐付け2件目・共有設定待ち）
- シート「SNS投稿スケジュール（Libetee）」を Google Drive に新規作成（見出し＋使い方行のみ。データは入れない）。集計 `src/lib/metrics/sns-schedule.ts`（予定日の解釈・状態4種・未投稿・7日先・承認待ち・3日先の空き・今月媒体別）＋検算4件。セル解釈の共通部を `sheet-cells.ts` に切り出し（制作依頼と共用）
- 画面 `/pro/sns`（PROメニュー「SNS投稿」）: 14日カレンダー・未投稿・今後の予定・今月媒体別。アラート `sns_unposted`🔴／`sns_gap`🟡
- 環境変数 `SHEET_SNS_SCHEDULE_ID`（Vercel設定済み）。シートが「制限付き」の間は画面に「未接続」と共有手順を表示

## 2026-09-18〜19 AI公式ライン（お客様向け公式アカウント「リベティ公式」のAI自動応答）
- 北野さん依頼「AI公式ライン作成したい」「グループチャットに公式ライン入ってもらい情報を連携」。ダッシュボード（Vercel）にWebhookを載せる構成（別サーバー不要）
- 本番ブランチには別チャネル用の「LINE監査役ボット」（`/api/line/webhook`・`LINE_CHANNEL_*`）が先にあったため、衝突しないよう **`/api/line/support/webhook`・`LINE_SUPPORT_CHANNEL_*`・`src/lib/line-support/`** に分離して統合
- 受信 → 署名検証 → 会話ログ保存 → Claude（`claude-opus-5`、構造化出力）が事実カード `config/line-ai-knowledge.json` の範囲で回答 → reply。送料・返品条件・在庫・寸法は「要データ」としてAIに答えさせない
- 要対応はAI判断＋注意語の二重チェック。案件（`LineCase`・#番号）を作り、スタッフのLINEグループ（公式LINEを招待すると自動登録）へ通知。グループから「#番号 返信文」でお客様へ返信、「完了 #番号」でAI再開、進行中はAI停止＋続きを転送、48時間無反応で自動クローズ扱い。登録済みグループ以外のコマンドは拒否
- APIキー未設定・障害・返信送信失敗時も固定案内文＋要対応（成功と偽らない）。友だち追加時の挨拶はLINE側の「あいさつメッセージ」に任せる（`greeting_by_bot` 既定 false）
- DB: `LineChatLog` / `LineCase`（差分マイグレーション `20260919120000_line_support_chat_log` / `20260919120100_line_support_case`）
- 画面: PRO「LINE顧客対応」`/pro/line-support`（進行中案件＋完了・会話ログ・要対応フィルタ・7日集計・設定状態）
- 検証: 検算19件追加（署名・要対応・プロンプト・フォールバック・グループコマンド）、tsc・lint・build、モックLINE APIで招待→要対応→#返信→完了の全経路。実LINE・実Claudeは設定作業中（手順 `docs/line-ai-setup.md`）

## 2026-09-19 STANDARD 残画面の実装・使える範囲マップ・社内アンケート・AIアシスタント（エンジニアAI5名並列）
- 北野取締役「サイトの改良をして現状どこまで触れるかみたい」→ 作業指示書 `docs/briefs/2026-09-19-STANDARD残画面.md`。プレースホルダ 7 → 0
- /sales（月サマリー・チャネル別・前月同期間比・日別表に日別目標と判定）、/targets（月間目標の編集、イベント日加重の日別目標: 重みは Setting `targets.weights.YYYY-MM`、カレンダー読込）、/ads（媒体別・広告費率15%/20%判定・7日移動、閾値は合算CPAと共用）、/proposals（提案の状態変更・アラートタブ・LLM未接続明記）、/reports（日別売上CSV `/api/reports/daily-sales.csv`・報告一覧・定時レポート表）、/inventory・/purchasing（実データ無しは未接続＋必要な紐付け）、/masters（実／デモ内訳）、/guide（全画面の状態一覧 `src/lib/site-map.ts`）
- PRO: /pro/survey（匿名アンケート・本文非表示・管理職以上）、AIアシスタント（`src/lib/ai/context.ts`・`/api/ai/ask`・`AiAssistant.tsx`、モデル既定 claude-sonnet-5、キー未設定は未接続）
- シート連携: `GOOGLE_SHEETS_SA_JSON` があればサービスアカウント（Drive API）で読む両対応（`src/lib/sheets/service-account.ts`、JWT RS256 を node:crypto で署名）。手順書 `docs/sheets-setup.md`
- 検算: vitest 216件・tsc 0・eslint 0・`next build` 成功。本番反映は Supabase 新パスワード（A1）待ち。Vercel の Git 自動デプロイは動作（C2 済）
- 判断: Target の updatedBy 無し行はデモシードとして集計に使わない。Proposal の demo は「（デモ）」接頭辞で判定（demo 列なし）。PRO トップの月間目標タイルは loadTargets の仕様で仮置きのまま（次回 /targets の保存値を使うよう統合）
## 2026-09-19 AI公式ライン Phase 4: 承認フロー・分類・台帳（北野さん「難しいことは先進めといて」）
- 依頼書（AI業務基盤・設計書 `docs/briefs/2026-09-19-AI業務基盤（LINE×Claude）設計.md`）の §5〜6・§22 に従い、**Phase 1 は全件「AI回答案 → スタッフ承認 → 送信」** に切替。自動返信は AUTO モードのカテゴリで レベル1・確信度≥しきい値（既定85）・根拠あり のときだけ（`policy.ts` の純関数）
- 分類17種（`InquiryCategory`・空なら初期投入）、レベル1〜3、確信度、根拠（kb_refs は事実カードのキーのみ採用）、不足情報（レベル2）を構造化出力で取得。カテゴリ既定・安全語との「厳しい方」をレベルにする
- 注意語を2系統に分離: 必ず有人（発煙・発火・けが・法的・SNS示唆など）／自動返信禁止（返品・不良・注文番号など）
- 台帳 `Inquiry`（受信・分類・行動・状態・送信者・初回応答）、`AiDecisionLog`（本文は保存しない）、`Correction`（書き換え・対応不要・モード変更を改善データとして保存）。差分マイグレーション `20260919130000_line_support_inquiry`
- グループコマンド `#番号 送信`（承認）を追加。`#番号 返信文` は書き換え送信として修正データに記録。`完了` で未送信案は対応不要
- 画面 `/pro/line-support`: 承認待ち（編集して送信・対応不要）、CS集計7日（件数・AI自動・スタッフ送信・有人・未対応・自動解決率・平均初回応答・カテゴリ別）、カテゴリ運用モード（管理職以上）、しきい値（取締役以上）
- 検証: 検算156件（LINE 27）・tsc・lint・build、モックLINE＋モックClaudeで 招待→承認待ち→#送信→完了→返品(不足情報)→書き換え送信→安全(有人) の全経路
- 未着手: Knowledge Base のDB化（Phase 5）、社内グループのClaude解析（Phase 6〜7）、朝・退勤レポート（Phase 8〜9）
- 2026-09-19 統合判断: 別セッションも /targets（A8）を実装していたため衝突。当方の「重み編集可（Setting）」版を残し、別セッションの同梱イベントカレンダー（`src/data/events/`・`scripts/sync-events.sh`）を重みの既定値に採用。日別目標の入口を `getEffectiveDailyTargetMap`（targets-data.ts）に一本化し、PRO 経営ダッシュボード（overview.ts）・/sales・/targets が同じ値を使う。重複していた `target-data.ts`／`events-calendar.ts`／`metrics/daily-target.ts` は削除
