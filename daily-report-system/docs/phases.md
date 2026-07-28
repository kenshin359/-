# 実装順マニュアル（Phase 1〜8）

小さな単位で進め、各フェーズの「完了条件」を満たしてから次へ進んでください。
`APP_ENV=test` のうちは LINE は実送信されないので、安全に検証できます。

---

## Phase 1 — Kintone アプリ作成

- **作業内容**
  - `.env` に `KINTONE_BASE_URL` と（作成用に一時的に）`KINTONE_USER` / `KINTONE_PASSWORD` を設定
  - `node kintone/createApps.js` を実行（スタッフ日報 / AI経営日報 の2アプリを自動作成）
  - 表示された appId を `.env` の `KINTONE_DAILY_REPORT_APP_ID` / `KINTONE_AI_REPORT_APP_ID` に設定
  - 各アプリで APIトークンを発行し `.env` に設定（`docs/kintone-*` 参照）
- **確認方法**：kintone 画面で2アプリが存在し、フィールドが設計書どおりか目視
- **テスト方法**：スタッフ日報に手動で1〜2件、`提出状況=提出済み` で登録
- **完了条件**：2アプリが本番反映済み／APIトークン発行済み／テストレコードあり

## Phase 2 — API 接続（Kintone 読み取り）

- **作業内容**：`node scripts/fetchDailyReports.js --date=YYYY-MM-DD`
- **確認方法**：`out/reports-<date>.json` に登録した日報が入っているか
- **テスト方法**：件数・フィールドがコンソールに表示されるか
- **完了条件**：対象日の提出済みレコードが取得できる（0件でもエラーにならない）

## Phase 3 — Claude 連携

- **作業内容**：`.env` に `ANTHROPIC_API_KEY` を設定 → `node scripts/callClaude.js --file=samples/sample-daily-reports.json`
- **確認方法**：`out/analysis-<date>.json` が生成され、JSON スキーマ通りか
- **テスト方法**：コンソールに「経営日報」と「LINE本文」プレビューが出るか。情報不足項目が "情報不足" になっているか
- **完了条件**：サンプル・実データの双方で正しい構造の分析結果が得られる

## Phase 4 — LINE 送信

- **作業内容**：`docs/line-setup.md` の手順でトークン・宛先IDを取得 → `.env` に設定
- **確認方法**：`node scripts/sendLine.js "テスト"`（test 環境ではプレビューのみ）
- **テスト方法**：`APP_ENV=production` に一時変更し、実際にLINEに届くか（届いたら test に戻す）
- **完了条件**：グループ or 個人に実送信が届く／長文が分割される

## Phase 5 — n8n 完成（定時ワークフロー①）

- **作業内容**
  - n8n に環境変数を設定（`.env` と同じキー。`docs/setup-guide.md`「n8n環境変数」参照）
  - `n8n/workflow-1-daily-report.json` をインポート
  - Schedule Trigger の cron を `REPORT_SEND_TIME` に合わせる
- **確認方法**：n8n の「Execute Workflow」で手動実行し、各ノードが緑になるか
- **テスト方法**：AI経営日報アプリにレコードが増え、LINE（本番）に届くか
- **完了条件**：定時（例 19:00）に自動で日報が生成・保存・通知される

## Phase 6 — 緊急通知（ワークフロー②）

- **作業内容**
  - `n8n/workflow-2-urgent-webhook.json` をインポート → Webhook URL を控えて `N8N_WEBHOOK_URL` に設定
  - `WEBHOOK_SECRET` を決め、n8n 環境変数と呼び出し側の両方に設定
  - Kintone スタッフ日報アプリの Webhook（または業務システム）から POST するよう設定
- **確認方法**：`curl` でサンプル送信（`docs/test-guide.md` 参照）→ LINE に緊急通知が届くか
- **テスト方法**：`samples/sample-urgent.json` を投げて、要約された緊急通知が届くか
- **完了条件**：緊急案件が定時を待たずに即時通知される／非緊急はスキップされる

## Phase 7 — エラー処理

- **作業内容**：`docs/error-handling.md` の各項目（0件・重複・レート制限・文字数超過・ネットワーク障害）を確認
- **確認方法**：わざと失敗させて（例：不正トークン）挙動を見る
- **テスト方法**：0件の日で実行 → 未提出通知が届くか。2回実行 → 2回目がスキップされるか
- **完了条件**：主要な異常系がハンドリングされ、`gen_status`/`error_log` に記録される

## Phase 8 — 本番テスト

- **作業内容**：`.env` の `APP_ENV=production` に切替、1週間の並走運用
- **確認方法**：毎朝、社長・部長が「30秒で把握できるか」フィードバック
- **テスト方法**：実データで定時実行 → Kintone保存・LINE通知・緊急通知を総合確認
- **完了条件**：1週間、手動介入なしで安定稼働。プロンプト微調整が落ち着く
