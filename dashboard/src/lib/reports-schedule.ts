// 定時レポート（GitHub Actions → Chatwork / Kintone）の一覧。出典: docs/business.md §5.2「1日の流れ（JST）」。
// ダッシュボードからは各出力先（Chatworkルーム・Kintone）へのリンクは未接続（URL未提供）。表示は一覧のみで、成功と偽らない。
export interface ScheduledReport {
  time: string;
  name: string;
  /** 何が出るか（business.md の表記どおり） */
  detail: string;
  /** 出力先 */
  destination: string;
  /** ダッシュボード内の対応画面（無ければ null） */
  href: string | null;
}

export const SCHEDULED_REPORTS: ScheduledReport[] = [
  { time: '7:12 / 7:19 / 7:26', name: '売上取込', detail: 'Shopify / Amazon / 楽天の売上取込 → Kintone 売上明細(29)', destination: 'Chatwork 売上ルーム', href: '/products' },
  { time: '7:52', name: '参謀レポート', detail: '総売上・計画比・媒体別・商品別・15日平均差・前月同期間比', destination: 'Chatwork 売上ルーム', href: '/sales' },
  { time: '7:55', name: '朝礼台本', detail: '15分厳守の台本 ＋ 売上進捗シートExcel', destination: 'Chatwork 朝礼ルーム', href: '/pro/today' },
  { time: '11:02', name: '広告費レポート', detail: '媒体別（手動値込み）', destination: 'Chatwork 朝礼ルーム', href: '/ads' },
  { time: '11:10', name: 'デイリーニュース', detail: '判定🟢🟡🔴・良い広告／悪い広告', destination: 'Kintone デイリーニュース(39)', href: null },
  { time: '11:20', name: 'ダッシュボード取込', detail: 'KPI日次・合算CPA日次・商品別売上を /api/pro/ingest へ取込', destination: 'このダッシュボード（KpiDaily／CpaDaily／ProductSalesDaily）', href: '/products' },
  { time: '11:20 / 11:30', name: '売上差額チェック／広告CSV抜けチェック', detail: '±1万円超のみ／広告CSV 7欄の抜け', destination: 'Chatwork 朝礼ルーム', href: null },
  { time: '12:41 / 18:41', name: '売上検算', detail: '楽天・Shopify API と突合 → ずれた日だけ再取込', destination: 'Chatwork 売上ルーム（修正時のみ）', href: null },
  { time: '19:07', name: '売上レポート', detail: '分析つき ＋ 直近14日の簡易シート', destination: 'Chatwork 売上ルーム', href: '/sales' },
  { time: '21:17', name: '楽天売上の速報', detail: 'マラソン日の戦況確認', destination: 'Chatwork', href: null },
  { time: '毎月22日', name: '経費レポートPDF', detail: '締め: 前月22日〜当月21日', destination: '経理', href: null },
];
