# LOCK 仕様（TEXT / PRODUCT / LAYOUT / SURGICAL EDIT）

各creativeに `locks/<name>.locks.json` を1つ持つ。座標は master 画像の**ピクセル**基準・左上原点。

## JSONスキーマ
```json
{
  "name": "sale_story_v1",
  "canvas": { "w": 1080, "h": 1920 },
  "edit_region": { "x": 240, "y": 700, "w": 600, "h": 600 },
  "locks": {
    "text":    [ { "name": "headline", "box": [80, 120, 920, 160] } ],
    "product": [ { "name": "main_product", "box": [240,700,600,600], "reference": "prod-001" } ],
    "layout":  [ { "name": "logo", "box": [60, 1760, 300, 100] } ]
  },
  "tolerance": { "per_pixel": 2, "max_changed_ratio_outside_edit": 0.0005 }
}
```

## 意味
- **edit_region**: 変更を許可する唯一の矩形。これ以外の変化は原則すべて違反。
- **TEXT LOCK** (`locks.text`): テキスト領域はマスターから不変。
- **PRODUCT LOCK** (`locks.product`): 商品領域は `reference` の参照画像にGround-Truthロック。
  差し替えは `composite.py` のみ。AI再生成は禁止。
- **LAYOUT LOCK** (`locks.layout`): 要素位置を固定。
- **tolerance.per_pixel**: JPEG等の微小ノイズを吸収する画素差の許容（0–255の各チャンネル差）。
- **tolerance.max_changed_ratio_outside_edit**: edit_region外で許す変化画素の割合上限。0推奨。

## SURGICAL EDIT MODE 合否
`lock_verify.py` が、edit_region の**外側**で tolerance を超える変化画素が
`max_changed_ratio_outside_edit` を超えたら **FAIL**（＝「一箇所直したら全体が変わった」を検出）。
