// ============================================================
//  kintone「お知らせ」貼り付け用HTMLの生成
// ------------------------------------------------------------
//  kintoneのお知らせ欄はJavaScriptが動かず、貼り付けたHTMLだけが
//  表示されます。そのため <script> や <style> を使わず、
//  すべて inline style で自己完結したHTMLを作ります。
//  データ（カレンダー用データセット）から静的スナップショットを生成。
//
//  buildNoticeHTML(dataset, {todayKey}) は純関数（テスト可能）。
// ============================================================
import { TEAMS, STATUSES } from './taskData.js';

const teamNameById = Object.fromEntries(TEAMS.map((t) => [t.id, t.name]));
const statusNameById = Object.fromEntries(STATUSES.map((s) => [s.id, s.name]));
const STATUS_STYLE = {
  todo: 'color:#6b6a66;background:#eef0f2',
  doing: 'color:#1f6feb;background:#e7f0fb',
  done: 'color:#1e9e5a;background:#e6f5ec',
  late: 'color:#d03b3b;background:#fbe9e9',
};

function esc(s) {
  s = s == null ? '' : String(s);
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function teamName(id) { return teamNameById[id] || id || 'その他'; }
function statusName(id) { return statusNameById[id] || id; }

function isOverdue(t, tk) { return t.status !== 'done' && (t.status === 'late' || (tk && t.key < tk)); }
function isDueToday(t, tk) { return t.status !== 'done' && tk && t.key === tk; }

function tile(label, value, color) {
  return (
    '<div style="flex:1;min-width:96px;background:#f4f5f2;border:1px solid #e4e3dc;border-radius:10px;padding:9px 12px">' +
    '<div style="font-size:11px;color:#6b6a66">' + esc(label) + '</div>' +
    '<div style="font-size:20px;font-weight:700;' + (color ? 'color:' + color : '') + '">' + esc(value) + '</div>' +
    '</div>'
  );
}

function taskLine(t, tk) {
  const over = isOverdue(t, tk);
  const mark = over ? '⚠ ' : '● ';
  const markColor = over ? '#d03b3b' : '#1f6feb';
  const prio = t.prio === '高' ? '<b style="color:#d03b3b">【高】</b>' : '';
  const dueStyle = over ? 'color:#d03b3b;font-weight:700' : 'color:#8b8a84';
  return (
    '<div style="padding:4px 0;border-bottom:1px solid #f0f0ec;font-size:13px;color:#2b3543">' +
    '<span style="color:' + markColor + '">' + mark + '</span>' + prio + esc(t.title) +
    ' <span style="color:#6b6a66">（' + esc(t.memberName) + ' / ' + esc(teamName(t.dept)) + '）</span>' +
    ' <span style="' + dueStyle + '">期日 ' + esc(t.key) + '</span>' +
    '</div>'
  );
}

/**
 * kintoneお知らせ用HTMLを生成する。
 * @param {object} dataset  { tasks, teams, generatedAt }
 * @param {object} opts      { todayKey, title?, maxList? }
 * @returns {string} 貼り付け用HTML（inline styleのみ・script/styleなし）
 */
export function buildNoticeHTML(dataset, opts = {}) {
  const tk = opts.todayKey;
  const title = opts.title || '業務タスク 状況';
  const maxList = opts.maxList || 20;
  const tasks = (dataset && dataset.tasks) || [];

  const total = tasks.length;
  let todo = 0, doing = 0, done = 0, late = 0;
  tasks.forEach((t) => {
    if (t.status === 'todo') todo++;
    else if (t.status === 'doing') doing++;
    else if (t.status === 'done') done++;
    if (isOverdue(t, tk)) late++;
  });
  const rate = total ? Math.round((done / total) * 100) : 0;

  // 要対応（遅延→本日締切）
  const attention = tasks
    .filter((t) => isOverdue(t, tk) || isDueToday(t, tk))
    .sort((a, b) => {
      const oa = isOverdue(a, tk) ? 0 : 1, ob = isOverdue(b, tk) ? 0 : 1;
      if (oa !== ob) return oa - ob;
      return String(a.key).localeCompare(String(b.key));
    });

  // チーム別サマリー
  const byTeam = {};
  tasks.forEach((t) => {
    const g = byTeam[t.dept] || { total: 0, late: 0 };
    g.total++;
    if (isOverdue(t, tk)) g.late++;
    byTeam[t.dept] = g;
  });
  const teamRows = TEAMS.filter((tm) => byTeam[tm.id])
    .map((tm) => {
      const g = byTeam[tm.id];
      return (
        '<tr>' +
        '<td style="padding:5px 8px;border-bottom:1px solid #eee">' + esc(tm.name) + '</td>' +
        '<td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right">' + g.total + '</td>' +
        '<td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right;' + (g.late ? 'color:#d03b3b;font-weight:700' : 'color:#8b8a84') + '">' + g.late + '</td>' +
        '</tr>'
      );
    })
    .join('');

  const stamp = (dataset && dataset.generatedAt) ? new Date(dataset.generatedAt).toLocaleString('ja-JP') : (tk || '');

  let html = '';
  html += '<div style="font-family:system-ui,-apple-system,\'Hiragino Kaku Gothic ProN\',\'Noto Sans JP\',sans-serif;color:#1f2937;max-width:900px">';
  html += '<div style="font-size:16px;font-weight:700;margin-bottom:2px">📋 ' + esc(title) + '</div>';
  html += '<div style="font-size:11.5px;color:#8b8a84;margin-bottom:12px">更新: ' + esc(stamp) + '</div>';

  // KPI
  html += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px">';
  html += tile('対象タスク', total + '件');
  html += tile('未着手', todo + '件');
  html += tile('進行中', doing + '件');
  html += tile('遅延', late + '件', late ? '#d03b3b' : '');
  html += tile('完了率', rate + '%', '#1e9e5a');
  html += '</div>';

  // 要対応
  html += '<div style="font-size:13.5px;font-weight:700;margin:0 0 6px;color:#33404f;border-bottom:2px solid #eceef1;padding-bottom:4px">要対応（遅延・本日締切）' +
    '<span style="font-weight:500;color:#8b8a84;font-size:12px">　' + attention.length + '件</span></div>';
  if (attention.length) {
    html += '<div style="margin-bottom:14px">';
    attention.slice(0, maxList).forEach((t) => { html += taskLine(t, tk); });
    if (attention.length > maxList) html += '<div style="font-size:12px;color:#8b8a84;padding-top:4px">…ほか ' + (attention.length - maxList) + '件</div>';
    html += '</div>';
  } else {
    html += '<div style="font-size:13px;color:#1e9e5a;margin-bottom:14px">遅延・本日締切のタスクはありません 🎉</div>';
  }

  // チーム別
  html += '<div style="font-size:13.5px;font-weight:700;margin:0 0 6px;color:#33404f;border-bottom:2px solid #eceef1;padding-bottom:4px">チーム別</div>';
  html += '<table style="border-collapse:collapse;font-size:12.5px;min-width:280px">' +
    '<thead><tr>' +
    '<th style="text-align:left;padding:5px 8px;color:#8b8a84;border-bottom:1px solid #ddd">チーム</th>' +
    '<th style="text-align:right;padding:5px 8px;color:#8b8a84;border-bottom:1px solid #ddd">件数</th>' +
    '<th style="text-align:right;padding:5px 8px;color:#8b8a84;border-bottom:1px solid #ddd">遅延</th>' +
    '</tr></thead><tbody>' + teamRows + '</tbody></table>';

  html += '<div style="font-size:11px;color:#9aa4b0;margin-top:12px">※ この表示は貼り付け時点のスナップショットです（自動更新は task:notice を定期実行）。</div>';
  html += '</div>';
  return html;
}
