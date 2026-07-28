# 導入マニュアル（初心者向け・最短ルート）

このシステムを **ゼロから動かすまで** の全手順です。専門知識がなくても進められるよう、
順番どおりにコピペしていけば動くように書いています。所要時間の目安は 2〜3 時間。

---

## 全体像（何をするのか）

```
スタッフがKintoneに日報入力
        ↓（毎日19:00 n8nが自動実行）
   Kintoneから当日分を取得
        ↓
   Claudeが分析して経営日報を生成
        ↓
   AI経営日報アプリに保存 ＋ LINEで社長・部長へ通知
        ↓
   緊急案件は定時を待たずWebhookで即時LINE通知
```

---

## 用意するもの（アカウント）

| サービス | 用途 | 取得先 |
|----------|------|--------|
| Kintone | 日報の入力・保存 | 契約済みの cybozu.com |
| Anthropic (Claude) | 日報の分析 | https://console.anthropic.com |
| LINE公式アカウント + Messaging API | 通知 | https://developers.line.biz |
| n8n | 自動化（クラウド版 or 自前サーバ） | https://n8n.io |
| Node.js 18+ | ローカル動作確認 | https://nodejs.org |

---

## ステップ 1：リポジトリ準備

```bash
cd daily-report-system
cp .env.example .env
# .env をエディタで開き、分かる値から埋める（未確定は TODO のままでOK）
```

## ステップ 2：Kintone アプリを作る（Phase 1）

```bash
# .env に KINTONE_BASE_URL と、作成用に一時的に KINTONE_USER / KINTONE_PASSWORD を設定
node kintone/createApps.js
```
表示された appId とトークンを `.env` に設定。詳細は `docs/kintone-staff-report-app.md` / `docs/kintone-ai-report-app.md`。

> 手動で作りたい場合は、上記2つの設計書の表のとおりにフィールドを作成してください。

## ステップ 3：接続テスト（Phase 2〜3）

```bash
node scripts/fetchDailyReports.js          # Kintone取得
node scripts/callClaude.js --file=samples/sample-daily-reports.json  # Claude分析
```

## ステップ 4：LINE を設定（Phase 4）

`docs/line-setup.md` の手順でトークンと宛先IDを取得し `.env` に設定。
```bash
node scripts/sendLine.js "疎通テスト"      # test中はプレビューのみ
```

## ステップ 5：ローカルで通し実行

```bash
node scripts/runPipeline.js                # 取得→分析→保存→(LINE)→書き戻し
```

## ステップ 6：n8n に載せる（Phase 5〜6）

### n8n 環境変数の設定
n8n の「Settings → Variables」または起動環境で、`.env` と同じキーを設定します：

```
KINTONE_BASE_URL, KINTONE_DAILY_REPORT_APP_ID, KINTONE_AI_REPORT_APP_ID,
KINTONE_API_TOKEN_DAILY_REPORT, KINTONE_API_TOKEN_AI_REPORT,
ANTHROPIC_API_KEY, ANTHROPIC_MODEL,
LINE_CHANNEL_ACCESS_TOKEN, LINE_TARGET_GROUP_ID, LINE_TARGET_USER_ID,
REPORT_TIMEZONE, WEBHOOK_SECRET
```
> n8n で `$env.XXX` を使うには、セルフホストの場合 `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` が必要です。
> クラウド版で `$env` が使えない場合は、各ノードの値を n8n の「Variables」参照（`$vars.XXX`）に置き換えるか、
> n8n Credentials（Header Auth）に登録してください。

### ワークフローのインポート
1. n8n → 右上「⋯」→ **Import from File**
2. `n8n/workflow-1-daily-report.json` を読み込む → Schedule の cron を確認 → **Active** に
3. `n8n/workflow-2-urgent-webhook.json` を読み込む → Webhook URL を `N8N_WEBHOOK_URL` と Kintone Webhook に設定 → **Active**

## ステップ 7：本番切替（Phase 8）

`.env`（と n8n）の `APP_ENV=production` にして、実運用を開始。
まず1週間は毎朝結果を確認し、`prompts/` の文面を微調整してください。

---

## つまずきポイント Q&A

- **LINEに届かない** → `APP_ENV=test` のままではありませんか？ / 宛先IDは正しいですか？（`docs/line-setup.md`）
- **Kintoneで401** → APIトークンを発行後、「アプリを更新」で反映しましたか？権限は足りていますか？
- **Claudeが変なJSON** → `prompts/` の指示と `error_log` を確認。モデルは `ANTHROPIC_MODEL` で変更可。
- **同じ日に2通来た** → AI経営日報の `target_date` の重複禁止(unique)が ON か確認。
- **n8nで $env が空** → セルフホストの環境変数設定、またはクラウド版の `$vars`/Credentials 方式に切替。

困ったら `docs/error-handling.md` と `docs/test-guide.md` を参照してください。
