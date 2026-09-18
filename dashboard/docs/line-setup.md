# LINE監査役ボット セットアップ手順（北野さん向け）

対象: `dashboard/`（PRO版 §5 ⑬ LINE監査役）。公式LINEアカウント「監査役」をチームのグループに招待すると、
①メッセージを保存 ②依頼・期限・約束を抽出して「追いかけ」に登録 ③未完了を自動でリマインド ④定時投稿（朝の予定・夕方まとめ・期限リマインド）
⑤監査ログ（誰が・何を・いつ依頼し、いつ完了したか）を `/pro/line` で確認できます。

---

## 1. LINE Developers で Messaging API チャネルを作る

1. https://developers.line.biz/console/ にログイン（LINE公式アカウントと同じLINEビジネスIDで可）。
2. プロバイダーを作成（例: 「株式会社リベティ」）→「新規チャネル作成」→ **Messaging API**。
   - チャネル名: `監査役`（グループ内で表示される名前）
   - 業種・メール等を入力して作成。
3. 作成したチャネルの **チャネル基本設定** タブ → 「チャネルシークレット」を控える（→ `LINE_CHANNEL_SECRET`）。
4. **Messaging API設定** タブ → 「チャネルアクセストークン（長期）」を **発行** して控える（→ `LINE_CHANNEL_ACCESS_TOKEN`）。
   - トークンはVercelの環境変数にだけ入れる。Chatwork・LINE・リポジトリに貼らない。

## 2. グループ参加を許可する

Messaging API設定 タブ内の「LINE公式アカウント機能」から **LINE Official Account Manager** を開き:

- 設定 → **応答設定**: 「応答メッセージ」オフ、「Webhook」オン（あいさつメッセージはお好みで。ボット側でも参加時に挨拶します）。
- 設定 → アカウント設定 → 機能の利用 → **グループ・複数人チャットへの参加を許可する**。

## 3. Webhook URL を登録する

Messaging API設定 タブ → Webhook設定:

- Webhook URL: `https://<本番ドメイン>/api/line/webhook`
- 「Webhookの利用」を **オン**
- 「検証」ボタンを押して成功（200）を確認。※ 環境変数（次項）を先にVercelへ入れてデプロイしてから。

## 4. 環境変数（Vercel → Project → Settings → Environment Variables）

| 変数名 | 値 | 用途 |
|---|---|---|
| `LINE_CHANNEL_SECRET` | チャネルシークレット | Webhook の署名検証（HMAC-SHA256） |
| `LINE_CHANNEL_ACCESS_TOKEN` | チャネルアクセストークン（長期） | グループへの push / reply |
| `CRON_SECRET` | `openssl rand -base64 32` で生成した文字列 | 定期処理 `/api/line/cron` の保護。Vercel Cron は自動で `Authorization: Bearer <CRON_SECRET>` を付けて呼ぶ |

未設定のときは `/pro/line` に「未接続（変数名）」と表示され、Webhook は `{ok:false, reason:'not_configured'}` を返すだけで落ちません。
`.env.example` にも空欄で記載しています（本物の値は書かない）。

## 5. Vercel Cron（vercel.json）

`vercel.json` に以下を追加してください（10分おきに追いかけ・定時投稿を判定）:

```json
{ "crons": [{ "path": "/api/line/cron", "schedule": "*/10 * * * *" }] }
```

- 既に `crons` がある場合は配列に1件追加。
- Vercel Cron のスケジュールは **UTC** ですが、`*/10` は時差の影響を受けません。定時投稿の cron（画面で設定）は **JST** で評価します。
- Hobby プランは実行時刻が数分ずれることがあります。ボット側は「直近15分以内に一致した枠」を見るので、ずれても1回だけ投稿します。

## 6. 周知文テンプレート（グループへ貼る）

```
【お知らせ】このグループに「監査役」（LINE公式アカウント）を招待しました。
・「〜お願いします」「〜までに」「〜やります」といった依頼・約束を記録します
・期限の朝9時から未完了分を追いかけます（最大5回）
・終わったら「完了しました」と返信してください（依頼のメッセージを引用して返信すると確実です）
・朝の予定／夕方の期限リマインドを自動投稿します
記録した内容は管理画面（PRO → LINE監査役）で確認・タスク化できます。
```

## 7. 制約・注意

- **招待前のメッセージは読めません**（LINEの仕様。Webhookは招待後に届いた分だけ）。
- 無料プランの push は **月200通** まで（reply は無料）。追いかけ＋定時投稿の合計が200通を超えるとエラーになるため、
  グループ数×（定時投稿回数＋追いかけ件数）を目安に計画してください。超える場合はライトプラン以上へ。
- 表示名の取得はプラン・友だち状態により失敗することがあります（その場合は「（不明）」）。担当は本文の「@名前」「名前さん」からも取ります。
- 抽出はルールベース（LLM不使用）です。誤検出は管理画面で「取り下げ」、抽出漏れは「手動で追加」してください。
- 本文はDBにのみ保存し、ログにはIDと文字数だけを出します。管理画面の本文表示は管理職以上のみ（リーダーは件数・時刻のみ）。

## 8. 動作確認手順

### 8-1. 署名付きサンプルで Webhook を叩く（ローカル or 本番）

```bash
# 一時的なシークレットで試す（ローカルの .env に LINE_CHANNEL_SECRET=testsecret, LINE_CHANNEL_ACCESS_TOKEN=dummy を入れて npm run dev）
SECRET=testsecret
BODY='{"destination":"U0","events":[{"type":"message","timestamp":1758153600000,"webhookEventId":"01","deliveryContext":{"isRedelivery":false},"replyToken":"dummy","source":{"type":"group","groupId":"Ctest0000000000000000000000000001","userId":"Utest"},"message":{"id":"m0001","type":"text","text":"@角南 広告CSVを9/20までに添付お願いします"}}]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -binary | base64)
curl -s -X POST http://localhost:3000/api/line/webhook \
  -H "Content-Type: application/json" -H "X-Line-Signature: $SIG" --data-binary "$BODY"
# → {"ok":true,"handled":["message.text"]}  （reply はダミートークンのため失敗しますが処理は続きます）
# 署名を壊すと 401: -H "X-Line-Signature: xxx"
```

その後 `/pro/line` → 「追いかけ」に「広告CSVを9/20までに添付お願いします（担当: 角南・期限: 9/20）」が出ていれば成功。
同じ BODY をもう一度送っても二重登録されない（`handled: ["message.dup"]`）ことも確認してください。

完了報告の確認:

```bash
BODY='{"destination":"U0","events":[{"type":"message","timestamp":1758153700000,"webhookEventId":"02","source":{"type":"group","groupId":"Ctest0000000000000000000000000001","userId":"Utest"},"message":{"id":"m0002","type":"text","text":"広告CSV 添付完了しました","quotedMessageId":"m0001"}}]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -binary | base64)
curl -s -X POST http://localhost:3000/api/line/webhook -H "Content-Type: application/json" -H "X-Line-Signature: $SIG" --data-binary "$BODY"
```

→ 追いかけが「完了」になり、監査ログに「完了」が残ります。

### 8-2. 定期処理を手で叩く

```bash
curl -s https://<本番ドメイン>/api/line/cron -H "Authorization: Bearer $CRON_SECRET"
# → {"ok":true,"reminders":{"sent":0,"failed":0,"capped":0},"posts":{"fired":[],"skipped":[],"total":0}}
```

### 8-3. 実グループでの確認（本番）

1. LINEでテスト用グループを作り「監査役」を招待 → 「監査役が参加しました。…」の挨拶が来る。
2. 「@○○ △△を明日までにお願いします」と送る → 「📝 記録しました: …」の返信。
3. `/pro/line` → グループの「部署」を設定（定時投稿にそのチームの Kintone タスクが載る）。
4. 「定時投稿」で `0 8 * * 1-5` まとめ／`0 18 * * *` 期限リマインドを登録。
5. 翌朝9時以降に追いかけが届く → 「完了しました」で完了になる。
