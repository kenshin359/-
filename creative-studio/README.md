# AD CREATIVE STUDIO

Meta広告・Instagramストーリー運用で **CPAを下げ・ブランドイメージを上げる** ための
広告クリエイティブ制作システム。世界最高峰の制作会社の制作体制・品質基準・検証工程を
Claude Code 上で運用可能にしたもの。運用マニュアルは **[CLAUDE.md](./CLAUDE.md)**。

## セットアップ
```bash
pip install -r qa/scripts/requirements.txt   # Pillow, numpy, playwright
python3 qa/scripts/capabilities.py           # 使える手段を検証（正直な棚卸し）
```

## 動作証明（合成データで全工程を実行）
```bash
python3 qa/scripts/selftest.py               # 商品置換→LOCK検証→差分→QAレポート
```
`output/_selftest/` に、正しい置換(PASS)・領域外改変(FAIL検出)・差分ヒートマップ・
日本語文字レイヤー・QAレポートが出力される。

## 主要コマンド
| 目的 | コマンド |
|---|---|
| 商品を参照画像へ決定論的に差し替え | `qa/scripts/composite.py` |
| 部分修正が領域外へ漏れていないか検証 | `qa/scripts/lock_verify.py` |
| Before/After 差分とヒートマップ | `qa/scripts/diff_check.py` |
| 日本語文字レイヤーを正確に配置(RULE6) | `qa/scripts/layout_render.py` |
| 日付曜日/LOCK/差分の統合QA＋100点雛形 | `qa/scripts/qa_report.py` |

## 設計思想
- **商品再現精度 > それっぽさ** … 商品はAI再生成せず参照画像を保持合成（RULE 2）
- **指定箇所以外は変更禁止** … LOCK機構＋ピクセル差分で機械的に強制（RULE 1）
- **日付曜日・価格・誤字** … 推測でなく暦・指定値で機械照合（RULE 4/5）
- AI画像生成は未接続。外部APIキー提供時のみ利用可（存在を偽装しない）
