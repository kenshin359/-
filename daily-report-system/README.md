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
- ✅ **ネットワーク不要のユニットテスト**：`npm test`（24件）
- ✅ **元データは読むだけ**：日報アプリへ書き込まないことをテストで自動保証

---

## クイックスタート

**👉 ターミナル（黒い画面）を使いたくない方は
[`docs/n8n-only-setup.md`](./docs/n8n-only-setup.md) を読んでください。
ブラウザだけで完結します。これが一番おすすめです。**

パソコン操作に抵抗がない方は下記、またはより丁寧な [`docs/START-HERE.md`](./docs/START-HERE.md) へ。

```bash
cd daily-report-system

npm run setup       # ① 対話式セットアップ（質問に答えるだけ／接続テスト付き）
npm run doctor      # ② 設定の総点検（NGなら日本語で直し方を表示）
npm run pipeline    # ③ 実行（取得→AI分析→保存→LINE）
```

`npm run setup` が自動でやること：

- Kintone から**日報アプリを自動検出**
- **いまの構造のまま日報を読み取れるか実際に試して表示**（Kintone側は一切変更しません）
- **AI経営日報アプリを自動作成**（保存先として1つだけ）
- 入力値をその場で**実際に接続テスト**して `.env` を書き出し

> `APP_ENV=test`（既定）の間、LINE は実送信されずプレビューのみ。安全に検証できます。
> **APIトークンの発行は不要**です（KintoneのID/パスワードだけで動きます。トークンを設定すればそちらが優先されます）。

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
│   ├── chatwork.js               Chatwork 送信 / 装飾 / 分割 ★
│   ├── notify.js                 通知先の集約（LINE / Chatwork / 両方）★
│   ├── normalize.js              Kintoneレコード → Claude入力（構造化アプリ用）
│   ├── extractReports.js         実際の日報アプリ構造から日付/氏名/本文を抽出 ★
│   └── format.js                 Claude出力 → 経営日報/LINE本文/保存レコード
├── kintone/
│   ├── staffReportSchema.js      スタッフ日報アプリ フィールド定義
│   ├── aiReportSchema.js         AI経営日報アプリ フィールド定義
│   ├── inspectApp.js             既存アプリの構成を調査し過不足を判定
│   ├── addFields.js              既存アプリに不足フィールドだけ追加
│   └── createApps.js             2アプリを新規自動作成（要パスワード認証）
├── scripts/                      APIサンプル & 実行スクリプト
│   ├── setup.js                  対話式セットアップウィザード（初心者向け）
│   ├── doctor.js                 設定の総点検（接続テスト＋直し方の案内）
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
│   ├── workflow-0-setup.json             ⓪初期設定: AI経営日報アプリを自動作成（1回だけ）★
│   ├── workflow-1-daily-report.json      ①定時: Schedule→Kintone→Claude→保存→通知→ログ
│   ├── workflow-3-notify-on-submit.json  ③提出のたびに即時通知（10分間隔）★
│   ├── workflow-4-line-id-finder.json    ④LINE送信先IDを調べる（設定時のみ）★
│   └── workflow-2-urgent-webhook.json    ②緊急: Webhook→分岐→Claude→LINE→更新
├── samples/                      サンプルデータ
│   ├── sample-daily-reports.json
│   ├── sample-urgent.json
│   └── sample-claude-output.json
├── docs/                         ドキュメント
│   ├── START-HERE.md             ど素人向け導入ガイド（まずこれ）
│   ├── n8n-only-setup.md         ブラウザだけで完結する導入手順（ターミナル不要）★
│   ├── backup-and-safety.md      バックアップと安全性（元データ非変更の保証）★
│   ├── actual-kintone-structure.md  実際のKintone構造と対応方針 ★
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
| `npm run setup` | **対話式セットアップ**（まずこれ） |
| `npm run doctor` | **設定の総点検**（困ったらこれ） |
| `npm run backup` | **元データのバックアップ**（読み取りのみ） |
| `npm test` | ユニットテスト（オフライン・184件） |
| `npm run sales` | **売上レポート**（CSV から・Amazon/楽天/自社/Meta/RPP・費用ゼロ） |
| `npm run monthly` | **月次売上レポート**（Kintone売上アプリから・費用ゼロ） |
| `npm run dashboard` | **販売ダッシュボード**を生成（グラフ＋商品ドリルダウン・費用ゼロ） |
| `npm run brief` | **経営ブリーフィング**（AI経営チームを実行） |
| `npm run create-business-apps` | 在庫数・広告費アプリをKintoneに作成 |
| `npm run build:n8n` | 売上ワークフローJSONを再生成 |
| `npm run apps` | Kintone アプリ一覧とIDを表示 |
| `npm run inspect -- <appId>` | 既存アプリの構成と不足フィールドを確認 |
| `npm run add-fields -- <appId> --dry-run` | 既存アプリへ不足分を追加（まず dry-run） |
| `npm run create-apps` | Kintone 2アプリを新規自動作成 |
| `npm run fetch` | スタッフ日報を取得 |
| `npm run analyze` | Claude 分析（out/reports を入力） |
| `npm run save` | AI経営日報へ保存 |
| `npm run notify-test` | 通知テスト（LINE / Chatwork） |
| `npm run watch` | 新規提出を検知して通知 |
| `npm run pipeline` | 定時パイプライン通し実行 |
| `npm run urgent` | 緊急即時通知 |

---

## 2つの n8n ワークフロー

**① 定時（毎日 REPORT_SEND_TIME）**
`Schedule Trigger → Kintone取得 → (0件分岐) → Claude API → 応答整形 → Kintone保存 → LINE通知 → 送信結果書き戻し`

**② 緊急（リアルタイム）**
`Webhook → シークレット検証 → 緊急判定 → Claude要約 → LINE即時通知 → 通知済み更新`

**⑥ 売上レポート（毎朝10:00）**
`Schedule Trigger → CSV読込 → 集計(Code) → (0件分岐) → Chatwork通知 / LINE通知`

各ノードの設定・入出力・認証・エラー処理は JSON 内の `notes` と `docs/` を参照。

---

## 売上レポート（Amazon / 楽天 / 自社 / Meta広告 / RPP広告）

CSVを `data/sales/` に置いて `npm run sales` を実行すると、
総売上・媒体別・前日比・広告費・ROAS・売れ筋を1通にまとめて通知します。

手順は **[docs/sales-report-setup.md](docs/sales-report-setup.md)** を参照。

**設計上の要点**

- **金額の集計はすべて JavaScript 側で行い、AIには渡さない。**
  LLM に大量の加算をさせると金額がずれるため。AIの役割は「解釈」のみ。
- そのため通常運用の **API費用はゼロ**。`SALES_AI_COMMENT=true` のときだけ
  集計済みの数字を渡して一言コメントを生成する（1回あたり数円）。
- 文字コード（Shift_JIS/UTF-8/BOM/UTF-16）、引用符内のカンマ・改行、
  タブ区切り、金額・日付の表記ゆれ、合計行の混入を自動で吸収する。
- 判別できないファイルは黙って捨てず、レポート末尾の【要確認】に理由を出す。
- n8n の Code ノードは import が使えないため集計処理を複製しているが、
  `n8n/snippets/salesInline.js` を単一の元とし、`npm run build:n8n` で
  JSONへ埋め込む。複製のズレは `test/sales-inline.test.js` が毎回検出する。

**⚠️ 実データは絶対にコミットしない。** `data/` は `.gitignore` 済み。
`samples/sales/` は全て架空のダミーデータ。

---

## 販売ダッシュボード

```bash
npm run dashboard      # Kintone から取得 → out/dashboard.html を生成
```

売上・販売個数・転換率・アクセス数・お気に入り登録を、チャネル別のグラフで表示。
**商品名を押すと、その商品のチャネル別販売個数・転換率・ランキングが開きます。**

- 配色は検証済みパレット（`validate_palette.js` を light/dark 両モードで全項目PASS）
- 明モードで一部の系列色が対サーフェス3:1未満のため、凡例・直接ラベル・表示切替を必ず併設
- 転換率とアクセス数は単位が違うので**別グラフ**にしている（2軸グラフは作らない）
- ランキングは上下反転（**上に行くほど上位**）
- テンプレートは `dashboard/template.html`、実データは `out/`（gitignore済み）

## AI経営チーム

日報を要約する1つのAIから、**部署に分けた構成**に変更しました。

| # | 部署 | 見るもの |
|---|------|---------|
| 01 | 経営企画室 | 打ち手と優先順位（今週/今月/監視） |
| 02 | 財務部 | 売上・広告費・異常値 |
| 03 | マーケティング部 | 転換率・アクセス・商品別（集客と転換の切り分け） |
| 04 | サプライチェーン部 | 欠品・在庫・機会損失 |
| 05 | 品質・リスク管理室 | 安全・法令・クレーム |
| 06 | 人事・現場運営 | 提出率・稼働・承認待ち |
| 00 | 統括補佐 | 全部署を1枚に統合 |

設計は `prompts/team/README.md`、実行は `lib/aiTeam.js`。

- **計算はすべてJS側**で終わらせ、AIには結果だけ渡す（金額のズレ防止＋費用削減）
- **データが無い部署は動かさない**（幻の指摘と無駄な費用を防ぐ）
- **1部署が落ちても他は続行**する
- 全部署ぶんの入力は実データで約170トークン（費用は誤差の範囲）

---

## 実装ステータス

| フェーズ | 内容 | 状態 |
|----------|------|------|
| Phase 1 | Kintone アプリ | **変更不要**（既存の日報アプリをそのまま読む方式に変更） |
| Phase 2 | API 接続 | 実装済み |
| Phase 3 | Claude 連携 | 実装済み（要 APIキー） |
| Phase 4 | LINE 送信 | 実装済み（要トークン/宛先） |
| Phase 5 | n8n 定時 | JSON 提供済み（要インポート・環境変数） |
| Phase 6 | 緊急通知 | JSON 提供済み |
| Phase 7 | エラー処理 | 実装済み（`docs/error-handling.md`） |
| Phase 8 | 本番テスト | 手順提供（`docs/test-guide.md`） |

> **要確認（TODO）**：Kintone appId / 各種トークン / LINE 宛先ID / n8n Webhook URL は
> 実環境で発行後に `.env`（と n8n 環境変数）へ設定してください。すべて `.env.example` に一覧化しています。

実際のKintoneの構造と、それに対する対応方針は
**[`docs/actual-kintone-structure.md`](./docs/actual-kintone-structure.md)** にまとめています。

詳しい導入は **`docs/setup-guide.md`** から。
