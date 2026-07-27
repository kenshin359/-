# Libetee kintone 売上日報ツール

「売上・転換率報告」アプリを、**集計・グラフ・AI分析ができる**土台に作り直すための自動化ツール一式です。

- **作り直し仕様書** … アプリ設計の全体像（別途共有のドキュメント）
- 本リポジトリ … その設計を kintone に**自動構築**し、**過去データを移行**し、**分析**するスクリプト

## できること

| コマンド | 内容 |
|---|---|
| `npm run apps` | アプリ一覧とIDを表示（移行元IDの確認用） |
| `npm run create-app` | 「売上日報（新）」アプリを自動作成（フィールド＋デプロイまで） |
| `npm run migrate` | 既存の文章データをパースして新アプリへ投入 |
| `npm run analyze` | 月次サマリー等を出力し、分析用のきれいな数値を書き出し |
| `npm run create-weekly-app` | 「SNS/LP週次報告（新）」アプリを自動作成 |
| `npm run migrate-weekly` | SNS/LPチームの週次報告（文章）をパースして週次アプリへ投入 |
| `npm run analyze-weekly` | 週次サマリー（投稿数の推移・アカウント別内訳）を出力 |

## セットアップ

```bash
cp .env.example .env   # 値を記入（.env はコミットされません）
```

`.env` に設定する項目は `.env.example` を参照。認証は2種類：

- **パスワード認証**（`KINTONE_USER` + `KINTONE_PASSWORD`）… アプリ**作成**に必須。
  専用の連携用アカウントを推奨（社長個人アカウントは避ける）。
- **APIトークン認証**（`KINTONE_API_TOKEN`）… レコードの読み書き。アプリごとに発行、read/write 権限を付与。

## 進め方（推奨順）

```bash
npm run apps                 # ① 既存アプリのIDを確認 → .env の KINTONE_OLD_APP_ID に設定
npm run create-app           # ② 新アプリを作成 → 表示された ID を KINTONE_NEW_APP_ID に設定
DRY_RUN=1 npm run migrate     # ③ まず抽出結果だけ確認（out/preview.json）
npm run migrate              # ④ 問題なければ本投入
npm run analyze              # ⑤ 集計・分析
```

## SNS/LP 週次報告ツール

売上日報と同じ思想で、SNS・LPチームの**週次業務報告（文章）**を構造化データに変換し、
kintone に蓄積・分析できるようにするツールです。投稿数・アカウント別内訳・商品/カテゴリ別の
実施内容と来週予定などを抽出します（幹部会議の議事録などチーム週次報告でない文章は自動的に除外）。

```bash
npm run create-weekly-app          # ① 週次アプリを作成 → 表示された ID を KINTONE_WEEKLY_APP_ID に設定
DRY_RUN=1 npm run migrate-weekly    # ② まず抽出結果だけ確認（out/weekly-preview.json）
npm run migrate-weekly             # ③ 問題なければ本投入
npm run analyze-weekly             # ④ 週次サマリー・アカウント別投稿数を集計
```

入力元は2通りです。

- **kintone の既存アプリ** … `.env` の `KINTONE_WEEKLY_OLD_APP_ID` を設定すると、その全レコードの
  文字列フィールドを走査してパースします。
- **ローカルのサンプル** … 未設定の場合は `samples/weekly/` 配下の `.txt` / `.md` を読み込みます。
  1ファイル内に複数の報告があるときは罫線（`———` など）で区切ってください。
  年は報告文（`2026年`）→ ファイル名の先頭4桁（`2026-07-21_sns.txt`）→ `WEEKLY_YEAR` の順で決まります。

## 安全について

- 認証情報は**すべて環境変数**から読み込み、コードには一切書きません。
- `.env` と秘密情報は `.gitignore` で除外済み。リポジトリには入りません。
- セットアップ後は API トークンやパスワードを**いつでも失効・変更**できます。
