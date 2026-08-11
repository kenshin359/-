# CLAUDE.md — Libetee kintone ツール群

このリポジトリには2つのツールがあります（詳細は [`README.md`](./README.md)）。
- 直下 / `src/` … 売上日報ツール（kintone アプリ自動構築・移行・分析）
- `daily-report-system/` … AI日報システム（Kintone→Claude→LINE を n8n で自動化）

## リサーチ依頼を受けたとき

経営・マーケティング・EC・商品開発・競合・市場・データに関する **調査/意思決定の依頼**
を受けた場合は、**ULTRA RESEARCH TEAM プロトコル**を適用してください。

- プロトコル本文: [`RESEARCH-TEAM-PROTOCOL.md`](./RESEARCH-TEAM-PROTOCOL.md)
- 起動: スラッシュコマンド **`/research <テーマ>`**（`.claude/commands/research.md`）
- 14ロールの Subagent: `.claude/agents/`（research-director ほか）
- 中間成果物の保存先: `research/`（sources / competitors / customer / data / strategy）

要点: 推測と事実を混ぜない／一次情報を優先／1ソースで断定しない／反証（red-team）と
事実確認（fact-checker）は他分析の後／結論には確信度を付ける／
「だから何をすべきか（ACTION PLAN・PRIORITY S〜D）」まで出す。
