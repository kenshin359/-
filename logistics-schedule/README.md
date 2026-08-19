# 物流スケジュール kintone ツール

輸入コンテナの物流フローを **1レコード＝1コンテナ** で管理する kintone アプリを
**自動構築**し、**パッキングリスト（Excel）を取り込む**ためのツール一式です。

パッキングリスト（＝出荷）→ BL 発行 → アライバル（入港）→ 通関 → ドレー手配
→ 入庫 → 発送可能、までを 1 つの一覧で追えます。

## 一覧化できる項目

作成される「物流スケジュール」アプリの一覧ビュー（並び順）:

| 列 | フィールド | 取得元 |
|---|---|---|
| 出荷日 | `shipping_date` | パッキングリストの「日期」 |
| コンテナ番号 | `container_no` | パッキングリストの「货柜号」 |
| PO番号 | `po_number` | パッキングリストの「PO号」 |
| H B/L番号 | `hbl_no` | BL / アライバルノーティス |
| アライバル（入港予定日） | `arrival_date` | アライバルノーティス（ETA） |
| 通関予定日 | `customs_date` | ＊kintone で入力・更新 |
| ドレー手配状況 | `dray_status` | ＊kintone で入力・更新（未手配／手配中／手配完了／搬入済） |
| 入庫日 | `warehousing_date` | ＊kintone で入力・更新 |
| 発送可能日 | `shippable_date` | ＊kintone で入力・更新 |
| ステータス | `status` | 進捗（出荷済→…→発送可能） |

このほか、シール番号・コンテナタイプ・総数量・総重量・総体積・M B/L番号・
本船／航海番号・船積港／荷揚港・B/Lサレンダー・ドレー搬入日・貨物管理番号・
備考、および**品目明細テーブル**（品名・色・規格・外箱サイズ・毛重・純重・数量・体積）
をレコード詳細で保持します。

> **＊印の項目**（通関予定日・ドレー手配状況・入庫日・発送可能日）は、
> 書類には無い“進行中に決まっていく”情報です。取り込み後に kintone 上で
> 更新していく運用を想定しています。

## できること

| コマンド | 内容 |
|---|---|
| `npm run apps` | アプリ一覧とIDを表示（作成後のID確認用） |
| `npm run create-app` | 「物流スケジュール」アプリを自動作成（フィールド＋一覧ビュー＋デプロイ） |
| `npm run import` | `packing-lists/` の Excel を解析してレコード投入（コンテナ番号で upsert） |
| `npm run import-planned` | 発注（出荷計画）を「計画」ステータスの予定レコードとして登録（`data/planned-*.json`） |
| `npm run create-inventory-app` | 「在庫」アプリを自動作成（SKU管理・在庫合計は自動計算） |
| `npm run import-inventory` | 在庫CSV（`data/inventory.csv`）を在庫アプリへ投入（商品IDで upsert） |
| `npm run stock-news` | 在庫＋入荷予定から「在庫・入荷ニュース」HTMLを自動生成（デイリーニュースへ投稿も可） |

## セットアップ

```bash
cd logistics-schedule
npm install                 # xlsx ライブラリを取得
cp .env.example .env        # 値を記入（.env はコミットされません）
```

`.env` の認証は2種類：

- **パスワード認証**（`KINTONE_USER` + `KINTONE_PASSWORD`）… アプリ**作成**に必須。
- **APIトークン認証**（`KINTONE_API_TOKEN`）… レコードの読み書き（import）。
  物流スケジュールアプリで発行し read/write 権限を付与。

## 進め方（推奨順）

```bash
npm run create-app          # ① アプリを作成 → 表示された ID を .env の KINTONE_LOGI_APP_ID へ
DRY_RUN=1 npm run import      # ② まず解析結果だけ確認（out/preview.json、kintone接続不要）
npm run import              # ③ 問題なければ本投入
```

## パッキングリストの取り込み方

1. パッキングリストの Excel（`.xlsx` / `.xls`）を **`packing-lists/`** に置く。
2. `npm run import` を実行。ファイルごとにコンテナ番号を検出し、
   - 既に同じコンテナ番号のレコードがあれば **更新**、
   - 無ければ **新規作成** します（何度実行しても重複しません）。

対応レイアウトは今回いただいた各社の様式（`货柜号 / 封条号 / 品名 …` のヘッダーを持つ表）で、
ヘッダー行を自動検出して列を拾うため、多少の位置ズレがあっても取り込めます。

### BL・アライバル情報の補完（`data/bl-info.json`）

パッキングリストには BL 番号や入港予定日が載っていません。
`data/bl-info.json` に**コンテナ番号をキー**として追記しておくと、
取り込み時にレコードへ自動反映されます（アライバルノーティス／BL から転記）。

```jsonc
{
  "TWIU4232923": {
    "hbl_no": "GZTLF2607053",
    "mbl_no": "721611071691",
    "bl_surrendered": "済",
    "vessel": "TS HAKATA 2613N",
    "pol": "SHEKOU, CHINA",
    "pod": "OSAKA, JAPAN",
    "container_type": "40HQ",
    "arrival_date": "2026-08-05",
    "total_cartons": 1060
  }
}
```

## 発注（出荷計画）の先行登録

まだ出荷していない発注を、**「計画」ステータス**の予定レコードとして先に登録できます。
出荷が近づいたら実コンテナ番号・パッキングリスト・BL 情報で更新していきます。

- データは `data/planned-*.json`（同梱の `data/planned-lm20260808.json` は
  発注 **LM20260808**〔経典PC多機能スーツケース〕**全13本・合計10,750個**を収録）。
- `container_no` は仮キー `LM20260808-01`〜`13`。実コンテナ番号が決まったら
  Kintone 上で書き換える（または JSON を更新して再取込）。仮キーで upsert するため
  何度実行しても重複しません。

```bash
DRY_RUN=1 npm run import-planned   # 投入せず out/planned-preview.json で確認
npm run import-planned             # 「計画」レコードとして13本を登録

# 別の発注ファイルを指定（例：ABCテレビ緊急発注のハンディファン エアー/船便）
PLANNED_FILE=data/planned-handyfan-abc.json npm run import-planned
```

同梱の計画ファイル：
- `data/planned-lm20260808.json` … 経典PC 全13本・合計10,750個
- `data/planned-handyfan-abc.json` … ABCテレビ緊急発注 ハンディファン（エアー1,000個・8/14関空／船便2,000個・8/18）

> ステータスに「計画」を使うため、既にアプリを作成済みの場合は
> `status` ドロップダウンに **計画** の選択肢を追加してください
> （まだ未作成なら `npm run create-app` で自動的に含まれます）。

## 在庫アプリ ＆ 在庫ニュース自動生成

日報システムと同じ流れ（データ → 整形 → ニュース）で、**倉庫在庫＋入荷予定**から
「在庫・入荷ニュース」を自動生成し、デイリーニュースに載せられます。

```bash
npm run create-inventory-app    # ① 在庫アプリを作成 → 表示IDを .env の KINTONE_INV_APP_ID へ
npm run import-inventory        # ② data/inventory.csv を投入（商品IDで upsert）
npm run stock-news             # ③ out/在庫状況_ニュース.html を生成（貼付用）
```

- **在庫データ**：`data/inventory.csv`（商品ID・ライン・サイズ・色・Amazon分・良品・引当・日販・発注点・在庫ステータス）。同梱は 2026/8/2 スナップショット（多機能PC 19SKU）。最新在庫が届いたら差し替え。
- **入荷予定**：`data/incoming.json`（物流スケジュール由来。倉庫入れ予定日・状態）。
- `stock-news` は在庫サマリー・欠品僅少・今週入荷・入荷予定表を計算して**HTMLカード**を作成。
- **自動投稿**：`.env` に `KINTONE_NEWS_APP_ID` と本文/タイトルのフィールドコードを設定し
  `POST=1 npm run stock-news` で「リベティ・デイリーニュース」アプリへレコード投稿。
- **定期実行**：n8n / cron / kintone連携で毎朝 `stock-news` を回せば、売上ニュースの隣に
  在庫ニュースが自動で並びます。

## 同梱のサンプル

- `packing-lists/` … いただいた 4 件のパッキングリスト（そのまま取り込めます）
  - `2026-07-23_TWIU4232923.xlsx`
  - `2026-07-24_IAAU1022523.xlsx`
  - `2026-07-31_IAAU2971329.xlsx`
  - `2026-08-07_WHSU5628824.xls`
- `data/bl-info.json` … `TWIU4232923` の BL / アライバル情報（GZTLF2607053）を登録済み
- `docs/reference/` … 参照元の PDF（アライバルノーティス／サレンダー B/L）

## 安全について

- 認証情報は**すべて環境変数**から読み込み、コードには一切書きません。
- `.env` は `.gitignore` で除外済み。リポジトリには入りません。
