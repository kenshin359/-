# 業務タスク カレンダー × kintone × Chatwork 連携手順

カレンダー可視化ツール（[`../../task-calendar/`](../../task-calendar/)）を、
kintone の「業務タスク」アプリと接続し、毎朝 Chatwork に締切・遅延を通知するまでの手順です。

> パソコンが得意でなくても大丈夫です。上から順に進めてください。
> **kintone は読むだけ**で、既存アプリは一切変更しません。

---

## 全体像

```
kintone「業務タスク」アプリ
        │  npm run task:export   … 読み取り（変更しない）
        ▼
   out/task-data.json
        │  npm run task:build    … HTMLに埋め込み
        ▼
 out/task-calendar.html  ←ブラウザで開く（実データのカレンダー）

kintone「業務タスク」 ──▶ npm run task:notify ──▶ Chatwork（締切・遅延の通知）
```

---

## 1. 設定（.env）

`daily-report-system/.env` に以下を設定します（`.env.example` をコピー）。

```
KINTONE_BASE_URL=https://＜サブドメイン＞.cybozu.com
KINTONE_TASK_APP_ID=＜業務タスクアプリのID＞
KINTONE_API_TOKEN_TASK=＜レコード閲覧の権限をつけたAPIトークン＞

CHATWORK_API_TOKEN=＜ChatworkのAPIトークン＞
CHATWORK_TASK_ROOM_ID=＜【業務進捗通知】ルームのID＞   # 進捗通知の送信先
CHATWORK_ROOM_ID=＜通知したいルームID＞               # 予備（TASK未設定時に使用）
APP_ENV=test        # 動作確認の間は test（送信されません）。本番送信は production
```

> 進捗の通知は `CHATWORK_TASK_ROOM_ID` に届きます（例：Chatworkの「【業務進捗通知】」
> グループ。ルームIDは、そのルームを開いたURL末尾の数字、またはルーム情報の「ルームID」）。

## 2. 「業務タスク」アプリを用意する

すでにタスク管理アプリがあれば、その **アプリID** を `KINTONE_TASK_APP_ID` に入れ、
フィールドコードを下表に合わせれば使えます。無ければ自動作成できます：

```
# 一時的に .env へ KINTONE_USER / KINTONE_PASSWORD を設定してから
npm run task:create-app          # 「業務タスク」アプリを作成
npm run task:create-app -- --dry-run   # 作らずに項目だけ確認
```

作成されるフィールド（コード＝表示名）：

| コード | 表示名 | 種類 | 選択肢 |
|---|---|---|---|
| `task_title` | タスク名 | 文字列1行（必須） | |
| `assignee` | 担当者 | 文字列1行（必須） | 氏名 |
| `team` | チーム | ドロップダウン（必須） | 本部/広告運用/SNS/LP/CS/社長室/TikTok/アルバイト |
| `category` | 種別 | ドロップダウン | 会議/資料作成/顧客対応/出荷・物流/分析/開発/レビュー |
| `priority` | 優先度 | ドロップダウン | 高/中/低 |
| `status` | ステータス | ドロップダウン（必須） | 未着手/進行中/完了/遅延 |
| `due_date` | 期日 | 日付（必須） | |

## 3. カレンダーに実データを表示する

```
npm run task:sync     # 取得 → HTML生成 を一気に
# もしくは個別に：
npm run task:export   # kintone → out/task-data.json
npm run task:build    # → out/task-calendar.html
```

`task-calendar/out/task-calendar.html` をブラウザで開くと、実データのカレンダーが見られます。
（トークンはHTMLに含めません。安全です。）

## 4. Chatwork に締切・遅延を通知する

```
npm run task:notify                     # まずは test：送らずにプレビュー
APP_ENV=production npm run task:notify   # 本番送信
```

- 全体サマリーを `CHATWORK_ROOM_ID` に送ります（**遅延が1件でもあれば `[toall]`** で全員に注意喚起）。
- チーム別に分けたい場合は、`.env` に `CHATWORK_ROOM_<TEAM>` を追加すると、
  そのチームの分だけ専用ルームにも届きます（`<TEAM>`＝`AD`/`LP`/`CS`…）。

**通知の例**

```
【業務タスク】本日の締切・遅延サマリー 2026-08-02
本日締切 2件 ／ 遅延 1件 ／ 進行中 1件 ／ 全 5件

[広告運用チーム]  本日締切 1 / 遅延 1
⚠ ・【高】広告入稿チェック（黒葛原）[遅延]
● ・【高】広告レポート作成（角南）[進行中]
```

## 5. 進捗の随時通知（着手・完了・遅延・停滞）

タスクの状態が変わったら、その都度 Chatwork に通知します。Webhookは不要で、
**定期実行するたびに「前回との変化」を検知**して送ります。

| 通知 | いつ |
|---|---|
| 🚀 **着手** | 未着手／遅延 → 進行中 になったとき |
| ✅ **完了** | → 完了 になったとき |
| ⚠ **遅延** | 期限を過ぎても未完了、またはステータスが遅延になったとき（未完了の間、1回だけ） |
| ⏰ **未着手（要着手）** | 未着手のまま期限が近い（既定：2日以内。`--stall-days=3` で変更可） |

```
# はじめに1回だけ：今の状態を基準として登録（この時は通知しません）
node scripts/watchTasks.js --baseline

# 以降、これを定期実行（変化があった時だけ通知）
npm run task:watch                       # test：送らずプレビュー
APP_ENV=production npm run task:watch     # 本番送信
```

- 送信先は `CHATWORK_TASK_ROOM_ID`（無ければ `CHATWORK_ROOM_ID`）。
- 遅延が含まれるときは `[toall]` で全員に注意喚起します。
- 変化が無ければ何も送りません（頻繁に回しても静かです）。
- 同じ遅延・停滞を毎回くり返さないよう、`state/task-status.json` で記録します（gitignore済み）。

**通知の例**

```
【業務進捗通知】タスク更新 3件

⏰ 未着手（要着手）（1）
・【高】新規バナー作成（内田 / SNSチーム）　本日締切

🚀 着手（1）
・LP改修（黒葛原 / LPチーム）

✅ 完了（1）
・広告レポート作成（角南 / 広告運用チーム）
```

## 6. 定期実行の設定（cron / n8n）

- **進捗の随時通知**：15〜30分おきがおすすめ（早いほど “随時” に近づきます）。
- **締切サマリー**：毎朝1回（例：8:30）。
- **カレンダー最新化**：数時間おき、または朝1回。

cron の例（Linux サーバー）：

```
# 15分おきに進捗通知
*/15 * * * *  cd /path/to/daily-report-system && APP_ENV=production npm run task:watch  >> /var/log/task-watch.log 2>&1
# 毎朝8:30に締切サマリー
30 8 * * *    cd /path/to/daily-report-system && APP_ENV=production npm run task:notify
# 毎朝8:00にカレンダー最新化
0 8 * * *     cd /path/to/daily-report-system && npm run task:sync
```

---

## よくある質問

- **Q. kintone を書き換えませんか？** … いいえ。取得（GET）のみです。
- **Q. トークンが外部に漏れませんか？** … `.env` は gitignore 済み。生成HTMLにも入りません。
- **Q. 担当者をkintoneのユーザー選択にしたい** … `taskAppSchema.js` の `assignee` を
  `USER_SELECT` に変更してください（表示名の取り出しは `lib/taskData.js` の `FIELD` 付近で調整）。
