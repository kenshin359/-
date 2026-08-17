# O2GYM 広告売上KPI 自動連携

STORES / Shopify / Google広告 / Meta広告 の数字を **毎朝6:00（日本時間）に自動で集めて**、
kintone の **KPI管理アプリ**へ「1日1レコード」で投入します。毎日のコピペ作業をゼロにします。

> **鍵（トークン）はあなたが GitHub の金庫（Secrets）に入れるだけ。**
> コードには一切書かれておらず、第三者にも共有されません。

---

## 仕組み（ざっくり）

```
毎朝6:00  →  GitHub Actions が起動
          →  前日分を各媒体から取得
             ・Shopify     : 売上（Admin API）
             ・STORES      : 売上（CSVを data/stores/ に置く方式）
             ・Meta広告    : 広告費（Marketing API）
             ・Google広告  : 広告費（Google Ads API）
          →  kintone KPI管理アプリへ upsert（同じ日付は上書き）
```

- **各媒体はトークンが無ければ自動スキップ。** まず kintone + Shopify だけでも動きます。
- **1媒体が失敗しても他は続行。** 原因はログに出ます。
- **アクセス数・成約数（入会）は触りません。** 店舗運用に依存するため、手入力（またはキントーンの他アプリ）を尊重します。自動で入るのは「売上×2・広告費×2」です。

---

## 準備は3ステップ

### STEP1. kintone KPIアプリのIDとAPIトークンを用意
1. KPI管理アプリを開く → URL の `/k/<番号>/` の **番号がアプリID**。
2. アプリ設定 → **APIトークン** → 生成 → **「レコード閲覧・追加・編集」にチェック** → 保存 → **アプリを更新**。
3. アプリのフィールドコードを、この自動化の既定に合わせると設定が楽です（アプリ設定→フォーム→各フィールドの歯車→フィールドコード）:

   | フィールド | フィールドコード |
   |---|---|
   | 日付 | `date` |
   | アクセス数 | `access` |
   | 成約数(入会) | `signups` |
   | 売上_STORES | `sales_stores` |
   | 売上_Shopify | `sales_shopify` |
   | Google広告費 | `ad_google` |
   | Meta広告費 | `ad_meta` |

   ※違うコードのままでもOK。その場合は Secrets に `KPI_FC_*` で実際のコードを登録してください。

### STEP2. GitHub の Secrets に鍵を登録
リポジトリ → **Settings → Secrets and variables → Actions → New repository secret**。

**必須（これだけで Shopify 無しでも起動確認できます）**

| Secret 名 | 値 |
|---|---|
| `KINTONE_SUBDOMAIN` | `w6pq7i12hn4b` |
| `KINTONE_KPI_APP_ID` | KPIアプリのID |
| `KINTONE_KPI_API_TOKEN` | 上で発行したトークン |

**任意（設定した媒体だけ自動取得）**

<details><summary>Shopify</summary>

| Secret 名 | 値・取り方 |
|---|---|
| `SHOPIFY_SHOP` | `o2gym.myshopify.com` |
| `SHOPIFY_ADMIN_TOKEN` | Shopify管理 → 設定 → アプリと販売チャネル → アプリを開発 → カスタムアプリ作成 → Admin API で `read_orders` を許可 → アクセストークン |
</details>

<details><summary>Meta広告</summary>

| Secret 名 | 値・取り方 |
|---|---|
| `META_AD_ACCOUNT_ID` | `act_6500211260004110` |
| `META_ACCESS_TOKEN` | Meta for Developers でアプリ作成 → Marketing API → `ads_read` の長期トークン |
</details>

<details><summary>Google広告</summary>

| Secret 名 | 値・取り方 |
|---|---|
| `GOOGLE_ADS_CUSTOMER_ID` | アカウントID（ハイフン無し数字） |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google広告 API センターで申請 |
| `GOOGLE_ADS_CLIENT_ID` / `GOOGLE_ADS_CLIENT_SECRET` | Google Cloud の OAuth クライアント |
| `GOOGLE_ADS_REFRESH_TOKEN` | OAuth 同意で取得 |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | MCC経由の場合のみ |
</details>

<details><summary>STORES（CSV方式）</summary>

STORES は公式APIが限られるため、売上CSVを `kpi-ads/data/stores/` に置くと自動集計します。
列名が特殊なら Secrets に `STORES_DATE_COLUMN` / `STORES_AMOUNT_COLUMN` を登録。
</details>

### STEP3. 動作テスト
- Actions タブ → **「KPI自動連携（毎朝6:00）」→ Run workflow**（日付を空で実行 or `2026-08-01` を指定）。
- ログに `kintone: レコードを新規作成/更新しました` が出れば成功。翌朝から自動で回ります。

---

## ローカルで試す（任意・開発者向け）

```bash
cd kpi-ads
cp .env.example .env      # 値を記入（.env はコミットされません）
node src/main.js --help   # 使い方
DRY_RUN=1 node src/main.js 2026-08-01   # 書き込まず結果だけ確認
node src/main.js 2026-08-01             # 本投入
```

## 安全について
- 認証情報は**すべて環境変数 / GitHub Secrets** から読み込み、コードには書きません。
- `.env` は `.gitignore` で除外。リポジトリには入りません。
- トークンは**いつでも失効・再発行**できます。まず読み取り専用の最小権限で。

## 自動で入る / 手入力が必要
| 項目 | 自動 | 補足 |
|---|---|---|
| 売上_Shopify | ✅ | Admin API |
| 売上_STORES | ✅ | CSVを置く方式 |
| Google広告費 / Meta広告費 | ✅ | 各API |
| アクセス数 | △ | 媒体をまたぐため当面は手入力推奨 |
| 成約数（入会） | ✋ | 店頭入会は自動取得不可＝手入力 or 別アプリ連携 |
