# PRO版（経営・業務管理OS）設計書 — 現状分析・設計・ロードマップ

作成: 2026-09-18 / 対象: `dashboard/`（Libetee 経営AIダッシュボード）
依頼: 北野さん「60点の社内管理画面を、STANDARDとして残したまま、100点の経営・業務管理OS（PRO）へ進化させる」
前提資料: 業務知識 `docs/business.md`、製品コンテキスト `/PRODUCT.md`、リベティ構成マインドマップ（2026-09-18受領PDF）

---

## 1. 現在のシステム構成（PHASE 1 調査結果）

| 項目 | 現状 |
|---|---|
| Framework | Next.js 15.5（App Router, TypeScript, React 19）。`src/app/(app)/` 配下が認証必須画面 |
| Frontend | Tailwind CSS 3.4 ＋ 自作部品（`src/components/ui.tsx`: ボタン・入力・通知・空状態・右パネル）。アイコン lucide-react。グラフ Recharts。フォント Noto Sans JP |
| Backend | Next.js Route Handlers（`/api/auth`, `/api/tasks`, `/api/health`）＋ Server Actions（ユーザー管理・タスク・資料庫）。サーバー側でロール検証 |
| DB | Prisma 6。開発 SQLite / 本番 Postgres（Vercel＋Neon or Supabase）。25モデル（User, Channel, Media, Warehouse, Supplier, ProductSeries, Sku, SkuCost, Order, OrderItem, Refund, AdDaily, AccessDaily, Cost, InventoryMove, PurchaseOrder, PoLine, Target, Task, **Document**, Proposal, ImportBatch, AuditLog, Setting, LoginFailure） |
| 認証 | next-auth 4（credentials＋JWT）。ログイン失敗10回/15分でロック（DB保存） |
| 認可 | 3ロール `admin / editor / viewer`。`canWrite()` で editor 以上を判定。middleware で全画面保護 |
| 状態管理 | サーバーコンポーネントでDB取得→クライアント部品に props。楽観更新は `useOptimistic`。グローバル状態ライブラリなし |
| 外部連携 | **Kintone タスク管理(38)**（実装済み・読み書き）。楽天/Amazon/Meta/Google API・LLM は「未接続」表示。Google Drive は**リンク登録のみ**（API連携なし） |
| 自動運用（別系統） | `daily-report-system/`＋GitHub Actions 定時14本（売上取込・朝礼台本・広告費レポート・検算・レビュー返信…）→ Kintone / Chatwork。ダッシュボードとはKintone経由でしか繋がっていない |
| テスト | Vitest 21件（指標検算17・タスク集計/資料判定4）。Playwright は手動スクリプトで画面確認 |
| 配置 | Vercel（本番ブランチ `claude/kintone-daily-report-system-f8migr`）。直近2デプロイがDB接続で失敗中（原因候補: Supabase Direct connection がIPv6専用） |
| 未使用コード・負債 | `/api/tasks` の旧タスクAPI（priority high/mid/low）は画面から未使用（Kintone項目に置換済み）。Task モデルに旧列（priority/status英語値/relation/proposalId）と新列（kPriority/team…）が併存。`scripts/sync-postgres-schema.sh` は init 再生成方式のため運用開始後は使えない（差分マイグレーションへ移行済み）。12メニュー中9画面がプレースホルダ |

## 2. 現在実装されている機能（PHASE 2）

1. 認証・ロール制御（admin/editor/viewer、サーバー側検証、ロック）
2. 経営サマリー（KPI5・モール別・日別推移・目標vs着地・スパークライン・ウォーターフォール・TOP10・パイプライン・タスク・提案・アラート） ※実データ未取込のためデモ表示
3. 指標辞書（`docs/metrics.md`）と集計サービス（`src/lib/metrics/`）＋検算テスト
4. デモデータ分離（demo=true を実集計から排他）
5. ルールベース提案・アラート初期版（広告費率20%超・原価未登録・帰属売上未取得）
6. ユーザー管理（管理者のみ・監査ログ）
7. **タスク管理（担当者別カンバン、Kintone(38)同期、柳井ルール強制）** ← 2026-09-18
8. **資料庫（Driveリンク登録・種類判定・検索・カテゴリ）** ← 2026-09-18
9. データ連携設定（接続状態の正直な表示）
10. 稼働確認API `/api/health`

## 3. 現状を60点とした場合の不足点（PHASE 4）

**情報を置く場所にはなったが、判断→行動→確認が回っていない。**

| # | 不足 | 具体 |
|---|---|---|
| 1 | 会社の状態が5〜10秒で分からない | 経営サマリーはデモ値。本日売上・目標達成率・必要日販・広告費率・在庫金額・期限超過が1画面で「正常/注意/危険」表示されていない |
| 2 | 部署へのドリルダウンが無い | 会社→部署→担当者の階層が無い。部署の目標・KPI・タスク・問題・最新報告を一か所で見られない |
| 3 | 「今日やること」が無い | 社員がログインしても、自分の期限超過・本日期限・確認待ち・上司依頼が自動で並ばない |
| 4 | KPIとタスクが繋がっていない | 「CPA悪化→改善施策→担当→期限→結果確認」の導線が無い。タスクに関連KPIを持てない |
| 5 | アラートが弱い | 期限超過・目標未達ペース・CPA急上昇・在庫不足/過多・担当者未設定・長期未更新・確認待ち滞留が集約されていない |
| 6 | 報告が溜まらない | 日報/週報/中間報告がKintone・Chatwork・LINEに散在。ダッシュボード内に「報告」の器が無い |
| 7 | 検索が画面ごと | 社員・タスク・資料・KPI・報告を横断する検索と ⌘K が無い |
| 8 | 入力導線が遠い | タスク追加は /tasks からのみ。どこからでも ＋タスク/＋報告/＋資料 ができない |
| 9 | 権限が3段階 | 経営者/取締役/管理職/リーダー/一般社員の区別が無く、利益・人事など機密の閲覧制御ができない |
| 10 | LINE運用が繋がっていない | 各チームのLINEグループの進捗・依頼・期限が拾えず、追いかけ（フォローアップ）が人手 |
| 11 | 実データが入っていない | 売上・広告費はKintoneにあるがダッシュボードに未連携。CSV取込UIも未実装 |
| 12 | モバイルは「崩れない」止まり | スマホで承認・今日のタスク・通知が完結する導線が無い |

## 4. STANDARDとして維持する機能（PHASE 3）

以下は**変更しない**（PRO はこれらを包含し、切替で戻れる）:
- サイドバー12メニュー＋ショートカット、ヘッダー、ログイン画面
- 経営サマリー（現行レイアウト）
- タスク管理（担当者別カンバン）・資料庫（カード一覧）・ユーザー管理・データ連携設定
- 既存API（`/api/auth`, `/api/tasks`, `/api/health`）とサーバーアクション
- DBの既存テーブル・列（削除・改名なし。追加のみ）
- 指標辞書 `docs/metrics.md` の定義

## 5. PRO版に追加する機能（PHASE 5 要件）

| # | 機能 | 中身 |
|---|---|---|
| ① | 経営ダッシュボード（PROホーム） | 上段: 本日売上／今月売上／月間目標と達成率／必要日販／前月同期間比／広告費・広告費率／粗利（暫定）／在庫金額／未完了・期限超過タスク／重要アラート。各値に 🟢🟡🔴 の判定（閾値は business.md の現場基準）。下段: 部署カード（KPI・遅れ・担当）と「今日の判断事項」 |
| ② | 部署別ダッシュボード | 経営 → 部署（EC/広告/LP/SNS/TikTok/CS/物流・在庫/商品開発/人事・管理/経理/海外=韓国・中国/O2）→ 担当者。目標・KPI・進捗・タスク・期限・問題・最新報告 |
| ③ | タスク管理2.0 | 会社/部署/プロジェクト/担当/優先度（緊急・高・中・低 ⇄ P1〜P4）/期限/進捗率/状態（未着手・進行中・確認待ち・保留・完了）/関連KPI。ボトルネック表示（誰の仕事が止まっているか＝確認待ち滞留・期限超過・長期未更新） |
| ④ | 今日やること | ログイン直後に自動生成: 期限超過→本日期限→確認待ち→上司依頼→高優先の順。ワンタップで完了・保留・確認依頼 |
| ⑤ | KPI×タスク連携 | KPIカードから「改善タスクを作る」→担当・期限・施策・目標値を持つタスク→完了後に同KPIの前後比較を表示 |
| ⑥ | 資料庫2.0 | タグ・カテゴリ・部署・担当者・更新日で横断検索。Drive API接続（任意）でファイル名検索。マニュアル/契約書/商品/広告/物流/人事の種別 |
| ⑦ | AIアシスタント | 右下ボタン。会社DB＋タスク＋KPI＋資料＋報告を横断して回答（Claude API）。未接続時は「未接続」表示（既存方針どおり） |
| ⑧ | アラートセンター | 🔴期限超過／目標未達ペース／CPA急上昇／在庫不足・過多／担当者未設定／長期未更新、🟡確認待ち／KPI悪化／タスク集中。件数を増やさず、重要度でまとめる |
| ⑨ | 社員・組織管理 | 所属・役職・担当業務・現在/完了タスク・期限超過・担当KPI・最近の報告・スキル・権限。ランキングは作らない |
| ⑩ | グローバル検索・⌘K | 社員/タスク/資料/プロジェクト/KPI/報告/商品を横断。Command Palette（⌘K / Ctrl+K） |
| ⑪ | クイックアクション | どの画面からでも ＋タスク／＋報告／＋資料／＋プロジェクト／＋メモ |
| ⑫ | モバイル最適化 | 今日のタスク・承認・KPI・通知・報告をスマホ幅で完結 |
| ⑬ | **LINE監査役ボット** | 公式アカウントをグループに招待→メッセージを保存→依頼・期限・約束を抽出→タスク化候補→未完了を自動で追いかけ（リマインド）→日次まとめをグループとリーダーへ返信。スケジュール（定時投稿・期限リマインド）と監査ログ |
| ⑭ | 報告（日報/週報/中間報告） | 報告の器（Report）。チーム別・期間別に一覧、リーダーへの中間報告を自動生成（テンプレート） |

## 6. 新しい画面構成（PHASE 5・6 Information Architecture）

```
ヘッダー: [STANDARD | PRO 切替]  [⌘K 検索]  [＋ クイックアクション]  [🔔 アラート]  [ユーザー]

STANDARD（現行のまま）
  ダッシュボード / 売上・利益 / 広告分析 / 商品分析 / 新商品・仕入れ / 在庫管理 /
  目標・予実管理 / タスク管理 / 資料庫 / AI改善提案 / レポート / データ連携設定 / 各種マスター管理

PRO（追加）
  /pro                 経営ダッシュボード（会社の状態 5〜10秒）
  /pro/today           今日やること（本人向け・スマホ最適）
  /pro/alerts          アラートセンター
  /pro/teams           部署一覧 → /pro/teams/[team] 部署ダッシュボード → 担当者
  /pro/tasks           タスク2.0（部署/プロジェクト/担当/状態/期限のマトリクス・ボトルネック）
  /pro/projects        プロジェクト一覧・詳細
  /pro/kpi             KPI一覧（判定・推移・改善タスク）→ /pro/kpi/[code]
  /pro/reports         報告（日報/週報/中間報告）→ 作成・一覧・リーダー向けまとめ
  /pro/library         資料庫2.0（横断検索・タグ）
  /pro/people          社員・組織 → /pro/people/[id]
  /pro/line            LINE監査役（グループ一覧・抽出された依頼・追いかけ状況・スケジュール）
  /pro/settings        PRO設定（閾値・権限・通知）

遷移: 経営 → 部署 → 担当者 → タスク／KPI → 改善タスク作成 → 今日やること（担当者側）→ 完了 → KPI前後比較（経営側）
```

## 7. DB/APIで必要な変更（PHASE 7・追加のみ・既存互換）

**追加モデル**
- `Team`（code, name, parentCode, leaderUserId, kintoneTeamLabel）— 部署階層。Kintoneの `team` 選択肢と対応表を持つ
- `Project`（code, name, teamCode, ownerUserId, status, startDate, dueDate, goal, kpiCode）
- `Kpi`（code, name, unit, direction(up/down), targetValue, warnThreshold, dangerThreshold, source(metrics/kintone/manual), teamCode）＋ `KpiValue`（kpiCode, date, value, note）
- `Report`（type: daily/weekly/interim, teamCode, authorUserId, periodFrom/To, title, body(構造化JSON), status: draft/submitted/reviewed, reviewedByUserId）
- `Alert`（code, level: red/yellow, title, detail, entityType, entityId, teamCode, firstSeenAt, lastSeenAt, resolvedAt, muted）— ルールで生成、解決時にクローズ
- `LineGroup`（groupId, name, teamCode, active）／`LineMessage`（groupId, userId, displayName, text, ts, kind, extractedJson）／`FollowUp`（sourceMessageId, taskId?, assignee, due, status, remindAt, remindedCount）／`ScheduledPost`（groupId, cron, template, active, lastRunAt）
- `Note`（authorUserId, body, entityType?, entityId?）— クイックメモ
- `UserProfile` 拡張（User に追加列: `level`(ceo/director/manager/leader/staff), `teamCode`, `title`, `kintoneName`, `skills`, `lineUserId`）

**Task 拡張（列追加）**: `projectCode`, `kpiCode`, `progress`(0-100), `requestedByUserId`, `holdReason`, `lastActivityAt`, `priorityLevel`(緊急/高/中/低 は kPriority P1〜P4 と相互変換), 状態「保留」を追加（Kintoneに無い場合はローカル列で保持し、Kintoneへは「確認待ち」＋備考で書く）

**API/Server Actions（新規）**
- `/api/pro/overview`（経営KPI＋判定）／`/api/pro/teams/[team]`／`/api/pro/today`／`/api/pro/alerts`／`/api/pro/search?q=`（横断検索）
- `/api/line/webhook`（署名検証→保存→抽出キュー）／`/api/line/cron`（Vercel Cron: 追いかけ・定時投稿・日次まとめ）
- Server Actions: 報告作成、プロジェクト作成、KPI改善タスク作成、アラート解決/ミュート、メモ追加
- すべて `requireLevel(...)` でサーバー側検証。機密（粗利・営業利益・人事・給与欄）は `manager` 以上のみ返す（APIレベルでフィールドを落とす）

## 8. セキュリティ上の問題と対策（現状の指摘）

| 指摘 | 対策 |
|---|---|
| ロールが3段階で、利益・人事情報の閲覧境界が無い | `level` 5段階を追加し、APIで機密フィールドを落とす（UI非表示だけにしない） |
| NEXTAUTH_SECRET 未設定時に DATABASE_URL から鍵を派生（緊急措置） | 本番では必ず NEXTAUTH_SECRET を設定。派生時は /api/health で `secretSource: derived` と警告表示済み |
| `/api/health` がログイン不要で users 数・DBホストを返す | 件数とホストは伏せ、ok/ng のみ返すよう縮小（本計画のP0で修正） |
| 監査ログが一部操作のみ | 全ての書込アクションで `AuditLog` を必須化（共通 `audit()`） |
| LINE Webhook は署名検証必須・本文を公開リポジトリやログに出さない | `X-Line-Signature` を HMAC-SHA256 で検証、本文はDBのみ、ログはIDと文字数だけ |
| Kintone APIトークン・LINEトークンはVercel環境変数のみ | `.env.example` に空欄で記載、コミット禁止（既存方針） |
| 削除操作の confirm がブラウザ標準 | 保持（誤操作防止の最低ライン）。PROでは取り消し（Undo）を検討 |

## 9. 実装優先順位（PHASE 8）

P0（土台・今すぐ／既存を壊さない）
1. STANDARD/PRO 切替（ヘッダー・Cookie保存・PRO用サイドバー）
2. 権限5段階（`level`）と `requireLevel()`、機密フィールドのAPI制御
3. Team / Project / Kpi / Report / Alert / Note モデル追加（差分マイグレーション）
4. アラートセンター（ルール: 期限超過・確認待ち滞留・担当者未設定・長期未更新・目標未達ペース・広告費率）
5. 今日やること（本人向け）
6. ⌘K 検索＋クイックアクション（＋タスク／＋報告／＋資料／＋メモ）

P1（経営・部署）
7. 経営ダッシュボード（PROホーム、判定付き）— 売上系はKintone売上明細(29)・KPI(30)を読み取り連携して実データ化
8. 部署別ダッシュボード（会社→部署→担当者）
9. KPI × タスク連携（KPIカード→改善タスク→前後比較）
10. 報告（日報/週報/中間報告）とリーダー向けまとめ

P2（LINE・AI・資料庫2.0）
11. LINE監査役ボット（Webhook→保存→依頼抽出→追いかけ→日次まとめ→スケジュール投稿）
12. 資料庫2.0（タグ・横断検索・Drive API任意）
13. AIアシスタント（Claude API・横断回答・未接続時は明示）

P3（仕上げ）
14. モバイル導線（承認・通知）、E2E回帰テスト、負債整理（旧 /api/tasks の廃止判断）

## 10. 100点版完成までのロードマップ

| 週 | 内容 | 完了条件 |
|---|---|---|
| 第1週（〜9/25） | P0 全部＋P1の経営ダッシュボード骨格 | PRO切替で経営/今日/アラート/検索が動く。既存画面は無変更で回帰テスト成功 |
| 第2週（〜10/2） | Kintone売上・KPI読み取り連携、部署別、KPI×タスク、報告 | 実データで達成率・必要日販・広告費率が朝礼台本と一致。部署→担当者ドリルダウン |
| 第3週（〜10/9） | LINE監査役（Webhook・追いかけ・日次まとめ・スケジュール）、資料庫2.0 | テストグループで依頼抽出→タスク化→リマインド→完了報告が回る |
| 第4週（〜10/16） | AIアシスタント、モバイル導線、E2E、負債整理、自己評価→改善→再レビュー | 10項目の自己採点と残課題を提示し、80点以下の項目を再改善 |

各週の終わりに `docs/progress.md` へ結果を記録し、`docs/reports/` にリーダー向け中間報告を出す。

---

## 11. 実装状況と自己評価（2026-09-18 第1回・実装後）

### 実装済み（PRO）
| 機能 | 状態 | 画面 |
|---|---|---|
| ① 経営ダッシュボード | ✅ KPI11タイル＋判定色（Kintone KPI(30)読み取り。未接続時は「未接続」）・今日の判断事項・部署カード | `/pro` |
| ② 部署別ダッシュボード | ✅ 会社→部署→担当者。KPI・問題・担当者別・最新報告・部署メモ・＋タスク | `/pro/teams`, `/pro/teams/[code]` |
| ③ タスク管理2.0 | ✅ ボトルネック／部署×状態／プロジェクト／一覧、進捗率、保留、優先度 緊急〜低⇄P1〜P4 | `/pro/tasks` |
| ④ 今日やること | ✅ 期限超過→本日→確認待ち→上司依頼→P1→3日以内、ワンタップ操作、スマホ最適 | `/pro/today` |
| ⑤ KPI×タスク連携 | ✅ KPI一覧/詳細、値の記録、改善タスク作成、完了後の前後比較 | `/pro/kpi` |
| ⑥ 資料庫2.0 | ✅ タグ・種別・部署・更新日の横断検索、一括タグ、機密（人事/契約）は管理職以上、Drive検索は任意接続 | `/pro/library` |
| ⑦ AIアシスタント | ⏳ 未実装（右下ボタン・横断回答は第4週。未接続表示のまま） | — |
| ⑧ アラートセンター | ✅ 期限超過・確認待ち滞留・担当者未設定・長期未更新・タスク集中・売上ペース・広告費率。解決/ミュート | `/pro/alerts` |
| ⑨ 社員・組織管理 | ✅ 部署別名簿・プロフィール・権限/所属の割当（管理者）。ランキング無し | `/pro/people`, `/pro/settings` |
| ⑩ グローバル検索・⌘K | ✅ 画面・社員・タスク・資料・部署 | ヘッダー |
| ⑪ クイックアクション | ✅ ＋タスク／＋資料／＋報告／＋メモ | ヘッダー |
| ⑫ モバイル最適化 | ✅ 下部ナビ（今日・アラート・部署・タスク・報告）、全画面390px確認 | — |
| ⑬ LINE監査役 | ✅ Webhook（署名検証）・依頼/期限の抽出・追いかけ・定時投稿・監査ログ・タスク化。**実LINE認証情報待ち** | `/pro/line` |
| ⑭ 報告 | ✅ 日報/週報/中間報告、リーダー向け中間報告の自動下書き | `/pro/reports` |
| STANDARD/PRO切替・権限5段階 | ✅ Cookie切替、level（経営者〜一般社員）、機密はAPIで落とす | ヘッダー |

### 自己採点（100点満点）と残っている具体的な問題
| 項目 | 点 | 残っている問題（次に直すもの） |
|---|---|---|
| UI/UX | 78 | ヘッダーがスマホで窮屈（切替を短縮して対応済み）。/pro の未接続通知が2段になる。報告フォームの入力項目が多く、スマホでは長い |
| 経営情報の視認性 | 60 | **売上・広告費が実データ未接続**（Kintone KPI(30)トークン待ち）。在庫金額・粗利は「未取得」。接続後にタイルの判定色が初めて意味を持つ |
| 社員の使いやすさ | 75 | 本人とタスクの紐づけは kintoneName の手動設定が必要（PRO設定）。LINEからの依頼が「今日やること」に出るのはタスク化後のみ |
| タスク管理 | 85 | 保留はKintone備考への追記で表現（Kintoneに保留状態が無い）。進捗100%で自動完了しない（仕様） |
| KPI管理 | 65 | 値の自動取込がKPI(30)以外は無い（CPA・ROASは手入力）。イベント日加重の日次目標は未実装（Excel側にはある） |
| 検索性 | 80 | ⌘Kは報告・KPI・プロジェクトを未対象。資料庫2.0のDrive検索は未接続 |
| モバイル | 78 | 承認（確認待ち→完了）の通知が無い（Push/LINE通知は未実装） |
| セキュリティ | 80 | level は管理者が手で設定する必要あり（初期は全員 staff）。監査ログの閲覧画面が無い（LINE分のみ）。/api/health は縮小済み |
| 保守性 | 80 | PRO層は `src/lib/pro/*` に集約・テスト105件。旧 `/api/tasks` と Task の旧列（priority/status英語）が残る |
| 拡張性 | 82 | Team/Project/Kpi/Report/Alert のモデルは用意済み。閾値は定数（Setting テーブル化は未） |

### 次に直す順（第2週の頭）
1. Kintone KPI(30)・タスク(38) のAPIトークンを受領して実データ化（達成率・必要日販・広告費率を朝礼と突合）
2. AIアシスタント（右下ボタン、会社DB＋タスク＋KPI＋資料＋報告の横断回答、未接続時は明示）
3. ⌘K に報告・KPI・プロジェクトを追加、監査ログ画面
4. イベント日加重の日次目標（events-YYYY-MM.json を targets に取り込み）
5. 通知（確認待ち・期限当日）を LINE 監査役経由で本人へ
