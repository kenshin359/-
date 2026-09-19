#!/bin/sh
# 朝礼のイベントカレンダー（daily-report-system/config/chorei/events-YYYY-MM.json）を
# ダッシュボードへ取り込む。Vercel は dashboard/ だけをビルドするため、参照ではなくコピーで持つ。
# 月初にカレンダーを更新したら、このスクリプトを実行して生成物もコミットする。
set -e
cd "$(dirname "$0")/.."
src="../daily-report-system/config/chorei"
[ -d "$src" ] || { echo "ERROR: $src が見つかりません（リポジトリのルートから実行してください）"; exit 1; }
mkdir -p src/data/events
cp "$src"/events-*.json src/data/events/
# 静的インポートの目録を生成（サーバーレスでも確実にバンドルされるように）
out=src/data/events/index.ts
{
  echo "// 自動生成: sh scripts/sync-events.sh で作り直す。手で編集しない。"
  echo "// 朝礼のイベントカレンダー（daily-report-system/config/chorei/events-YYYY-MM.json）のコピー。"
  i=0
  for f in src/data/events/events-*.json; do
    m=$(basename "$f" .json | sed 's/^events-//')
    i=$((i + 1))
    echo "import m$i from './events-$m.json';"
  done
  echo ""
  echo "export const EVENT_CALENDARS: Record<string, unknown> = {"
  i=0
  for f in src/data/events/events-*.json; do
    m=$(basename "$f" .json | sed 's/^events-//')
    i=$((i + 1))
    echo "  '$m': m$i,"
  done
  echo "};"
} > "$out"
ls src/data/events
echo "sync-events: 完了。src/data/events/ をコミットしてください"
