# Workflow: 商品1点だけ置換（他を完全保持）＝ テストケース手順

## 入力
- `master/<creative>.png` … 完成済み広告（Before）
- `references/products/<prod>.png` … 置換先の参照商品（Ground Truth。背景透過PNG推奨）
- `locks/<creative>.locks.json` … `edit_region`＝置換する商品の矩形

## 動くAgentと順序
1. **00 Orchestrator** … KEEP/CHANGE/VERIFY 作成、LOCK確認、failure-memory参照
2. **03 Product Accuracy** … 参照画像をGround Truthとして確定、置換範囲を特定
3. **04 Retouch/Compositing** … `composite.py` で edit_region に決定論的合成（影・スケール調整）
4. **09 QA** … `lock_verify.py`＋`diff_check.py`＋product-accuracy-checklist
5. **10 Devil's Advocate** … 10観点で最終検証
6. Orchestrator が Final 100点で判定

## LOCKする場所
- edit_region（＝商品矩形）以外の**全ピクセル**（TEXT/LAYOUT/背景/人物すべて）。
- edit_region 内はGround Truth（参照画像）にPRODUCT LOCK。

## 差分検出
`lock_verify.py`：edit_region 外の変化画素が tolerance を超えたら FAIL。
`diff_check.py`：変化領域のヒートマップと bbox を出力し、bbox が edit_region に収まるか確認。

## PASS条件
1. edit_region 外の変化 = 実質ゼロ（tolerance内）
2. edit_region 内が参照商品と一致（product-accuracy-checklist 全項目）
3. 接地感・影・光源が自然（Agent04承認）
4. Final 100点 ≥ 95
