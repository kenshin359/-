---
description: ULTRA RESEARCH TEAM プロトコルで調査依頼を実行する（14ロールを並列オーケストレーション）
argument-hint: 調査したいテーマ・意思決定（例：「〇〇市場に新商品を出すべきか」）
---

以下の調査依頼を **ULTRA RESEARCH TEAM プロトコル**（`RESEARCH-TEAM-PROTOCOL.md`）で実行してください。

## 調査依頼

$ARGUMENTS

## 実行手順

まず `RESEARCH-TEAM-PROTOCOL.md` を読み、絶対ルール15項目と最終回答フォーマットを守ること。

1. **設計** — `research-director` を起動し、依頼を分解して調査計画・必要な数字・
   投入チーム・優先順位を決める（いきなり検索しない）。
2. **内部データ優先** — ユーザーが CSV/Excel/PDF/画像/売上・広告・レビュー・在庫
   データを提供している場合は、Web 検索より先にそれを分析する。
3. **並列調査** — Director の計画に従い、必要な専門チームを **並列に** 起動する：
   `web-researcher` / `competitor-analyst` / `customer-analyst` / `data-analyst` /
   `ec-specialist` / `marketing-specialist` / `product-specialist` /
   `first-principles-analyst` / `d2c-analyst` / `cfo`。
   最初から他チームの結論に合わせず、各自が独立して調べる。同じ調査を重複させない。
4. **反証・検証（分析完了後）** — 上記が出そろってから `red-team`（最低3つの失敗理由）
   と `fact-checker`（[A]〜[D]分類）を起動する。
5. **統合** — 最後に `strategy-director` を起動し、全成果物を統合して最終回答を作る。

## 出力ルール

- 中間成果物は `research/`（sources / competitors / customer / data / strategy）に保存。
- 推測と事実を混ぜない。【推定】には計算式と前提を付す。不明は「不明」と明記。
- 1つの情報源だけで重要判断をしない。重要判断ほど ★★★★★〜★★★★ のソースを使う。
- 最終回答は必ず EXECUTIVE SUMMARY から始め、ACTION PLAN・PRIORITY(S〜D)・
  CONFIDENCE(高/中/低)・SOURCES(URL/公開日/確認日) まで含める。
- 調査不足なら無理に結論を出さず、何を追加調査すれば判断できるかを提示する。
