// kintoneお知らせ用HTML生成のテスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNoticeHTML } from '../lib/kintoneNotice.js';

function ds(tasks) {
  return { tasks, teams: [], generatedAt: '2026-08-05T00:00:00Z' };
}
function t(o) {
  return {
    id: o.id || 't', title: o.title || 'タスク', cat: 'doc', dept: o.dept || 'cs',
    member: 'm', memberName: o.memberName || '笹本', status: o.status || 'todo',
    prio: o.prio || '中', key: o.key || '2026-08-10',
  };
}

test('buildNoticeHTML: KPIと要対応・チーム別を含む', () => {
  const html = buildNoticeHTML(ds([
    t({ title: '遅延タスク', status: 'todo', key: '2026-08-01', dept: 'cs' }),
    t({ title: '本日締切', status: 'todo', key: '2026-08-05', dept: 'ad', memberName: '角南' }),
    t({ title: '完了分', status: 'done', key: '2026-08-02', dept: 'cs' }),
  ]), { todayKey: '2026-08-05' });
  assert.match(html, /対象タスク/);
  assert.match(html, /遅延/);
  assert.match(html, /要対応/);
  assert.match(html, /遅延タスク/);
  assert.match(html, /本日締切/);
  assert.match(html, /CSチーム/);
  assert.match(html, /広告運用チーム/);
});

test('buildNoticeHTML: script/styleタグを含まない（お知らせ欄で無効化されないため）', () => {
  const html = buildNoticeHTML(ds([t({})]), { todayKey: '2026-08-05' });
  assert.ok(!/<script/i.test(html));
  assert.ok(!/<style/i.test(html));
});

test('buildNoticeHTML: 外部文字列をHTMLエスケープする', () => {
  const html = buildNoticeHTML(ds([
    t({ title: '<img src=x onerror=alert(1)>', memberName: '<b>x</b>', status: 'late', key: '2026-08-01' }),
  ]), { todayKey: '2026-08-05' });
  assert.ok(!/<img/.test(html));
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
});

test('buildNoticeHTML: 遅延・本日締切が無ければその旨', () => {
  const html = buildNoticeHTML(ds([t({ status: 'done', key: '2026-08-01' })]), { todayKey: '2026-08-05' });
  assert.match(html, /遅延・本日締切のタスクはありません/);
});
