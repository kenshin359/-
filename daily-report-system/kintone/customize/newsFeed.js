/* ============================================================
 * リベティ・デイリーニュース  カード型ニュースフィード
 * ------------------------------------------------------------
 * 「📱 ニュース」ビュー（カスタムビュー）を開くと、
 * スマホアプリのようなカード形式でニュースが読めます。
 * データはこのアプリのレコードを読むだけ（書き込みなし）。
 * ============================================================ */
(function () {
  'use strict';

  var CSS = [
    '#libetee-news-root{max-width:720px;margin:0 auto;padding:12px;font-family:"Hiragino Sans","Yu Gothic",sans-serif;}',
    '.ln-header{font-size:22px;font-weight:800;margin:8px 4px 16px;color:#1f3864;}',
    '.ln-card{background:#fff;border-radius:14px;box-shadow:0 2px 10px rgba(0,0,0,.08);padding:18px;margin-bottom:16px;border:1px solid #eee;}',
    '.ln-date{font-size:12px;color:#888;letter-spacing:.05em;}',
    '.ln-judge{display:inline-block;font-size:12px;font-weight:700;border-radius:999px;padding:2px 10px;margin-left:8px;vertical-align:1px;}',
    '.ln-judge.g{background:#e6f4ea;color:#1e7e34;} .ln-judge.y{background:#fff8e1;color:#9a6b00;} .ln-judge.r{background:#fdecea;color:#c62828;}',
    '.ln-headline{font-size:17px;font-weight:800;margin:6px 0 12px;line-height:1.5;color:#222;}',
    '.ln-chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;}',
    '.ln-chip{background:#f4f6fa;border-radius:10px;padding:8px 12px;min-width:96px;}',
    '.ln-chip b{display:block;font-size:15px;color:#1f3864;} .ln-chip span{font-size:11px;color:#777;}',
    '.ln-sec{border-radius:10px;padding:10px 12px;margin-top:8px;font-size:13px;line-height:1.7;white-space:pre-wrap;}',
    '.ln-sec.good{background:#f0faf2;border-left:4px solid #34a853;} .ln-sec.bad{background:#fdf3f2;border-left:4px solid #ea4335;}',
    '.ln-sec .t{font-weight:700;display:block;margin-bottom:2px;}',
    '.ln-more{margin-top:10px;} .ln-more summary{cursor:pointer;font-size:12px;color:#1a73e8;}',
    '.ln-body{white-space:pre-wrap;font-size:13px;line-height:1.8;color:#333;margin-top:8px;}',
    '.ln-empty{color:#888;text-align:center;padding:40px 0;}',
    '@media (max-width:480px){.ln-chip{min-width:86px;padding:7px 10px;}}'
  ].join('\n');

  function num(v) { return v == null || v === '' ? null : Number(v); }
  function yen(v) { var n = num(v); return n == null ? '—' : '¥' + n.toLocaleString('ja-JP'); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function judgeClass(j) {
    if (j && j.indexOf('🟢') === 0) return 'g';
    if (j && j.indexOf('🔴') === 0) return 'r';
    return 'y';
  }
  function fmtDate(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    var d = new Date(iso + 'T00:00:00+09:00');
    var w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    return p[0] + '年' + Number(p[1]) + '月' + Number(p[2]) + '日（' + w + '）';
  }

  function card(r) {
    var g = function (code) { return r[code] ? r[code].value : null; };
    var chips = [
      ['売上', yen(g('sales_total'))],
      ['販売個数', num(g('units_total')) == null ? '—' : Number(g('units_total')).toLocaleString('ja-JP') + '個'],
      ['広告費', yen(g('adcost_total'))],
      ['広告費率', g('ad_ratio') ? Number(g('ad_ratio')).toFixed(1) + '%' : '—'],
      ['転換率', g('cvr_note') || '—']
    ];
    var html = '<div class="ln-card">';
    html += '<div class="ln-date">' + esc(fmtDate(g('news_date'))) +
      '<span class="ln-judge ' + judgeClass(g('judge')) + '">' + esc(g('judge') || '') + '</span></div>';
    html += '<div class="ln-headline">' + esc(g('headline')) + '</div>';
    html += '<div class="ln-chips">' + chips.map(function (c) {
      return '<div class="ln-chip"><span>' + esc(c[0]) + '</span><b>' + esc(c[1]) + '</b></div>';
    }).join('') + '</div>';
    if (g('good_ads')) html += '<div class="ln-sec good"><span class="t">🏆 良い広告</span>' + esc(g('good_ads')) + '</div>';
    if (g('bad_ads')) html += '<div class="ln-sec bad"><span class="t">⚠️ 悪い広告</span>' + esc(g('bad_ads')) + '</div>';
    if (g('body')) html += '<details class="ln-more"><summary>記事全文を読む</summary><div class="ln-body">' + esc(g('body')) + '</div></details>';
    html += '</div>';
    return html;
  }

  function render(root) {
    root.innerHTML = '<div class="ln-header">📰 リベティ・デイリーニュース</div><div class="ln-empty">読み込み中…</div>';
    kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
      app: kintone.app.getId(),
      query: 'order by news_date desc limit 30'
    }).then(function (resp) {
      var cards = (resp.records || []).map(card).join('');
      root.innerHTML = '<div class="ln-header">📰 リベティ・デイリーニュース</div>' +
        (cards || '<div class="ln-empty">まだニュースがありません（毎朝11:10に自動投稿されます）</div>');
    }).catch(function () {
      root.innerHTML = '<div class="ln-empty">読み込みに失敗しました。再読み込みしてください。</div>';
    });
  }

  function boot() {
    var root = document.getElementById('libetee-news-root');
    if (!root) return;
    if (!document.getElementById('libetee-news-css')) {
      var st = document.createElement('style');
      st.id = 'libetee-news-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    render(root);
  }

  kintone.events.on(['app.record.index.show', 'mobile.app.record.index.show'], function (ev) {
    boot();
    return ev;
  });
})();
