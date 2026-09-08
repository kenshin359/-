// ============================================================
//  AI秘書（1日タスク最適化）のテスト
// ------------------------------------------------------------
//  守りたいこと:
//    ・6カテゴリの分類が、指定された例のとおりになること
//    ・15時以降にTHINKを置かないこと（判断が要る仕事も16時で打ち切り）
//    ・昼食・昼寝・15時前の休憩が絶対に潰れないこと
//    ・会議が続いたら間に休憩が入ること
//    ・他人を止めている5〜10分の依頼が朝一に出ること
//    ・タスクが多すぎる日は「今日やらない」を作ること
//    ・予定と実績がたまり、クセを分析できること
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseTasks, parseLine } from '../lib/secretary/parse.js';
import { classify, enrich } from '../lib/secretary/classify.js';
import { buildDailyPlan, toRecord } from '../lib/secretary/index.js';
import { formatPlan, formatReview } from '../lib/secretary/format.js';
import { loadProfile, loadRules, toMin } from '../lib/secretary/config.js';
import { savePlan, loadPlan, markStatus, carryOver, analyze, planPath } from '../lib/secretary/store.js';

const RULES = loadRules();
const PROFILE = loadProfile();
const DATE = '2026-09-08';

function plan(lines, opt = {}) {
  return buildDailyPlan(lines.join('\n'), { date: DATE, ...opt });
}
function entriesOf(p) {
  return p.schedule.timeline.filter((e) => e.kind === 'task');
}
function findEntry(p, title) {
  return entriesOf(p).find((e) => e.task.title.includes(title));
}

test('指定された例が6カテゴリへ正しく分類される', () => {
  const cases = {
    THINK: ['新商品リサーチ', '競合分析', '広告分析', '数字分析', '戦略立案', '新規事業検討'],
    IMPROVE: ['LP改良', 'Meta広告改良', '広告クリエイティブ改善', 'ワークフロー設計', '求人ページ作成', '資料作成'],
    DELEGATE: ['画像作成依頼', '担当者への情報共有', '確認依頼', '部下へのタスク振り', '通関依頼'],
    MEETING: ['部署MTG', '進捗確認', '相談', 'フィードバック', '打ち合わせ'],
    MANAGEMENT: ['在庫確認', '再注文', '納期確認', '支払い確認', '広告数値確認', '売上確認', '物流確認', '経費算出'],
    ADMIN: ['印鑑証明', '社会保険', 'ビザ', '申請', 'メール返信', 'LINE返信', '書類確認'],
  };
  for (const [category, titles] of Object.entries(cases)) {
    for (const title of titles) {
      assert.equal(classify({ title }, RULES).category, category, `「${title}」は ${category} のはず`);
    }
  }
});

test('#タグを書けば自動判定より手入力を優先する', () => {
  const t = parseLine('・在庫確認 #THINK');
  assert.equal(classify(t, RULES).category, 'THINK');
});

test('所要時間・時刻・依頼先・緊急度・締切を読み取る', () => {
  const [a, b, c] = parseTasks(['・LP改修 90分 !!', '- 13:00-14:00 部署MTG', '1. 画像作成依頼 @佐藤 〆9/10'].join('\n'));
  assert.equal(a.minutes, 90);
  assert.equal(a.urgencyMark, 2);
  assert.deepEqual(b.fixed, { start: '13:00', end: '14:00' });
  assert.equal(c.assignee, '佐藤');
  assert.equal(c.deadline, '09-10');
  // 見出し・区切り線はタスクとして拾わない
  assert.equal(parseTasks('━━━━\n## 午前\n【重要】\nやること:').length, 0);
});

test('会議は時刻から所要時間を逆算する', () => {
  const t = enrich(parseLine('15:00-15:45 進捗確認'), RULES, PROFILE, DATE);
  assert.equal(t.minutes, 45);
});

test('15時以降にTHINKを置かない（判断が要る仕事も16時で終わり）', () => {
  const p = plan(Array.from({ length: 8 }, (_, i) => `・競合分析その${i + 1} 60分`));
  const cutoff = toMin(PROFILE.rules.think_cutoff);
  for (const e of entriesOf(p)) {
    if (e.task.category === 'THINK') assert.ok(e.start < cutoff, `THINKが${e.start}分（15時以降）に置かれている`);
    if (e.task.focus >= PROFILE.rules.judgement_focus) {
      assert.ok(e.start < toMin(PROFILE.rules.judgement_cutoff), '判断が要る仕事が16時以降にある');
    }
  }
});

test('昼食・昼寝・15時前の休憩は必ず残る', () => {
  const p = plan(Array.from({ length: 20 }, (_, i) => `・在庫確認その${i + 1} 30分`));
  const fixed = p.schedule.timeline.filter((e) => e.kind === 'fixed').map((e) => `${e.start}-${e.end}`);
  assert.ok(fixed.includes(`${toMin('12:00')}-${toMin('12:40')}`), '昼食が消えている');
  assert.ok(fixed.includes(`${toMin('12:40')}-${toMin('13:00')}`), '昼寝が消えている');
  assert.ok(fixed.includes(`${toMin('14:30')}-${toMin('14:45')}`), '午後の休憩が消えている');
  for (const e of entriesOf(p)) {
    assert.ok(!(e.start < toMin('13:00') && e.end > toMin('12:00')), '昼休みにタスクが入っている');
  }
});

test('会議が続くときは間に休憩が入る', () => {
  const p = plan(['・A社と打ち合わせ 50分', '・B部署MTG 50分', '・C社と商談 30分']);
  const breaks = p.schedule.timeline.filter((e) => e.kind === 'break');
  assert.ok(breaks.length >= 1, '連続する会議の間に休憩がない');
  assert.ok(breaks[0].end - breaks[0].start >= 5);
});

test('他人を止めている短い依頼は朝一（午前の早い時間）に出る', () => {
  const p = plan(['・競合分析 120分', '・画像作成依頼 10分', '・通関依頼 10分', '・メール返信']);
  const e = findEntry(p, '画像作成依頼');
  assert.ok(e, '依頼がスケジュールに入っていない');
  assert.ok(e.start <= toMin('07:00'), '朝一の依頼枠に入っていない');
  assert.ok(p.morningDelegate.some((t) => t.title.includes('通関依頼')), '朝一で振る仕事に出ていない');
  assert.ok(p.morningDelegate[0].delegateTo, '依頼先の候補が出ていない');
});

test('ADMINは16時以降、THINKは午前に置かれる', () => {
  const p = plan(['・新商品リサーチ 60分', '・メール返信 30分', '・印鑑証明の申請 15分']);
  assert.ok(findEntry(p, '新商品リサーチ').start < toMin('11:00'));
  for (const title of ['メール返信', '印鑑証明']) {
    assert.ok(findEntry(p, title).start >= toMin('16:00'), `${title}が16時より前にある`);
  }
});

test('今日絶対終わらせる3つは3件・雑務や決まっている会議は入らない', () => {
  const p = plan([
    '・楽天のLP改修 90分', '・新商品リサーチ 60分', '・広告クリエイティブ改善 60分',
    '・13:00-14:00 部署MTG', '・画像作成依頼 10分', '・メール返信 15分',
  ]);
  assert.equal(p.mustDo.length, 3);
  assert.ok(p.mustDo.every((t) => t.why && t.why.length > 5), '理由が書かれていない');
  assert.ok(!p.mustDo.some((t) => t.fixed?.start), '時間が決まっている会議が3つに入っている');
  assert.ok(!p.mustDo.some((t) => t.quickWin), '5〜10分の依頼が3つに入っている');
});

test('タスクが多すぎる日は「今日やらない」を作り、理由と推奨時間を出す', () => {
  const many = Array.from({ length: 18 }, (_, i) => `・競合分析その${i + 1} 60分`);
  const p = plan(many);
  assert.ok(p.deferred.length > 0, '容量を超えているのに全部今日やろうとしている');
  assert.ok(p.deferred.every((t) => t.deferReason && t.recommend), '後回しの理由か推奨時間がない');
  assert.ok(p.plannedMinutes <= p.capacity + 60, '作業可能時間を大きく超えている');
  assert.ok(p.advice.some((a) => a.includes('多すぎます') || a.includes('回しました')), '指摘が出ていない');
});

test('長い仕事は「入る枠が無いときだけ」前半・後半に割る', () => {
  const p = plan(['・楽天のLP改修 90分', '・広告クリエイティブ改善 60分', '・新商品リサーチ 60分']);
  const lp = entriesOf(p).filter((e) => e.task.title.includes('LP改修'));
  assert.equal(lp.length, 1, '余裕があるのに細切れにしている');
  assert.equal(lp[0].end - lp[0].start, 90);
});

test('分類できない仕事は仮置きして、指摘で知らせる', () => {
  const p = plan(['・あれの件をなんとかする']);
  assert.equal(p.today[0].category, RULES.fallback);
  assert.ok(p.advice.some((a) => a.includes('分類が曖昧')), '曖昧なタスクを黙って処理している');
});

test('THINKがゼロの日は指摘する', () => {
  const p = plan(['・在庫確認', '・メール返信', '・支払い確認']);
  assert.ok(p.advice.some((a) => a.includes('THINK')), '午前が事務で埋まっていることを指摘していない');
});

test('自分でやらなくてよい仕事を名指しで指摘する', () => {
  const p = plan(['・経費算出（8月分） 40分']);
  assert.ok(p.advice.some((a) => a.includes('経理担当')), '委任候補が出ていない');
});

test('出力に指定された6つの見出しがすべて含まれる', () => {
  const text = formatPlan(plan(['・新商品リサーチ 60分', '・画像作成依頼 10分', '・メール返信']));
  for (const h of ['🔥 今日絶対終わらせる3つ', '📤 朝一で人に振る仕事', '🗓 今日のスケジュール', '📋 タスク仕分け', '⏭ 今日やらなくていい仕事', '⚠️ 秘書からの指摘']) {
    assert.ok(text.includes(h), `見出し「${h}」が無い`);
  }
  assert.ok(text.includes('05:00　起床'));
});

test('予定と実績がたまり、持ち越しとクセの分析ができる', (t) => {
  const d1 = '2999-01-01';
  const d2 = '2999-01-02';
  t.after(() => { for (const d of [d1, d2]) fs.rmSync(planPath(d), { force: true }); });

  const p1 = toRecord(buildDailyPlan(['・楽天のLP改修 60分', '・メール返信 15分'].join('\n'), { date: d1 }));
  savePlan(p1);
  assert.ok(loadPlan(d1), '保存できていない');

  const done = markStatus(d1, 'LP改修', 'done', 120);
  assert.ok(done.ok);
  assert.equal(loadPlan(d1).tasks.find((x) => x.title.includes('LP改修')).minutes_actual, 120);

  // 終わらなかった仕事は翌日に持ち越される
  const carry = carryOver(d2);
  assert.ok(carry.some((c) => c.title.includes('メール返信')), '未完了が持ち越されていない');
  const p2 = buildDailyPlan('・在庫確認', { date: d2, carry });
  assert.ok(p2.today.some((x) => x.title.includes('メール返信')), '持ち越しが翌日の予定に入っていない');
  savePlan(toRecord(p2));

  const stats = analyze(2);   // 直近2ファイル＝このテストで作った2日分だけを見る
  const improve = stats.estimate.find((c) => c.category === 'IMPROVE');
  assert.equal(improve.ratio, 2, '見積もりの2倍かかったことが出ていない');
  assert.ok(stats.periods.length > 0);
  assert.ok(formatReview(stats).includes('見積もりのクセ'));
});
