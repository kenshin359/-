# Libetee AI 日報システム

株式会社リベティ（Libetee）向け。**Kintone → Claude → LINE** を **n8n** で自動化する、実際に動く日報システムです。

スタッフが Kintone に日報を入力すると、毎日決まった時刻に全員分を自動取得し、
Claude が分析・要約して、**社長・部長が30秒で把握できる報告**を生成。
Kintone の「AI経営日報アプリ」に保存し、LINE で通知します。
緊急案件は定時を待たず Webhook で即時通知します。

---

## 特長

- ✅ **設計書だけでなく動くコード**：ローカルでも n8n でも同じ処理を実行可能
- ✅ **n8n インポート用 JSON 同梱**（定時＋緊急の2本）
- ✅ **安全設計**：APIキーは環境変数 / 最小権限 / 重複送信防止 / リトライ / 本番・テスト分離
- ✅ **初心者向けドキュメント**：導入・テスト・エラー対応マニュアルを完備
- ✅ **ネットワーク不要のユニットテスト**：`npm test`

---

## クイックスタート

```bash
cd daily-report-system
cp .env.example .env         # 値を記入（未確定は TODO のまま）
npm test                     # ① まずはオフラインのユニットテスト（9件）

# ② Claude 分析をサンプルで試す（ANTHROPIC_API_KEY が必要）
node scripts/callClaude.js --file=samples/sample-daily-reports.json

# ③ 通し実行（Kintone/LINE の設定が済んだら）
node scripts/runPipeline.js
```

> `APP_ENV=test`（既定）の間、LINE は実送信されずプレビューのみ。安全に検証できます。

---

## プロジェクト構成

```
daily-report-system/
├── README.md                     このファイル
├── .env.example                  環境変数サンプル（→ .env にコピー）
├── package.json                  npm スクリプト
├── lib/                          共通ライブラリ（依存パッケージ0・標準機能のみ）
│   ├── env.js                    .env 読み込み / 必須チェック / マスク
│   ├── httpRetry.js              指数バックオフ付き fetch（429/5xx/障害）
│   ├── date.js                   タイムゾーン対応の日付
│   ├── kintone.js                Kintone 取得・保存・重複チェック
│   ├── claude.js                 Claude API 呼び出し / JSON 抽出
│   ├── line.js                   LINE push / 文字数・吹き出し分割 / test分離
│   ├── normalize.js              Kintoneレコード → Claude入力
│   └── format.js                 Claude出力 → 経営日報/LINE本文/保存レコード
├── kintone/
│   ├── staffReportSchema.js      スタッフ日報アプリ フィールド定義
│   ├── aiReportSchema.js         AI経営日報アプリ フィールド定義
│   ├── inspectApp.js             既存アプリの構成を調査し過不足を判定
│   ├── addFields.js              既存アプリに不足フィールドだけ追加
│   └── createApps.js             2アプリを新規自動作成（要パスワード認証）
├── scripts/                      APIサンプル & 実行スクリプト
│   ├── fetchDailyReports.js      日報取得
│   ├── callClaude.js             Claude分析だけ
│   ├── saveAiReport.js           保存だけ
│   ├── sendLine.js               LINE送信だけ
│   ├── runPipeline.js            定時パイプライン（①のローカル版・E2E）
│   ├── urgentNotify.js           緊急即時通知（②のローカル版）
│   └── lineWebhookPeek.js        userId/groupId 確認ヘルパー
├── prompts/                      Claude プロンプト
│   ├── daily-report-system-prompt.md
│   ├── daily-report-user-template.md
│   └── urgent-summary-prompt.md
├── n8n/                          n8n インポート用 JSON
│   ├── workflow-1-daily-report.json      ①定時: Schedule→Kintone→Claude→保存→LINE→ログ
│   └── workflow-2-urgent-webhook.json    ②緊急: Webhook→分岐→Claude→LINE→更新
├── samples/                      サンプルデータ
│   ├── sample-daily-reports.json
│   ├── sample-urgent.json
│   └── sample-claude-output.json
├── docs/                         ドキュメント
│   ├── setup-guide.md            導入マニュアル（最短ルート）
│   ├── phases.md                 実装順 Phase 1〜8
│   ├── test-guide.md             テスト手順書
│   ├── error-handling.md         エラー対応マニュアル
│   ├── kintone-staff-report-app.md   Kintone設定書①
│   ├── kintone-ai-report-app.md      Kintone設定書②
│   └── line-setup.md             LINE設定書
└── test/
    └── format.test.js            ユニットテスト（ネットワーク不要）
```

---

## npm スクリプト

| コマンド | 内容 |
|----------|------|
| `npm test` | ユニットテスト（オフライン） |
| `npm run apps` | Kintone アプリ一覧とIDを表示 |
| `npm run inspect -- <appId>` | 既存アプリの構成と不足フィールドを確認 |
| `npm run add-fields -- <appId> --dry-run` | 既存アプリへ不足分を追加（まず dry-run） |
| `npm run create-apps` | Kintone 2アプリを新規自動作成 |
| `npm run fetch` | スタッフ日報を取得 |
| `npm run analyze` | Claude 分析（out/reports を入力） |
| `npm run save` | AI経営日報へ保存 |
| `npm run line` | LINE 送信テスト |
| `npm run pipeline` | 定時パイプライン通し実行 |
| `npm run urgent` | 緊急即時通知 |

---

## 2つの n8n ワークフロー

**① 定時（毎日 REPORT_SEND_TIME）**
`Schedule Trigger → Kintone取得 → (0件分岐) → Claude API → 応答整形 → Kintone保存 → LINE通知 → 送信結果書き戻し`

**② 緊急（リアルタイム）**
`Webhook → シークレット検証 → 緊急判定 → Claude要約 → LINE即時通知 → 通知済み更新`

各ノードの設定・入出力・認証・エラー処理は JSON 内の `notes` と `docs/` を参照。

---

## 実装ステータス

| フェーズ | 内容 | 状態 |
|----------|------|------|
| Phase 1 | Kintone アプリ作成 | コード・設計書 完備（実行は要 Kintone 認証） |
| Phase 2 | API 接続 | 実装済み |
| Phase 3 | Claude 連携 | 実装済み（要 APIキー） |
| Phase 4 | LINE 送信 | 実装済み（要トークン/宛先） |
| Phase 5 | n8n 定時 | JSON 提供済み（要インポート・環境変数） |
| Phase 6 | 緊急通知 | JSON 提供済み |
| Phase 7 | エラー処理 | 実装済み（`docs/error-handling.md`） |
| Phase 8 | 本番テスト | 手順提供（`docs/test-guide.md`） |

> **要確認（TODO）**：Kintone appId / 各種トークン / LINE 宛先ID / n8n Webhook URL は
> 実環境で発行後に `.env`（と n8n 環境変数）へ設定してください。すべて `.env.example` に一覧化しています。

詳しい導入は **`docs/setup-guide.md`** から。
