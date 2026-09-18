# LINE公式アカウント AI自動応答（AI公式ライン）設定手順

最終更新: 2026-09-18

お客様がLINE公式アカウントに送ったメッセージに、AI（Claude）が **事実カードの範囲で** 自動返信します。
返品・不良・注文の確認など人が対応すべき内容は、一次回答をしたうえでスタッフに通知し、ダッシュボードの「LINE対応」画面に要対応として残ります。

```
お客様 ──LINE──▶ LINE公式アカウント ──Webhook──▶ ダッシュボード(Vercel) /api/line/webhook
                                                     │  署名検証 → 会話ログ保存 → Claude で回答生成
                                                     ├──reply──▶ お客様へ返信
                                                     └──要対応なら──▶ スタッフLINEグループ / Chatwork
```

## 仕組みの要点（先に読む）

- **AIが答えるのは `dashboard/config/line-ai-knowledge.json` の事実カードだけ。** 送料・返品条件・在庫・寸法など未登録の項目（「要データ」）は答えず、「担当スタッフが確認のうえご連絡します」と案内して要対応にします。答えられる範囲を広げたいときは、このJSONに事実を追記するだけです（プログラム変更不要）。
- **要対応の二重チェック。** AIの判断とは別に、コード側でも注意語（返品・返金・不良・発煙・けが等）を機械的に見ます。どちらかが該当すればスタッフ通知。
- **AIが使えないときも止まらない。** APIキー未設定・API障害時は固定の案内文（fallback）を返して要対応にします。成功したふりはしません。
- **会話はDBに残る。** 直近24時間・10往復を文脈としてAIに渡すので、「Mサイズは？」→「機内持ち込みは？」のような続きの質問にも答えられます。同じイベントの再送は二重処理しません。
- **返信の続きは人が引き継げる。** LINE公式アカウントマネージャーの「チャット」画面から、スタッフがそのまま返信できます（下記の応答設定が必要）。

## 費用の目安

| 項目 | 目安 |
|---|---|
| LINE公式アカウント | お客様への **返信（reply）は無料通数に数えません**。スタッフ通知の push だけが通数消費（要対応1件につき1通）。無料プランは月200通 |
| Claude API | 1問答あたり数円（事実カードはキャッシュされるため2回目以降は安くなる）。月1,000問答でも数千円程度 |
| Vercel | 既存のダッシュボードと同じプロジェクトで動くため追加費用なし（Pro の関数実行時間内） |

---

## 手順（所要 約30分）

### ① LINE公式アカウントを用意する

お客様向けの公式アカウントを使います（社内通知用の「Libetee 日報」とは別に作るのがおすすめ）。

1. https://manager.line.biz でアカウントを作成（すでにお客様向けアカウントがあればそれを使う）
2. 「設定」→「Messaging API」→「Messaging APIを利用する」（プロバイダーは `Libetee` でOK）

### ② 応答設定（重要）

LINE公式アカウントマネージャー →「設定」→「応答設定」:

| 項目 | 設定 | 理由 |
|---|---|---|
| 応答モード | **チャット** | スタッフが引き継いで返信できるようにする |
| あいさつメッセージ | **オフ** | Botが友だち追加時に挨拶を返す（文面はJSONの `bot.greeting`） |
| 応答メッセージ（自動応答） | **オフ** | LINE側の定型応答とAIが二重に返さないように |
| Webhook | **オン** | AIにメッセージを渡す |

### ③ 鍵を控える（LINE Developers）

https://developers.line.biz/console/ → プロバイダー → チャネル:

| 画面 | 項目 | 環境変数 |
|---|---|---|
| チャネル基本設定 | **チャネルシークレット** | `LINE_CHANNEL_SECRET` |
| Messaging API設定 | **チャネルアクセストークン（長期）**（「発行」を押す） | `LINE_CHANNEL_ACCESS_TOKEN` |

> ⚠️ どちらも他人に渡さないでください。チャットにも貼らず、Vercelの画面に直接入力します。

### ④ Anthropic APIキー

https://console.anthropic.com → API Keys → Create Key → `ANTHROPIC_API_KEY`。
（未設定でも動きますが、全件が固定文の案内＋要対応になります）

### ⑤ スタッフ通知先（任意・推奨）

どちらか／両方を設定。未設定なら通知はせず、ダッシュボードの「LINE対応」画面で確認する運用になります。

- **LINEグループ**: 社内通知用Bot（日報Bot）ではなく、**この公式アカウントのBot** をスタッフのグループに招待し、グループIDを `LINE_STAFF_GROUP_ID` に設定。グループIDの調べ方は `daily-report-system/docs/line-手順.md` の④B と同じ（Messaging API設定で「グループトーク参加を許可」をオン）。
- **Chatwork**: `CHATWORK_API_TOKEN` と `CHATWORK_CS_ROOM_ID`（CS用ルーム。無ければ `CHATWORK_ROOM_ID`）

### ⑥ Vercel に環境変数を入れて再デプロイ

Vercel → プロジェクト → Settings → Environment Variables（Production）:

| 変数 | 値 |
|---|---|
| `LINE_CHANNEL_SECRET` | ③のチャネルシークレット |
| `LINE_CHANNEL_ACCESS_TOKEN` | ③のアクセストークン |
| `ANTHROPIC_API_KEY` | ④のキー |
| `LINE_STAFF_GROUP_ID` | ⑤（任意） |
| `CHATWORK_API_TOKEN` / `CHATWORK_CS_ROOM_ID` | ⑤（任意） |

保存後、Deployments → 最新 → **Redeploy**。ビルド時に `prisma migrate deploy` が走り、会話ログ用テーブル `LineChatLog` が自動で作られます。

### ⑦ Webhook URL を設定して検証

1. ブラウザで `https://<ダッシュボードのドメイン>/api/line/webhook` を開き、`configured` がすべて `true` になっていることを確認
2. LINE Developers →「Messaging API設定」→ **Webhook URL** に同じURLを入力 →「更新」→「**検証**」で「成功」
3. 「Webhookの利用」を **オン**

### ⑧ テスト

1. スマホで公式アカウントを友だち追加 → 挨拶文が返る
2. 「Sサイズは機内持ち込みできますか？」→ 事実カードから回答
3. 「返品したいです」→ 一次回答＋要対応。スタッフ通知が届き、ダッシュボードの「LINE対応 → 要対応のみ」に表示される

---

## 日々の運用

- **答えられる範囲を広げる**: `dashboard/config/line-ai-knowledge.json` の `facts` に事実を追加（例: 各サイズの寸法・重量・容量、送料、返品条件）。追加した項目は `unknown` から削除。コミット→pushで自動反映。
- **要対応の確認**: ダッシュボード「LINE対応」→「要対応のみ」。返信はLINE公式アカウントマネージャーのチャット画面から。
- **文面の調整**: 挨拶（`bot.greeting`）・案内文（`bot.fallback` / `bot.handoff`）・文体（`style`）も同じJSON。
- **注意語の追加**: `always_human.keywords`。

## うまくいかないときは

| 症状 | 原因 | 直し方 |
|---|---|---|
| Webhook「検証」が失敗（401） | チャネルシークレットが違う | ③をやり直して `LINE_CHANNEL_SECRET` を入れ直し Redeploy |
| 検証が失敗（503） | `LINE_CHANNEL_SECRET` が空 | ⑥を確認 |
| 返信が来ない | 「Webhookの利用」がオフ、またはアクセストークン未設定 | ②と⑦を確認。`/api/line/webhook` を開いて `accessToken: true` か確認。Vercel の Logs に `[line-ai]` のエラーが無いか |
| 全部「担当スタッフが確認…」になる | `ANTHROPIC_API_KEY` 未設定か無効 | ④⑥を確認。Vercel の Logs に `[line-ai] Claude API error` が出ていないか |
| 「LINE対応」画面にDBエラー | マイグレーション未適用 | Redeploy（ビルドで `prisma migrate deploy` が走る） |
| 二重に返信される | LINE側の「応答メッセージ」がオン | ②で オフ |

## 実装ファイル

| ファイル | 役割 |
|---|---|
| `src/app/api/line/webhook/route.ts` | Webhook受信（署名検証→回答→返信→通知） |
| `src/lib/line/answer.ts` | Claude で回答生成（事実カードからシステムプロンプトを組み立て、JSONで受け取る） |
| `src/lib/line/escalation.ts` | 注意語による要対応判定（コード側） |
| `src/lib/line/store.ts` | 会話ログ（`LineChatLog`）の保存・履歴取得・二重配信防止 |
| `src/lib/line/notify.ts` | スタッフ通知（LINE push / Chatwork） |
| `src/lib/line/client.ts` / `signature.ts` | LINE API（reply/push）と署名検証 |
| `src/app/(app)/line/page.tsx` | ダッシュボード「LINE対応」画面 |
| `config/line-ai-knowledge.json` | 事実カード・文面・注意語（運用で編集するのはここだけ） |
| `src/lib/line/__tests__/line.test.ts` | 検算14件（署名・要対応・プロンプト・フォールバック） |
