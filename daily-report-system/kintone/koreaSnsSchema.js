// ============================================================
//  韓国SNS運用管理（明洞）アプリ  フィールド定義
// ------------------------------------------------------------
//  韓国チームの「撮影 → 編集 → 投稿 → 広告 → 流入 → 予約」を
//  1案件＝1レコードで最後まで追いかけるためのアプリです。
//
//  いま困っていること（このアプリで解決したいこと）:
//    ① 編集担当が何をしているのか見えない
//    ② 撮影日が直前まで分からない → 事前共有は【撮影日の2日前まで】
//    ③ 撮影したあと、何本編集していつ投稿するのか分からない
//    ④ 投稿されたのか、どんな形（リール/タイアップ/広告）なのか分からない
//    ⑤ 投稿して終わり。予約・売上につながったのか分からない
//
//  設計のきまり:
//    ・1案件（1回の撮影）＝1レコード。投稿は本数ぶんサブテーブルに並べる。
//    ・「報告した」ではなく「数字が入っている」ことを完了とみなす。
//      → 未入力の欄がそのまま “未報告アラート” になる（lib/koreaSns.js）。
//    ・入力欄はすべて韓国チームが自分で埋められる粒度にする。
// ============================================================

export const APP_NAME = '韓国SNS運用管理（明洞）';

const drop = (code, label, options, extra = {}) => ({
  type: 'DROP_DOWN',
  code,
  label,
  options: Object.fromEntries(options.map((o, i) => [o, { label: o, index: String(i) }])),
  ...extra,
});

const checks = (code, label, options, extra = {}) => ({
  type: 'CHECK_BOX',
  code,
  label,
  options: Object.fromEntries(options.map((o, i) => [o, { label: o, index: String(i) }])),
  ...extra,
});

const num = (code, label, extra = {}) => ({ type: 'NUMBER', code, label, ...extra });

// ── 選択肢（config/korea-sns.json と必ず一致させること。test で検査しています）──
export const MEDIA_OPTIONS = ['Instagram', 'TikTok', 'NAVER', 'YouTube', 'その他'];
export const FORMAT_OPTIONS = ['リール', 'フィード', 'ストーリー', 'ショート', 'ブログ記事', 'その他'];
export const POST_TYPE_OPTIONS = ['通常投稿', 'タイアップ（PR表記あり）', '広告クリエイティブ', 'リポスト・二次利用'];
export const GOAL_OPTIONS = ['予約獲得', '認知拡大（リーチ）', '来店促進', 'ブランディング', '商品・メニュー訴求', 'イベント告知'];
export const AD_OPTIONS = ['あり', 'なし', '未定'];

// 案件がいまどこまで進んだか。韓国チームはここを進めるだけでよい。
export const STATUS_OPTIONS = [
  '① 事前共有済み',
  '② 撮影済み',
  '③ 編集中',
  '④ 投稿済み',
  '⑤ 広告運用中',
  '⑥ 成果集計済み',
  '中止',
];

// 投稿1本＝サブテーブル1行。1回の撮影から何本も投稿が出るため。
function postFields() {
  return {
    p_post_date: { type: 'DATE', code: 'p_post_date', label: '投稿日' },
    p_media: drop('p_media', '媒体', MEDIA_OPTIONS),
    p_format: drop('p_format', '投稿形態', FORMAT_OPTIONS),
    p_type: drop('p_type', '投稿の種類', POST_TYPE_OPTIONS),
    p_url: { type: 'LINK', code: 'p_url', label: '投稿URL', protocol: 'WEB' },
    p_ad: drop('p_ad', '広告利用', ['あり', 'なし'], { defaultValue: 'なし' }),
    p_ad_cost: num('p_ad_cost', '広告費（円）'),
    p_views: num('p_views', '再生・表示数'),
    p_likes: num('p_likes', 'いいね'),
    p_saves: num('p_saves', '保存'),
    p_profile: num('p_profile', 'プロフィール遷移'),
    p_clicks: num('p_clicks', 'リンククリック（予約導線）'),
    p_note: { type: 'SINGLE_LINE_TEXT', code: 'p_note', label: 'ひとこと（伸びた理由・落ちた理由）' },
  };
}

export const FIELDS = {
  // ── 案件の基本 ──
  title: { type: 'SINGLE_LINE_TEXT', code: 'title', label: '案件名（例: 9/20 明洞店 インフルエンサー撮影）', required: true },
  status: drop('status', '進捗（ここを進めるだけでOK）', STATUS_OPTIONS, { defaultValue: '① 事前共有済み' }),
  owner: { type: 'SINGLE_LINE_TEXT', code: 'owner', label: '案件担当（韓国チーム）' },
  editor: { type: 'SINGLE_LINE_TEXT', code: 'editor', label: '編集担当' },
  goal: drop('goal', 'この撮影の目的（何のためにやるか）', GOAL_OPTIONS, { defaultValue: '予約獲得' }),

  // ── ① 事前報告（撮影日の2日前まで）──
  shared_at: { type: 'DATE', code: 'shared_at', label: '事前共有した日（★撮影日の2日前まで）' },
  shoot_date: { type: 'DATE', code: 'shoot_date', label: '撮影日', required: true },
  shoot_time: { type: 'SINGLE_LINE_TEXT', code: 'shoot_time', label: '撮影時間（例: 14:00〜17:00）' },
  place: { type: 'SINGLE_LINE_TEXT', code: 'place', label: '撮影場所' },
  content: { type: 'MULTI_LINE_TEXT', code: 'content', label: '撮影内容（何を撮るか）' },
  cast: { type: 'SINGLE_LINE_TEXT', code: 'cast', label: '出演者・インフルエンサー（アカウント名）' },
  cast_follower: num('cast_follower', 'フォロワー数'),
  plan_count: num('plan_count', '撮影予定本数'),
  plan_media: checks('plan_media', '投稿予定媒体', MEDIA_OPTIONS),
  plan_post_date: { type: 'DATE', code: 'plan_post_date', label: '投稿予定日' },
  plan_ad: drop('plan_ad', '広告利用の予定', AD_OPTIONS, { defaultValue: '未定' }),

  // ── ② 撮影後報告（撮影当日中）──
  shot_count: num('shot_count', '撮影本数（実績）'),
  edit_count: num('edit_count', '編集予定本数'),
  edit_due: { type: 'DATE', code: 'edit_due', label: '編集完了予定日' },
  edit_done: { type: 'DATE', code: 'edit_done', label: '編集完了日（実績）' },
  shoot_note: { type: 'MULTI_LINE_TEXT', code: 'shoot_note', label: '撮影後メモ（撮れたもの・撮れなかったもの）' },

  // ── ③ 投稿報告（投稿した日のうちに1行追加）──
  posts: {
    type: 'SUBTABLE',
    code: 'posts',
    label: '投稿明細（1投稿＝1行）',
    fields: postFields(),
  },

  // 合計はkintoneが自動で出す（人が電卓を叩かないため）
  total_ad_cost: {
    type: 'CALC', code: 'total_ad_cost', label: '広告費 合計（自動）',
    expression: 'SUM(p_ad_cost)', format: 'NUMBER_DIGIT',
  },
  total_views: {
    type: 'CALC', code: 'total_views', label: '再生・表示数 合計（自動）',
    expression: 'SUM(p_views)', format: 'NUMBER_DIGIT',
  },
  total_clicks: {
    type: 'CALC', code: 'total_clicks', label: 'リンククリック 合計（自動）',
    expression: 'SUM(p_clicks)', format: 'NUMBER_DIGIT',
  },

  // ── ④ 成果（流入 → 予約 → 売上）──
  inflow: num('inflow', 'SNS経由の流入数（プロフィール/予約ページ）'),
  reserve: num('reserve', '予約件数'),
  visit: num('visit', '来店件数'),
  sales: num('sales', '売上（円・税込）'),
  cpa: {
    type: 'CALC', code: 'cpa', label: '予約1件あたりの広告費（自動）',
    // 0除算をさけて「0」と表示する（エラー表示だと現場が不安になるため）
    expression: 'IF(reserve > 0, total_ad_cost / reserve, 0)', format: 'NUMBER_DIGIT',
  },
  result_note: { type: 'MULTI_LINE_TEXT', code: 'result_note', label: '振り返り（なぜ伸びた/伸びなかった・次の打ち手）' },

  note: { type: 'MULTI_LINE_TEXT', code: 'note', label: '備考' },
};

export const VIEWS = {
  '今週の撮影予定': {
    index: 0,
    type: 'LIST',
    name: '今週の撮影予定',
    fields: ['shoot_date', 'shoot_time', 'title', 'place', 'cast', 'plan_count', 'plan_post_date', 'plan_ad', 'status'],
    filterCond: 'shoot_date >= TODAY() and status not in ("中止")',
    sort: 'shoot_date asc',
  },
  '⚠ 事前共有がない撮影': {
    index: 1,
    type: 'LIST',
    name: '⚠ 事前共有がない撮影',
    fields: ['shoot_date', 'title', 'shared_at', 'place', 'cast', 'owner'],
    // 共有日そのものが空＝ルール違反。2日前を切っているかは週次レポートが判定します。
    filterCond: 'shared_at is empty and status not in ("中止")',
    sort: 'shoot_date asc',
  },
  '編集中（期限順）': {
    index: 2,
    type: 'LIST',
    name: '編集中（期限順）',
    fields: ['edit_due', 'title', 'editor', 'shot_count', 'edit_count', 'plan_post_date', 'status'],
    filterCond: 'status in ("② 撮影済み", "③ 編集中")',
    sort: 'edit_due asc',
  },
  '投稿済み・成果が未入力': {
    index: 3,
    type: 'LIST',
    name: '投稿済み・成果が未入力',
    fields: ['shoot_date', 'title', 'total_views', 'total_ad_cost', 'inflow', 'reserve', 'status'],
    filterCond: 'reserve is empty and status in ("④ 投稿済み", "⑤ 広告運用中")',
    sort: 'shoot_date asc',
  },
  '今月の案件（成果つき）': {
    index: 4,
    type: 'LIST',
    name: '今月の案件（成果つき）',
    fields: ['shoot_date', 'title', 'goal', 'cast', 'total_views', 'total_ad_cost', 'inflow', 'reserve', 'sales', 'cpa'],
    filterCond: 'shoot_date = THIS_MONTH()',
    sort: 'shoot_date desc',
  },
  すべて: {
    index: 5,
    type: 'LIST',
    name: 'すべて',
    fields: ['shoot_date', 'title', 'owner', 'editor', 'status', 'reserve', 'sales'],
    sort: 'shoot_date desc',
  },
};

// ★kintoneの仕様: REPORTSのキーは name と完全一致させること（GAIA_IN07対策）
export const REPORTS = {
  '今月 媒体別の再生数': {
    chartType: 'BAR',
    chartMode: 'NORMAL',
    index: 0,
    name: '今月 媒体別の再生数',
    groups: [{ code: 'p_media' }],
    aggregations: [{ type: 'SUM', code: 'p_views' }],
    filterCond: 'shoot_date = THIS_MONTH()',
    sorts: [{ by: 'TOTAL', order: 'DESC' }],
  },
  '今月 目的別の予約件数': {
    chartType: 'BAR',
    chartMode: 'NORMAL',
    index: 1,
    name: '今月 目的別の予約件数',
    groups: [{ code: 'goal' }],
    aggregations: [{ type: 'SUM', code: 'reserve' }],
    filterCond: 'shoot_date = THIS_MONTH()',
    sorts: [{ by: 'TOTAL', order: 'DESC' }],
  },
  '進捗の内訳': {
    chartType: 'PIE',
    chartMode: 'NORMAL',
    index: 2,
    name: '進捗の内訳',
    groups: [{ code: 'status' }],
    aggregations: [{ type: 'COUNT' }],
    filterCond: 'shoot_date = THIS_MONTH()',
    sorts: [{ by: 'TOTAL', order: 'DESC' }],
  },
};
