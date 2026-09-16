# データ仕様（CSV・DB）

## 統一CSVテンプレート（`csv-templates/` に同梱・UTF-8/Shift_JIS対応）
数値は半角・カンマなし。日付は `YYYY-MM-DD`。金額は税抜円（税込しか無い場合は tax_mode=inclusive で申告）。

| ファイル | 必須列 | 自然キー（重複判定） |
|---|---|---|
| products.csv | series_code,series_name | series_code |
| skus.csv | sku_code,series_code,size,color,name | sku_code |
| orders.csv | channel_code,store_code,order_id,order_date,ship_date,status,shipping_revenue,discount,tax_mode | channel+store+order_id |
| order_items.csv | channel_code,store_code,order_id,line_no,sku_code,qty,unit_price | channel+store+order_id+line_no |
| refunds.csv | channel_code,store_code,order_id,refund_date,amount,reason,restock_flag | channel+store+order_id+refund_date+amount |
| ad_daily.csv | date,media_code,account,campaign,spend,impressions,clicks,media_cv,attributed_revenue,attribution_window | date+media+account+campaign |
| access_daily.csv | date,channel_code,sessions,users,pv | date+channel |
| costs.csv | date,scope(channel/sku/all),scope_code,cost_type,amount,is_estimate | date+scope+scope_code+cost_type |
| inventory_moves.csv | date,sku_code,warehouse_code,move_type(in/out/return/adjust),qty,reason,operator | date+sku+warehouse+type+qty+reason |
| purchase_orders.csv | po_no,supplier_code,sku_code,qty,unit_cost,currency,fx_rate,eta_date,status | po_no+sku_code |
| targets.csv | month,scope(all/channel/media),scope_code,metric(sales/profit/ad_budget),amount | month+scope+scope_code+metric |

媒体の生CSV（楽天RPP/Amazon広告/Meta等）→統一CSVへの変換仕様は、**実サンプル受領後に**アダプタとして追加する（列名を推測で断定しない）。

## 取込フロー
アップロード→文字コード判定(UTF-8/CP932、失敗時は手動選択)→列マッピング→プレビュー(先頭50行)→検証(必須列/型/日付/重複/SKU存在)→差分表示(新規n件・更新n件・スキップn件)→確定(トランザクション)→結果表示。
- 致命エラー(必須列欠落・キー重複破壊)は確定不可。警告のみは内容確認の上取込可。
- 原本ファイル・取込履歴(処理件数/エラー件数/実行者/処理バージョン/元行番号)を保存。
- 同一ファイル再取込は自然キーでUPSERTし件数・売上・在庫を増やさない。修正版は更新として前後値を監査記録。

## DB（Prisma・SQLite→本番Postgres移行可能な形）
粒度と関係:
- Order(1)−OrderItem(n)。売上金額は**明細から集計**し、ヘッダー金額とのJOIN二重計上をしない（ヘッダーは送料・値引きのみ保持）。
- OrderItem.cost_at_sale に取引時点原価を保存（原価マスター更新で過去を書き換えない）。
- InventoryMove（履歴）と InventorySnapshot（任意の実査）を別テーブルで区別。
- PurchaseOrder.received_at 確定時に InventoryMove(in) を1回だけ生成（二重確定防止に po_line毎の received フラグ）。
- demo_flag=true のデータは実データ集計・レポートから常に除外。

主要テーブル: users, sessions, channels, media, warehouses, suppliers, product_series, skus, sku_costs(有効期間付き), orders, order_items, refunds, ad_daily, access_daily, costs, inventory_moves, purchase_orders, po_lines, targets, tasks, proposals, import_batches, import_rows, audit_logs, settings。
