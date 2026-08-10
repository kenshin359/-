# references/ — 参照商品画像（Ground Truth）管理

商品の「正解」を置く場所。ここにある画像が **最優先の真実**（RULE 2）。

## 使い方
1. 商品画像を `references/products/` に置く（透過PNG推奨。JPEGでも可）。
2. `_manifest.json` にエントリを追加し、Ground Truth（色・素材・ロゴ位置・KEEP特徴）を言葉でも記録。
3. 制作/QAでは manifest の `id` で参照する。

## 追加画像の分類（受領時に必ず判定）
- A: 商品そのものの正解画像 → **最優先で保持・合成**
- B: デザイン参考 / C: レイアウト参考 / D: 色・世界観参考 / E: 人物参考 / F: ロゴ・ブランド資料

A の場合、商品はAI生成せず `qa/scripts/composite.py` で合成する。
