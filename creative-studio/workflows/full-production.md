# Workflow: フル制作（STEP 1–12 ＋ 修正ループ）

前提: `pip install -r qa/scripts/requirements.txt`

1. **指示解析** — ユーザー指示を解析。`failure-memory/log.jsonl` を読む。
2. **変更/不変の分離** — `templates/keep-change-verify.md` で KEEP/CHANGE/VERIFY 作成。
3. **参照確認** — `references/_manifest.json` を確認。
4. **Ground Truth特定** — 商品・ロゴ・文字の正解を確定。
5. **方針決定** — Agent01 Creative Director が編集方針を1枚のブリーフに確定。
6. **並行検証** — 02 Designer / 03 Product / 04 Retouch / 05 Typo / 08 Copy が各観点で検証。
7. **編集実行** — 制作。日本語文字は最終工程で `layout_render.py`（RULE 6）。
8. **Before/After比較** — `diff_check.py` と `lock_verify.py` で機械比較。
9. **QA** — Agent09 が `qa_report.py` ＋ 各チェックリスト。
10. **Devil's Advocate** — Agent10 が最低10観点で欠点探索。
11. **自動修正** — 問題があれば修正。原因を `failure-memory/log.jsonl` に追記。
12. **再QA** — 合格まで 8→12 をループ。

## 提出条件（すべて必須）
- lock_verify.py = PASS
- qa_report.py の機械チェック（日付曜日/差分） = PASS
- 各チェックリスト 全項目クリア
- Final 100点 ≥ 95
- Devil's Advocate 指摘ゼロ宣言
