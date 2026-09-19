# サイト設定手順（北野さん用・2026-09-18版）

所要: 30〜40分。すべてブラウザ上で完結します。値（パスワード・トークン）はチャットに貼らず、Vercel の環境変数にだけ入れてください。


## ★ 最短ルート（Vercelの画面を触らない）: GitHub のボタン1つで設定＋デプロイ
Vercel の環境変数設定は GitHub Actions の `vercel-setup.yml` が代行します。北野さんがやるのは「Secrets に5つ貼る → Run workflow」だけです。
1. Vercel → 右上アイコン → Account Settings → **Tokens** → Create（Scope: libetee）→ 出た文字列をコピー
2. Supabase → プロジェクト → 上部 **Connect** → Connection string で **Transaction pooler**（:6543）と **Session pooler**（:5432）の2本をコピーし、`[YOUR-PASSWORD]` を実際のDBパスワードに置換
3. GitHub → リポジトリ → Settings → Secrets and variables → Actions → **New repository secret** で登録:
   | Name | Value |
   |---|---|
   | `VERCEL_TOKEN` | 手順1の文字列 |
   | `SUPABASE_DATABASE_URL` | Transaction pooler の文字列 |
   | `SUPABASE_DIRECT_URL` | Session pooler の文字列 |
   | `ADMIN_EMAIL` | 北野さんのメール |
   | `ADMIN_PASSWORD` | 初期パスワード（10文字以上） |
   任意: `KINTONE_BASE_URL` / `KINTONE_API_TOKEN_TASK` / `KINTONE_API_TOKEN_KPI` / `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN`（あとから追加して再実行してもよい）
4. GitHub → **Actions** → 左の「Vercel 設定＆本番デプロイ（ボタン1つ）」→ **Run workflow** → 緑になるまで待つ（2〜4分）
5. 実行ログの最後に `"db":"ok"` が出れば完了。https://libetee-dashboard.vercel.app/login で ADMIN_EMAIL / ADMIN_PASSWORD でログイン
うまくいかないときは、そのログの赤い行を貼ってください（パスワードやトークンはログに出ません）。

## 0. 先に決めること
- 公開URL: `https://libetee-dashboard.vercel.app`（Vercelのプロジェクト名）。独自ドメイン（例 dashboard.libetee.net）は後から追加可。
- DB: Neon か Supabase のどちらか1つ（今は両方の手順が docs/ops.md にあります。**現在の失敗はDB接続が原因なので、ここを先に直します**）。

## 1. DB接続を直す（Vercel → Settings → Environment Variables）
| 変数 | 入れる値 | 取り方 |
|---|---|---|
| `DATABASE_URL` | Supabase: **Transaction pooler**（`…pooler.supabase.com:6543`）／ Neon: Pooled connection | Supabase: 画面上部「Connect」→ Connection string ／ Neon: Dashboard → Connection string（Pooled） |
| `DIRECT_URL` | Supabase: **Session pooler**（`…pooler.supabase.com:5432`）※ `db.xxxx.supabase.co` は不可 ／ Neon: Direct connection（Poolerのチェックを外す） | 同上 |
| `NEXTAUTH_SECRET` | ランダム文字列（32文字以上） | https://generate-secret.vercel.app/32 を開いてコピー |
| `NEXTAUTH_URL` | `https://libetee-dashboard.vercel.app` | 独自ドメイン設定後はそのURLに変更 |
| `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_NAME` / `INITIAL_ADMIN_PASSWORD` | 北野さんのメール／氏名／10文字以上の初期パスワード | 初回ログイン後に3つとも削除してよい |
パスワードに `@ # % /` などの記号が含まれる場合は、URLの中ではURLエンコード（例 `@`→`%40`）にする。

## 2. コードを本番ブランチに反映する
Vercel → Settings → Git → **Production Branch** を確認。
- いまは `claude/kintone-daily-report-system-f8migr`。今回の PRO 版は `claude/rebety-main-learning-iop21l` にあります。
- どちらかを選ぶ: (A) 私が `claude/rebety-main-learning-iop21l` を本番ブランチへマージして push（既存コミットはすべて含まれています） ／ (B) Vercel の Production Branch を `claude/rebety-main-learning-iop21l` に変更。
- 反映後 Deployments で最新が「Ready」になることを確認。失敗時は Build Logs の末尾を私に貼ってください（ビルドログには接続先ホスト名が出るようにしてあります。パスワードは出ません）。

## 3. 動作確認
1. `https://<URL>/api/health` を開く → `"db":"ok"` と `"secretSource":"env"` なら成功。`db:"error"`＋`dbError:"unreachable"` は `DIRECT_URL`/`DATABASE_URL` のホストが違う。
2. `https://<URL>/login` で INITIAL_ADMIN のメール／パスワードでログイン。
3. ログイン後、Vercel から `INITIAL_ADMIN_*` の3変数を削除（以降は「各種マスター管理 > ユーザー管理」で追加）。

## 4. Kintone 連携（タスク・KPIを実データにする）
Kintone → 各アプリの「設定 → APIトークン」で発行し、Vercel に追加:
| 変数 | 値 | 権限 |
|---|---|---|
| `KINTONE_BASE_URL` | `https://<サブドメイン>.cybozu.com` | — |
| `KINTONE_TASK_APP_ID` | `38`（タスク管理（チーム進捗）） | — |
| `KINTONE_API_TOKEN_TASK` | 発行したトークン | レコード閲覧・追加・編集 |
| `KINTONE_KPI_APP_ID` | `30`（毎朝KPI報告） | — |
| `KINTONE_API_TOKEN_KPI` | 発行したトークン | レコード閲覧 |
追加後 Redeploy。「データ連携設定」画面で「接続中」に変わります。

## 5. LINE 監査役（任意・後からでも可）
`docs/line-setup.md` の手順で Messaging API チャネルを作り、`LINE_CHANNEL_SECRET`・`LINE_CHANNEL_ACCESS_TOKEN`・`CRON_SECRET`（任意の長い文字列）を Vercel に追加 → Redeploy → LINE Developers の Webhook URL に `https://<URL>/api/line/webhook` を登録して「検証」。

## 6. 社員の登録と権限
1. 各種マスター管理 > ユーザー管理 で社員を追加（ロール: 管理者／編集者／閲覧者）。
2. PRO → PRO設定 → 権限・所属 で、各社員の **権限（代表／取締役／管理職／リーダー／一般社員）・部署・Kintoneの担当者名**（例: 北野）を設定。担当者名を入れると「今日やること」に本人のタスクが出ます。
3. 機密（粗利・人事・契約書）は管理職以上にしか返しません。

## 7. 任意
- 独自ドメイン: Vercel → Settings → Domains → `dashboard.libetee.net` を追加し、Wix の DNS に表示された CNAME を登録。`NEXTAUTH_URL` を変更して Redeploy。
- Google Drive 横断検索: `GOOGLE_DRIVE_SA_JSON`（サービスアカウントJSONをbase64）と `GOOGLE_DRIVE_FOLDER_IDS`。
