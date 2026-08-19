/* ============================================================
 *  業務タスクアプリ  一覧カスタマイズ
 * ------------------------------------------------------------
 *  kintoneの「業務タスク」アプリの一覧画面の上部に、
 *  KPIサマリー＋チーム別のカード表示を追加します（別アプリ不要）。
 *
 *  導入:
 *    アプリ設定 → カスタマイズ/サービス連携 → JavaScript / CSS でカスタマイズ
 *    ・PC用のJavaScript に taskListCustomize.js を追加
 *    ・PC用のCSS       に taskListCustomize.css を追加
 *    → 保存してアプリを更新
 *
 *  フィールドコードは taskAppSchema.js と一致:
 *    task_title / assignee / team / category / priority / status / due_date
 * ============================================================ */
(function () {
  'use strict';

  var F = {
    title: 'task_title', assignee: 'assignee', team: 'team',
    category: 'category', priority: 'priority', status: 'status', due: 'due_date',
  };

  // チームの表示順（未知チームは末尾）
  var TEAM_ORDER = ['本部チーム', '広告運用チーム', 'SNSチーム', 'LPチーム', 'CSチーム', '社長室', 'TikTok', 'アルバイト'];

  var CAT_COLOR = {
    '会議': '#2a78d6', '資料作成': '#1e9e5a', '顧客対応': '#eb6834',
    '出荷・物流': '#8a63d2', '分析': '#eda100', '開発': '#17a2b8', 'レビュー': '#d0679a',
  };
  var STATUS = {
    '未着手': { fg: '#6b6a66', bg: '#eef0f2' },
    '進行中': { fg: '#1f6feb', bg: '#e7f0fb' },
    '完了': { fg: '#1e9e5a', bg: '#e6f5ec' },
    '遅延': { fg: '#d03b3b', bg: '#fbe9e9' },
  };

  function esc(s) {
    s = (s == null ? '' : String(s));
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function val(rec, code) { return rec[code] && rec[code].value != null ? rec[code].value : ''; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function todayKey() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  function isOverdue(rec, tk) {
    var s = val(rec, F.status);
    var due = val(rec, F.due);
    return s !== '完了' && (s === '遅延' || (due && due < tk));
  }

  // $idカーソルで全件取得（最大数千件想定）
  function fetchAll(app) {
    var all = [];
    function page(last) {
      var q = '$id > ' + last + ' order by $id asc limit 500';
      return kintone.api(kintone.api.url('/k/v1/records', true), 'GET', { app: app, query: q }).then(function (r) {
        all = all.concat(r.records);
        if (r.records.length === 500) return page(r.records[r.records.length - 1].$id.value);
        return all;
      });
    }
    return page(0);
  }

  function tile(label, value, cls) {
    return '<div class="tkc-tile ' + (cls || '') + '">' +
      '<div class="tkc-tile-l">' + esc(label) + '</div>' +
      '<div class="tkc-tile-v">' + esc(value) + '</div></div>';
  }

  function cardHTML(rec, tk) {
    var title = val(rec, F.title);
    var team = val(rec, F.team);
    var cat = val(rec, F.category);
    var assignee = val(rec, F.assignee);
    var prio = val(rec, F.priority);
    var status = val(rec, F.status);
    var due = val(rec, F.due);
    var overdue = isOverdue(rec, tk);
    var st = STATUS[status] || { fg: '#6b6a66', bg: '#eef0f2' };
    var accent = overdue ? '#d03b3b' : (CAT_COLOR[cat] || '#c3c2b7');
    var recId = rec.$id ? rec.$id.value : '';
    var url = recId ? (location.pathname.replace(/\/[^/]*$/, '') + '/show#record=' + recId) : '#';

    var pills = '';
    if (team) pills += '<span class="tkc-pill">' + esc(team) + '</span>';
    if (cat) pills += '<span class="tkc-pill"><i style="background:' + (CAT_COLOR[cat] || '#c3c2b7') + '"></i>' + esc(cat) + '</span>';
    if (prio) pills += '<span class="tkc-prio tkc-prio-' + esc(prio) + '">優先度 ' + esc(prio) + '</span>';

    return '<a class="tkc-card" href="' + esc(url) + '" style="border-left-color:' + accent + '">' +
      '<div class="tkc-card-top">' +
        '<span class="tkc-title">' + esc(title || '(無題)') + '</span>' +
        '<span class="tkc-badge" style="color:' + st.fg + ';background:' + st.bg + '">' + esc(status || '-') + '</span>' +
      '</div>' +
      '<div class="tkc-card-meta">' +
        '<span class="tkc-who">' + esc(assignee || '担当未定') + '</span>' +
        pills +
        '<span class="tkc-due' + (overdue ? ' tkc-due-late' : '') + '">' + (due ? (overdue ? '⚠ 期日 ' : '期日 ') + esc(due) : '期日なし') + '</span>' +
      '</div>' +
    '</a>';
  }

  function render(records) {
    var el = kintone.app.getHeaderSpaceElement();
    if (!el) return;
    el.innerHTML = '';
    var tk = todayKey();

    var total = records.length, doing = 0, done = 0, late = 0, todo = 0;
    records.forEach(function (r) {
      var s = val(r, F.status);
      if (s === '進行中') doing++;
      if (s === '完了') done++;
      if (s === '未着手') todo++;
      if (isOverdue(r, tk)) late++;
    });
    var rate = total ? Math.round(done / total * 100) : 0;

    var html = '<div class="tkc-wrap">';
    html += '<div class="tkc-head">業務タスク一覧 <span class="tkc-sub">' + esc(todayKey()) + ' 時点</span></div>';
    html += '<div class="tkc-kpis">' +
      tile('対象タスク', total + '件') +
      tile('未着手', todo + '件') +
      tile('進行中', doing + '件') +
      tile('遅延', late + '件', late ? 'late' : '') +
      tile('完了率', rate + '%', 'done') +
      '</div>';

    // チーム別にグループ化し、各チーム内は「遅延→期日昇順」で並べる
    var groups = {};
    records.forEach(function (r) {
      var team = val(r, F.team) || 'その他';
      (groups[team] = groups[team] || []).push(r);
    });
    var teams = Object.keys(groups).sort(function (a, b) {
      var ia = TEAM_ORDER.indexOf(a), ib = TEAM_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

    teams.forEach(function (team) {
      var list = groups[team].sort(function (a, b) {
        var oa = isOverdue(a, tk) ? 0 : 1, ob = isOverdue(b, tk) ? 0 : 1;
        if (oa !== ob) return oa - ob;
        return String(val(a, F.due)).localeCompare(String(val(b, F.due)));
      });
      var teamLate = list.filter(function (r) { return isOverdue(r, tk); }).length;
      html += '<div class="tkc-group">';
      html += '<div class="tkc-group-h">' + esc(team) + '<span class="tkc-count">' + list.length + '件' +
        (teamLate ? ' ／ <b class="tkc-red">遅延 ' + teamLate + '</b>' : '') + '</span></div>';
      html += '<div class="tkc-cards">';
      list.forEach(function (r) { html += cardHTML(r, tk); });
      html += '</div></div>';
    });

    html += '<div class="tkc-foot">下の一覧（表）から通常どおり絞り込み・編集もできます。</div>';
    html += '</div>';
    el.innerHTML = html;
  }

  kintone.events.on('app.record.index.show', function (event) {
    var app = kintone.app.getId();
    if (!app) return event;
    fetchAll(app).then(render).catch(function (e) {
      console.error('業務タスク一覧カスタマイズでエラー:', e);
    });
    return event;
  });
})();
