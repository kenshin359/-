# テスト手順書

各機能を「小さく」テストするための手順です。上から順に実施してください。
`APP_ENV=test` のうちは LINE は実送信されません（安全）。

---

## 0. 事前準備

```bash
cd daily-report-system
cp .env.example .env      # 値を記入（未確定は TODO のまま）
node --version            # v18 以上であること
```

## 1. ユニットテスト（ネットワーク不要）

```bash
npm test
```
- 期待：`# pass 9 / # fail 0`
- 検証内容：整形・LINE分割・JSONパース・正規化・保存形式。

## 2. Kintone 取得テスト（Phase 2）

```bash
node scripts/fetchDailyReports.js --date=2026-07-28
```
- 期待：件数と各スタッフの要約が表示され、`out/reports-2026-07-28.json` が生成される。
- 0件でもエラーにならないこと。

## 3. Claude 分析テスト（Phase 3・APIキー必要）

```bash
# サンプルデータで（Kintone不要）
node scripts/callClaude.js --file=samples/sample-daily-reports.json
```
- 期待：経営日報 & LINE本文のプレビュー。`out/analysis-*.json` 生成。
- 情報が無い項目が `情報不足` になっていること。緊急サンプルは 🔴 になること。

## 4. LINE 送信テスト（Phase 4）

```bash
# test 環境：プレビューのみ
node scripts/sendLine.js "疎通テスト"

# 本番送信を確認（.env で APP_ENV=production にしてから／確認後 test に戻す）
node scripts/sendLine.js
```
- 期待：test ではプレビュー、production では実際にLINEへ届く。

## 5. エンドツーエンド（ローカル・Phase 5相当）

```bash
# Kintone → Claude → 保存 → (LINE) → 書き戻し を一気通貫
node scripts/runPipeline.js --date=2026-07-28
```
- 期待：AI経営日報アプリにレコードが1件増える。test では LINE はプレビュー。
- もう一度同じ日で実行 → 「既に存在」でスキップ（**重複送信防止の確認**）。

## 6. 緊急通知テスト（Phase 6）

### ローカル
```bash
node scripts/urgentNotify.js --file=samples/sample-urgent.json
```

### n8n Webhook（curl）
```bash
curl -X POST "$N8N_WEBHOOK_URL" \
  -H "content-type: application/json" \
  -H "x-webhook-secret: $WEBHOOK_SECRET" \
  -d @samples/sample-urgent.json
```
- 期待：緊急要約が LINE 即時通知で届く（🚨）。
- 非緊急データ（`urgency` を「通常」に変えたもの）を送ると `skipped` になること。
- シークレットを間違えると 401 が返ること。

## 7. 異常系テスト（Phase 7）

| テスト | 方法 | 期待 |
|--------|------|------|
| トークン不正 | `.env` のトークンを壊して fetch | 401 で即停止、リトライしない |
| 日報0件 | 提出が無い日で runPipeline | 未提出通知＋記録レコード |
| 重複実行 | 同じ日で2回 runPipeline | 2回目スキップ |
| 文字数超過 | 長文を sendLine | 4,800字で分割送信 |
| レート/5xx | （擬似）不安定時 | 指数バックオフ再試行 |

## 8. 本番テスト（Phase 8）

- `.env` を production にして 1週間並走。
- 毎朝、社長・部長に「30秒で把握できたか」を確認し、`prompts/` を微調整。
