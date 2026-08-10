# Workflow: SURGICAL EDIT MODE（部分修正）

「既存画像の一部だけ」を直す時は新規生成しない。優先順位：

1. 元画像(master)を保持
2. 指定部分(edit_region)だけ編集
3. 周辺との自然な馴染み
4. その他ピクセルへの影響を最小化

## 手順
1. master を `master/` に確定（これがBefore基準）。
2. `locks/<name>.locks.json` を作成：`edit_region` と各LOCKを定義。
3. 編集は edit_region 内のみ。合成なら `composite.py` を使用。
4. `lock_verify.py master out locks.json` を実行。
   - edit_region 外に tolerance 超の変化が漏れたら **重大失敗** → やり直し。
5. PASS したら QA へ。

「一箇所修正した結果、全体が微妙に変わる」ことを重大な失敗として扱う。
