// ============================================================
//  AI経営チームのテスト（ネットワーク不要）
// ------------------------------------------------------------
//  AIの応答は差し替え可能にしてあるので、
//  「どの部署にどのデータが渡るか」「1つ落ちても続くか」を検証できます。
// ============================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEPARTMENTS,
  buildBriefings,
  pickImportant,
  runTeam,
  formatBoardBrief,
  readTeamPrompt,
} from '../lib/aiTeam.js';

const FULL = {
  date: '2026-07-28',
  sales: { 総売上: 2458383, 前日比: -10.1 },
  adCosts: { 合計: 36100 },
  marketing: { 楽天転換率: 1.51, 楽天アクセス: 28343 },
  products: Array.from({ length: 30 }, (_, i) => ({ 商品: `商品${i}`, 個数: 30 - i })),
  inventory: { スーツケースS: { CS倉庫: 40, Amazon倉庫: 3 } },
  stockoutSuspects: [{ 商品: 'クリップファン', 日数: 3 }],
  reports: [{ reporter: '山田', summary: '交換対応3件', urgent: false, urgent_reason: '' }],
  staffing: { 提出: 4, 対象: 6, 未提出: ['佐藤', '鈴木'] },
};

describe('部署への資料の割り振り', () => {
  test('データが揃っていれば全部署ぶん作る', () => {
    const b = buildBriefings(FULL);
    assert.deepEqual(Object.keys(b).sort(), ['finance', 'marketing', 'people', 'risk', 'supply']);
  });

  test('データが無い部署は作らない（＝動かさない）', () => {
    const b = buildBriefings({ date: '2026-07-28', sales: { 総売上: 100 } });
    assert.deepEqual(Object.keys(b), ['finance']);
  });

  test('中身が空のオブジェクトでは部署を起動しない', () => {
    assert.equal(buildBriefings({ sales: {} }).finance, undefined);
    assert.equal(buildBriefings({ sales: { 総売上: null } }).finance, undefined);
    assert.equal(buildBriefings({ reports: [] }).risk, undefined);
  });

  test('財務には売上と広告費だけを渡す（日報は渡さない）', () => {
    const f = buildBriefings(FULL).finance;
    assert.ok(f.売上);
    assert.ok(f.広告);
    assert.equal(JSON.stringify(f).includes('交換対応'), false, '日報が混ざっている');
  });

  test('マーケに渡す商品は上位12件までに絞る（費用と精度のため）', () => {
    assert.equal(buildBriefings(FULL).marketing.商品別.length, 12);
  });

  test('在庫アプリが無くても、欠品の疑いがあればSCMを動かす', () => {
    const b = buildBriefings({
      date: '2026-07-28',
      stockoutSuspects: [{ 商品: 'A', 日数: 2 }],
    });
    assert.ok(b.supply);
    assert.match(b.supply.在庫データの有無, /なし/);
  });

  test('在庫も欠品の疑いも無ければSCMは動かさない', () => {
    assert.equal(buildBriefings({ date: '2026-07-28', stockoutSuspects: [] }).supply, undefined);
  });

  test('リスク室には日報の緊急フラグが渡る', () => {
    const b = buildBriefings({
      reports: [{ reporter: '田中', summary: '発煙報告', urgent: true, urgent_reason: '発煙' }],
    });
    assert.equal(b.risk.日報の要約[0].緊急, true);
    assert.equal(b.risk.日報の要約[0].緊急理由, '発煙');
  });
});

describe('重要な指摘の抽出', () => {
  const results = {
    finance: { summary: 'x', findings: [
      { 重要度: '高', 指摘: '広告費増' }, { 重要度: '低', 指摘: '軽微' } ] },
    supply: { summary: 'y', findings: [{ 重要度: '中', 指摘: '欠品疑い' }] },
  };

  test('高と中だけを拾い、低は落とす', () => {
    const p = pickImportant(results);
    assert.equal(p.length, 2);
    assert.ok(!p.some((x) => x.重要度 === '低'));
  });

  test('どの部署の指摘かを付ける', () => {
    assert.equal(pickImportant(results)[0].部署, '財務部');
  });

  test('高を先に並べる', () => {
    assert.equal(pickImportant(results)[0].重要度, '高');
  });

  test('findings が無い部署は無視する', () => {
    assert.doesNotThrow(() => pickImportant({ a: null, b: { summary: 'z' } }));
    assert.equal(pickImportant({ a: null, b: { summary: 'z' } }).length, 0);
  });
});

describe('チームの実行', () => {
  /** 呼ばれたプロンプトを記録する差し替え関数 */
  function stub(behavior = {}) {
    const calls = [];
    const fn = async (system, payload) => {
      calls.push({ system, payload });
      for (const [needle, res] of Object.entries(behavior)) {
        if (system.includes(needle)) {
          if (res instanceof Error) throw res;
          return res;
        }
      }
      return { summary: 'ok', findings: [] };
    };
    return { fn, calls };
  }

  test('データのある部署の数だけ呼ばれる（＋経営企画＋統括）', async () => {
    const { fn, calls } = stub();
    const b = buildBriefings(FULL);
    await runTeam(b, { callJson: fn });
    assert.equal(calls.length, Object.keys(b).length + 2);
  });

  test('データが1部署ぶんしか無ければ、その部署しか呼ばない', async () => {
    const { fn, calls } = stub();
    await runTeam(buildBriefings({ sales: { 総売上: 100 } }), { callJson: fn });
    assert.equal(calls.length, 1 + 2);
  });

  test('1部署が落ちても、他の部署と統括は動く', async () => {
    const { fn } = stub({ '財務部': new Error('APIエラー') });
    const r = await runTeam(buildBriefings(FULL), { callJson: fn });
    assert.equal(r.departments.finance, undefined);
    assert.ok(r.departments.marketing, 'マーケが巻き添えで落ちている');
    assert.ok(r.chief, '統括が動いていない');
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /財務部/);
  });

  test('全部署が落ちたら統括は呼ばない（無意味な費用を避ける）', async () => {
    const calls = [];
    const fn = async (system) => { calls.push(system); throw new Error('全滅'); };
    const r = await runTeam(buildBriefings(FULL), { callJson: fn });
    assert.equal(r.chief, null);
    assert.equal(r.strategy, null);
    assert.equal(calls.length, Object.keys(buildBriefings(FULL)).length, '統括まで呼んでいる');
  });

  test('統括には各部署の要約と重要指摘だけを渡す（生データは渡さない）', async () => {
    const { fn, calls } = stub({
      '財務部': { summary: '売上は堅調', findings: [{ 重要度: '高', 指摘: '広告費増', 数字: 'x' }] },
    });
    await runTeam(buildBriefings(FULL), { callJson: fn });
    const chiefCall = calls.find((c) => c.system.includes('統括補佐'));
    const json = JSON.stringify(chiefCall.payload);
    assert.ok(json.includes('売上は堅調'));
    assert.ok(!json.includes('2458383'), '生の売上データが統括まで流れている');
  });

  test('callJson を渡さなければエラーにする', async () => {
    await assert.rejects(() => runTeam({}, {}), /callJson/);
  });
});

describe('プロンプトの体裁', () => {
  const files = [
    ...DEPARTMENTS.map((d) => d.prompt),
    '01-strategy.md', '00-chief-of-staff.md',
  ];

  for (const f of files) {
    test(`${f}: JSONのみ出力するよう明記している`, () => {
      const t = readTeamPrompt(f);
      assert.match(t, /JSONオブジェクトだけを出力/);
    });
  }

  for (const f of DEPARTMENTS.map((d) => d.prompt)) {
    test(`${f}: 指摘が無い場合の逃げ道がある`, () => {
      const t = readTeamPrompt(f);
      assert.ok(
        /findings": \[\]|特記事項なし/.test(t),
        '指摘が無いときに空を返してよいと書かれていない（無理に指摘を作らせてしまう）'
      );
    });
  }

  test('計算をAIにさせない方針が各部署に書かれている', () => {
    for (const d of DEPARTMENTS) {
      if (d.key === 'risk') continue; // リスク室は数値を扱わない
      const t = readTeamPrompt(d.prompt);
      assert.match(t, /計算し直さない/, `${d.prompt} に計算禁止の記載がない`);
    }
  });
});

describe('文面', () => {
  const result = {
    departments: { finance: { summary: 'a' }, supply: { summary: 'b' } },
    strategy: {
      headline: '欠品対応が最優先',
      今週: [{ 課題: 'クリップファン欠品', 根拠: '3日連続ゼロ', 打ち手: '至急発注', 期待効果: '機会損失の停止' }],
      今月: [], 監視: ['広告費率'],
    },
    chief: {
      today: '欠品が続いています。',
      判断が必要: [{ 件名: '発注可否', 内容: '在庫が尽きています', 部署: 'サプライチェーン部', 期限感: '今日' }],
      報告: [{ 件名: '売上', 内容: '前日比 -10%', 部署: '財務部' }],
      良い兆し: ['転換率が改善'],
    },
    errors: [],
  };

  test('主要な項目がすべて入る', () => {
    const t = formatBoardBrief(result, { date: '2026-07-28' });
    for (const s of ['判断が必要', '今週の打ち手', '報告', '良い兆し', '監視中']) {
      assert.ok(t.includes(s), `${s} がない`);
    }
    assert.match(t, /欠品が続いています/);
    assert.match(t, /至急発注/);
  });

  test('どの部署が動いたかを明示する', () => {
    assert.match(formatBoardBrief(result), /稼働した部署: 財務部 \/ サプライチェーン部/);
  });

  test('動かせなかった部署は隠さず載せる', () => {
    const t = formatBoardBrief({ ...result, errors: ['財務部: APIエラー'] });
    assert.match(t, /動かせなかった部署/);
    assert.match(t, /財務部: APIエラー/);
  });

  test('空の結果でも落ちない', () => {
    assert.doesNotThrow(() => formatBoardBrief({ departments: {}, strategy: null, chief: null, errors: [] }));
  });
});
