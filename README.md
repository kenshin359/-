# Libetee kintone ツール群

このリポジトリには、株式会社リベティ（Libetee）向けのツールが入っています。

| ディレクトリ | 内容 |
|--------------|------|
| （リポジトリ直下 / `src/`） | **売上日報ツール**（下記）：「売上・転換率報告」アプリの自動構築・データ移行・分析 |
| [`daily-report-system/`](./daily-report-system/) | **AI日報システム**：Kintone→Claude→LINE を n8n で自動化。社長・部長向け経営日報を毎日自動生成・通知。緊急案件は即時通知。 |
| [`logistics-schedule/`](./logistics-schedule/) | **物流スケジュール**：輸入コンテナを 1レコード＝1コンテナで管理する kintone アプリを自動構築し、パッキングリスト（Excel）を取り込み。出荷日・コンテナ番号・BL・アライバル・通関予定日・ドレー手配状況・入庫日・発送可能日を一覧化。 |

> **AI日報システムをこれから導入する方へ**
> パソコンが得意でなくても大丈夫です。まずは
> **[`daily-report-system/docs/START-HERE.md`](./daily-report-system/docs/START-HERE.md)** を開いてください。
> `npm run setup` の質問に答えるだけで設定が完了します。

---

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

## 安全について

- 認証情報は**すべて環境変数**から読み込み、コードには一切書きません。
- `.env` と秘密情報は `.gitignore` で除外済み。リポジトリには入りません。
- セットアップ後は API トークンやパスワードを**いつでも失効・変更**できます。
