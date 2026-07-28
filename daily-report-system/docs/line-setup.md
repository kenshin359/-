# LINE 設定書：公式アカウント & Messaging API

社長・部長へ日報を届けるための LINE 設定手順です。

---

## 1. LINE公式アカウントを作る

1. [LINE Official Account Manager](https://manager.line.biz/) にログイン
2. 「作成」→ アカウント名（例：`Libetee 日報Bot`）を作成
3. 無料プランでOK（push 通知の無料通数に注意。人数が少なければ十分）

## 2. Messaging API を有効化

1. [LINE Developers](https://developers.line.biz/) にログイン
2. プロバイダーを作成（例：`Libetee`）
3. 上で作った公式アカウントと Messaging API チャネルを連携
   （Official Account Manager の「設定 → Messaging API」から有効化）
4. **チャネルアクセストークン（長期）** を発行
   → `.env` の `LINE_CHANNEL_ACCESS_TOKEN` に設定
5. 応答設定で **「あいさつメッセージ」「自動応答」を OFF**、**「Webhook」を任意**（push だけなら不要）

---

## 3. 送信先ID（userId / groupId）を取得する

push 送信には宛先IDが必要です。**グループ送信を推奨**（社長・部長を1グループにまとめる）。

### 方法A：グループに送る（推奨）

1. 社長・部長・Bot を含む LINE グループを作る
2. Bot をグループに招待できるよう、Messaging API チャネルの
   **「グループtrやマルチトーク参加を許可」** を ON
3. `groupId` は、グループでBotが受け取った Webhook イベントの `source.groupId` に入っています。
   一時的に Webhook を有効化して確認するか、下記スクリプトで取得します。

### 方法B：個人に送る

1. 社長・部長それぞれが Bot を友だち追加
2. 友だち追加時の Webhook イベントの `source.userId` を控える
3. `.env` の `LINE_TARGET_USER_ID` に設定

> **要確認**：`groupId` / `userId` は Webhook で取得するのが確実です。
> このリポジトリの `scripts/lineWebhookPeek.js`（下記）を一時的に立てて確認してください。

---

## 4. 送信テスト

```bash
# APP_ENV=test の間は実送信されず本文プレビューだけ（安全）
node scripts/sendLine.js "テスト送信です"

# 本番送信を試す場合（.env の APP_ENV=production に変更してから）
node scripts/sendLine.js
```

---

## 5. 制限と分割

- 1テキストメッセージ：**5,000文字**まで（本システムは 4,800 字で自動分割）
- push 1回：**最大5吹き出し**まで（本システムは5件ずつに分割して複数回送信）
- 無料メッセージ通数：プランに依存。超過すると 429/課金対象になるため、
  1日1回の定時 + 緊急のみに絞る設計にしています。

---

## 6. 宛先の優先順位（実装仕様）

`lib/line.js` は次の優先順で宛先を決めます：

1. コード内で明示指定した `to`
2. `LINE_TARGET_GROUP_ID`（グループ）
3. `LINE_TARGET_USER_ID`（個人）

グループIDを設定しておけば、そのグループに届きます。
