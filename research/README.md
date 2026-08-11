# research/ — ULTRA RESEARCH TEAM ワークスペース

`/research <テーマ>` で起動する各 Subagent が、中間成果物をここに保存します。
同じ調査を全員が繰り返さないための共有作業ディレクトリです。
プロトコル全体は [`../RESEARCH-TEAM-PROTOCOL.md`](../RESEARCH-TEAM-PROTOCOL.md) を参照。

| ディレクトリ | 保存する内容 | 主担当 Subagent |
|--------------|--------------|-----------------|
| `sources/` | 一次情報・URL・引用・ファクトチェック（公開日/確認日つき） | `web-researcher` / `fact-checker` |
| `competitors/` | 競合分析・比較表・弱点抽出 | `competitor-analyst` |
| `customer/` | 顧客インサイト（レビュー・SNS・★1〜3分析） | `customer-analyst` |
| `data/` | 数値・計算・ユニットエコノミクス | `data-analyst` / `cfo` |
| `strategy/` | 調査計画・施策・反証・最終戦略 | `research-director` / `strategy-director` ほか |

> 各テーマごとにサブフォルダ（例: `research/data/2026-08-<topic>/`）を切ると整理しやすいです。
> 実データや機密を含むメモは、コミット前に共有可否を確認してください。
