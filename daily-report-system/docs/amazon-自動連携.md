# Amazonの売上をキントーンへ（自動）

**毎朝8:15に、前日のAmazon売上が自動でキントーンに入ります。**
CSVのダウンロードは不要です。Chatworkに商品別のリストも届きます。

---

## しくみ

| 項目 | 内容 |
|---|---|
| 取得元 | Amazon SP-API（注文レポート・個人情報なし） |
| 書き込み先 | キントーン「売上明細（自動取込）」（Shopify・楽天と同じアプリ） |
| 実行時刻 | 毎朝 8:15（Shopifyの8:00のあと） |
| 商品の紐づけ | `config/sku-map.json`（CSV取込と共通） |
| 二重登録 | されません。その日の「Amazon」ぶんだけ入れ替え |

手で動かすとき:

```bash
npm run amazon:import                      # 昨日ぶん
npm run amazon:import -- --date=2026-07-31
npm run amazon:import -- --from=2026-07-01 --to=2026-07-31
npm run amazon:import -- --dry-run         # 書き込まず内容だけ
```

GitHub Actions の「**Amazon売上取込（毎朝8:15）**」からも実行できます。

---

## 必要な設定（GitHub Secrets）

| 名前 | 中身 |
|---|---|
| `SPAPI_CLIENT_ID` | Solution Provider Portal のアプリのクライアントID |
| `SPAPI_CLIENT_SECRET` | 同シークレット |
| `SPAPI_REFRESH_TOKEN` | 「アプリを承認」で発行したリフレッシュトークン |

発行元: https://solutionproviderportal.amazon.com/sellingpartner/developerconsole
（アプリ「キントーン売上連携本番」／ロールは読み取り3つ・個人情報なし）

> シークレットのローテーション期限が来たら（作成から約1年半）、
> 同じ画面で新しいシークレットを発行して `SPAPI_CLIENT_SECRET` を差し替えます。

---

## 数字の決まりごと

- レポートの `item-price` は**その行の合計（税込・送料含まず）**。楽天・Shopifyと揃っています
- **キャンセル注文は数えません**
- 注文直後で支払い処理中（Pending）の注文は、金額が空のことがあります。
  気になる日は、数日後にその日付を指定して再実行すれば正しい値に置き換わります
