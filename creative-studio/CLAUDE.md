# CLAUDE.md — WORLD-CLASS AD CREATIVE STUDIO（運用マニュアル）

> このディレクトリは、Meta広告・Instagramストーリー運用で **CPAを下げ・ブランドイメージを上げる** ための
> 広告クリエイティブ制作システムです。目的は「Agentを大量に作ること」ではなく、
> **画像編集の成功率・商品再現精度・指示遵守率を最大化すること**。

---

## 0. この環境で「本当にできること」（Ground Truth / 偽装禁止）

`qa/scripts/capabilities.py` を実行すれば、その時点で実際に使える手段を検証出力します。
2026-08 時点で検証済みの事実：

| 手段 | 状態 | 用途 |
|---|---|---|
| Python 3.11 + Pillow + numpy | ✅ | 決定論的な合成・差分検出・LOCK検証・QA自動化 |
| Chromium + Playwright | ✅ | 日本語文字レイヤーの正確なレンダリング（HTML→PNG） |
| Node.js 22 | ✅ | 補助 |
| 外部HTTPS（プロキシ経由） | ✅ | 生成API3社へ到達確認済み。**キー提供時のみ** `generate.py` で生成可 |
| AI画像"生成"モデル / 画像生成MCP | ⚠ キー待ち | `qa/scripts/generate.py`（Gemini/nano-banana対応・参照画像入力可）実装済み。`GEMINI_API_KEY` 設定で接続完了 |

**原則**: AI生成は未接続。よって商品再現が要る工程は、可能な限り
**「参照画像を保持して決定論的に合成」**（`composite.py`）で行い、AI再生成を避ける。
これは RULE 2（商品を想像で生成しない）を技術的に保証する設計。

---

## 1. 制作チーム（agents/）

10名の専門家を `agents/` に定義。各Agentは独立した判断基準を持ち、
制作担当とQAは**必ず分離**する。オーケストレーターが招集順を制御する。

| # | Agent | 主担当 |
|---|---|---|
| 00 | Orchestrator | 全工程の司会・招集・LOCK管理・ループ制御 |
| 01 | Creative Director | 方針決定・一発で伝わるか・視線誘導・高級感 |
| 02 | Senior Graphic Designer | レイアウト・余白・グリッド・ジャンプ率・配色 |
| 03 | Product Accuracy Specialist | 商品再現精度（最重要）・Ground Truth照合 |
| 04 | Retouch / Compositing Specialist | 切り抜き・合成・影・光源・馴染み |
| 05 | Typography Director | 日英タイポ・字間行間・可読性 |
| 06 | Performance Marketing Designer | スクロールストップ・3秒理解・CTA・CTR/CVR |
| 07 | Brand Director | 一貫性・過剰装飾/AI臭の排除 |
| 08 | Japanese Copywriter | 短く直感的で自然な日本語コピー |
| 09 | QA / Error Detection | 誤字・日付曜日・価格・商品形状・指示漏れ |
| 10 | Devil's Advocate | 最後に必ず欠点を10項目探す |

---

## 2. 絶対遵守ルール（要約 / 全文は各Agent定義に展開）

1. **指定箇所以外は変更禁止**（RULE 1）→ LOCK機構で技術的に強制する。
2. **参照商品画像がGround Truth**（RULE 2）→ 商品はAI生成せず合成保持。
3. **修正前に KEEP / CHANGE / VERIFY を必ず作る**（RULE 3）→ `templates/keep-change-verify.md`。
4. **未指定のコピー・機能・価格・効果を推測で追加しない**（RULE 4）。
5. **日付と曜日は必ず整合性確認**（RULE 5）→ `qa/scripts/qa_report.py` が機械照合。
6. **日本語文字は生成モデル任せにせず最終工程で正確に配置**（RULE 6）→ `layout_render.py`。

---

## 3. LOCK機構（TEXT / PRODUCT / LAYOUT / SURGICAL EDIT）

`locks/lock-spec.md` に仕様。1つの制作物ごとに `locks/<name>.locks.json` を持つ。

- **TEXT LOCK**: テキスト領域はマスター以外変更不可。
- **PRODUCT LOCK**: 商品領域は参照画像にGround-Truthロック。差し替えは `composite.py` のみ。AI再生成禁止。
- **LAYOUT LOCK**: 構図・要素位置を固定。変更を許すのは `edit_region` だけ。
- **SURGICAL EDIT MODE**: 「一箇所修正→全体が微妙に変わる」を**重大失敗**として自動検出（`lock_verify.py`）。

判定は主観ではなく **ピクセル差分**で機械的に行う（`edit_region` の外に1pxでも変化が漏れたら FAIL）。

---

## 4. ワークフロー（workflows/）

- `full-production.md` … STEP 1–12 のフル制作＋修正ループ（95点まで繰り返す）
- `surgical-edit.md` … 既存画像の部分修正モード
- `product-replace.md` … 「商品1点だけ参照画像へ置換し他を完全保持」の手順（テストケース）

---

## 5. QA と評価（qa/）

チェックリスト（人＋Agentが使う）:
- `qa/product-accuracy-checklist.md`
- `qa/typography-qa-checklist.md`
- `qa/before-after-difference-check.md`
- `qa/final-100-point-score.md`（**95点未満は提出禁止**）

自動化スクリプト（実際に動く）:
- `qa/scripts/capabilities.py` … 利用可能手段の検証
- `qa/scripts/lock_verify.py` … LOCK領域の不変を検証（SURGICAL EDITの合否）
- `qa/scripts/diff_check.py` … Before/After差分マップ＋変化率
- `qa/scripts/composite.py` … 参照商品の決定論的な差し替え合成
- `qa/scripts/layout_render.py` … 日本語文字レイヤーをHTML→PNG
- `qa/scripts/qa_report.py` … 上記を統合しQAレポート＋100点採点の雛形を出力

セットアップ: `pip install -r qa/scripts/requirements.txt`

---

## 6. データ置き場

- `references/` … 参照商品画像（Ground Truth）と `_manifest.json`。`references/README.md` 参照。
- `master/` … 承認済み・LOCK済みの完成マスター。ここを基準に差分を測る。
- `output/` … 生成した納品物とQAレポート。
- `failure-memory/` … 失敗の記録（append-only）。同じ失敗を繰り返さないため制作前に必ず参照。

---

## 7. 失敗メモリ（failure-memory/）

「違う」「本物と違う」と言われたら、言い訳せず `failure-memory/log.jsonl` に
差分原因・再発防止策を1行JSONで追記する。制作開始時（STEP 1）に必ず読み込み、
過去と同じ失敗パターンを事前に潰す。

---

## 8. 絶対原則（判断が割れたらこれで決める）

```
ユーザーの指示精度 > AIの創造性
商品再現精度       > それっぽさ
伝達力             > 装飾
成果(CVR/CPA)      > 自己満足
```

最終判断基準は常に：
**「この画像を世界トップの広告代理店がクライアントに納品できるか？」**
NO なら修正を続ける。
