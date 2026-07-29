// ============================================================
//  レビュー返信下書きのテスト
// ------------------------------------------------------------
//  お客様に出す文面なので、ここは特に厳しく検証します。
//  「人の確認が必要なものを見逃さないこと」が最重要です。
// ============================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadBlocks,
  checkEscalation,
  assembleReply,
  auditReply,
  formatForCs,
  csHeader,
  isSuitcaseReview,
} from '../lib/replyDraft.js';
import { htmlToLines, parseReviews, reviewKey } from '../lib/rakutenReviews.js';

const cfg = loadBlocks();

const AI_OK = {
  body: 'キャスターの静音性についてお褒めいただき、大変光栄です。',
  apology: '',
  needs_human: false,
  reason: '',
  topics: ['キャスター'],
};

describe('人の確認が必要かの判定', () => {
  test('星3以下は必ず要確認にする', () => {
    for (const star of [1, 2, 3]) {
      const r = checkEscalation({ star, body: '普通です' }, cfg);
      assert.equal(r.needed, true, `★${star} が要確認になっていない`);
    }
  });

  test('星4・5で問題が無ければ要確認にしない', () => {
    assert.equal(checkEscalation({ star: 5, body: 'とても良かったです' }, cfg).needed, false);
    assert.equal(checkEscalation({ star: 4, body: '満足しています' }, cfg).needed, false);
  });

  test('安全に関わる語は星5でも要確認にする', () => {
    for (const w of ['発煙', '煙', '感電', 'やけど', 'けが']) {
      const r = checkEscalation({ star: 5, body: `使っていたら${w}がありました` }, cfg);
      assert.equal(r.needed, true, `「${w}」を含むのに要確認になっていない`);
    }
  });

  test('不良・返金・クレームの語も拾う', () => {
    for (const w of ['初期不良', '返金', '返品', '故障', 'クレーム', '詐欺']) {
      assert.equal(
        checkEscalation({ star: 5, body: `${w}の件です` }, cfg).needed,
        true,
        `「${w}」を拾えていない`
      );
    }
  });

  test('理由を必ず添える（担当者が判断できるように）', () => {
    const r = checkEscalation({ star: 1, body: '発煙しました' }, cfg);
    assert.ok(r.reasons.length >= 2);
    assert.ok(r.reasons.some((x) => x.includes('★1')));
    assert.ok(r.reasons.some((x) => x.includes('発煙')));
  });
});

describe('返信文の組み立て', () => {
  const review = { star: 5, date: '2026/07/29', who: 'テストさん', body: 'キャスターが静かで満足です。' };

  test('挨拶と結びの固定文が入る', () => {
    const r = assembleReply(AI_OK, review, cfg);
    assert.ok(r.text.startsWith(cfg.blocks.greeting));
    assert.ok(r.text.endsWith(cfg.blocks.closing[cfg.blocks.closing.length - 1]));
  });

  test('AIが書いた個別部分が挟まる', () => {
    assert.ok(assembleReply(AI_OK, review, cfg).text.includes(AI_OK.body));
  });

  test('挨拶が二重にならない', () => {
    const text = assembleReply(AI_OK, review, cfg).text;
    const n = text.split(cfg.blocks.greeting).length - 1;
    assert.equal(n, 1, '挨拶が複数回入っている');
  });

  test('長いレビューには詳細版の感謝、短いレビューには簡潔版を使う', () => {
    const long = { ...review, body: 'あ'.repeat(200) };
    assert.ok(assembleReply(AI_OK, long, cfg).text.includes(cfg.blocks.thanks_detailed));
    assert.ok(assembleReply(AI_OK, review, cfg).text.includes(cfg.blocks.thanks_short));
  });

  test('不満があるときだけ謝罪文を入れる', () => {
    const withApology = { ...AI_OK, apology: 'ご期待に沿えず申し訳ございません。' };
    assert.ok(assembleReply(withApology, review, cfg).text.includes('申し訳ございません'));
    assert.ok(!assembleReply(AI_OK, review, cfg).text.includes('申し訳ございません'));
  });

  test('AIが要確認と言わなくても、コード側の条件で要確認になる（回帰テスト）', () => {
    // AIが星1を見落として needs_human=false を返した場合でも止める
    const r = assembleReply({ ...AI_OK, needs_human: false }, { ...review, star: 1 }, cfg);
    assert.equal(r.needsHuman, true, 'AIの判断だけを信じてしまっている');
    assert.ok(r.reasons.some((x) => x.includes('★1')));
  });

  test('AIが要確認と言えば、星5でも要確認にする', () => {
    const r = assembleReply({ ...AI_OK, needs_human: true, reason: '法的な話題' }, review, cfg);
    assert.equal(r.needsHuman, true);
    assert.ok(r.reasons.includes('法的な話題'));
  });

  test('AIの出力が壊れていても落ちない', () => {
    assert.doesNotThrow(() => assembleReply(null, review, cfg));
    assert.doesNotThrow(() => assembleReply({}, review, cfg));
    const r = assembleReply({}, review, cfg);
    assert.ok(r.text.includes(cfg.blocks.greeting), '固定文だけでも成立していない');
  });

  test('話題は最大3つに絞る', () => {
    const many = { ...AI_OK, topics: ['a', 'b', 'c', 'd', 'e'] };
    assert.equal(assembleReply(many, review, cfg).topics.length, 3);
  });
});

describe('結びと感謝文の出し分け', () => {
  const ai = { body: 'テスト本文。', apology: '', needs_human: false, reason: '', topics: [] };

  test('スーツケースの話なら「弊社キャリーケースを」で結ぶ', () => {
    const r = { star: 5, body: 'キャスターが静かで満足です。旅行が楽しみ。' };
    assert.equal(isSuitcaseReview(r, cfg), true);
    assert.ok(assembleReply(ai, r, cfg).text.includes(cfg.blocks.closing_suitcase));
  });

  test('ファンなど他の商品なら「弊社商品を」で結ぶ（回帰テスト）', () => {
    // 「キャリーケースを使ってください」はファン購入者に噛み合わない
    const r = { star: 5, body: '季節商品なので暑い夏を乗り切るのに使用したい。' };
    assert.equal(isSuitcaseReview(r, cfg), false);
    const text = assembleReply(ai, r, cfg).text;
    assert.ok(text.includes(cfg.blocks.closing_general));
    assert.ok(!text.includes(cfg.blocks.closing_suitcase), 'ファンにキャリーケースの結びを使っている');
  });

  test('商品が判断できないときは無難な方を使う', () => {
    const r = { star: 5, body: 'ありがとうございました。' };
    assert.ok(assembleReply(ai, r, cfg).text.includes(cfg.blocks.closing_general));
  });

  test('謝罪があるときは「嬉しく思います」と言わない（回帰テスト）', () => {
    // 不満のレビューに「嬉しく思います」と返すのは失礼
    const withApology = { ...ai, apology: 'ご不快な思いをおかけし申し訳ございません。' };
    const text = assembleReply(withApology, { star: 3, body: '外箱が傷んでいた' }, cfg).text;
    assert.ok(text.includes(cfg.blocks.thanks_feedback));
    assert.ok(!text.includes(cfg.blocks.thanks_short), '謝罪文なのに「嬉しく思います」が入っている');
    assert.ok(!text.includes(cfg.blocks.thanks_detailed));
  });

  test('謝罪が無いときは通常の感謝文に戻る', () => {
    const text = assembleReply(ai, { star: 5, body: '良かったです' }, cfg).text;
    assert.ok(text.includes(cfg.blocks.thanks_short));
    assert.ok(!text.includes(cfg.blocks.thanks_feedback));
  });
});

describe('出来上がった文面の点検', () => {
  test('送料を無料と書いていたら指摘する（実際はお客様負担）', () => {
    const p = auditReply('保証の際は送料無料で対応いたします。');
    assert.ok(p.some((x) => x.includes('送料')));
  });

  test('返金・交換の確約を指摘する', () => {
    assert.ok(auditReply('すぐに返金いたします。').length > 0);
    assert.ok(auditReply('新品と交換いたします。').length > 0);
  });

  test('断定的な表現を指摘する', () => {
    assert.ok(auditReply('必ず解決いたします。').some((x) => x.includes('断定')));
  });

  test('納期の約束を指摘する', () => {
    assert.ok(auditReply('3営業日以内にお届けします。').some((x) => x.includes('納期')));
  });

  test('問題の無い文面では何も指摘しない', () => {
    const text = assembleReply(AI_OK, { star: 5, body: '良い' }, cfg).text;
    assert.deepEqual(auditReply(text), []);
  });

  test('実際の運用文（永久保証の説明）は指摘されない', () => {
    const real =
      '永久保証に関しまして、商品ページの永久保証の欄にも記載しております通り、' +
      '部品代につきましては無償で対応させていただいておりますが、' +
      '恐れ入りますが送料のみお客様のご負担をお願いしております。';
    assert.deepEqual(auditReply(real), [], '正しい説明を誤って指摘している');
  });
});

describe('CS向けの表示', () => {
  const review = { star: 2, date: '2026/07/29', who: 'テストさん', body: '不良品が届きました。' };
  const item = { review, ...assembleReply(AI_OK, review, cfg), audit: [] };

  test('要確認は「そのまま貼らないでください」と明示する', () => {
    const t = formatForCs(item);
    assert.match(t, /🔴/);
    assert.match(t, /そのまま貼らないでください/);
  });

  test('そのまま使えるものは「コピーして貼ってください」と書く', () => {
    const okReview = { star: 5, date: '2026/07/29', who: 'テストさん', body: '良い' };
    const ok = { review: okReview, ...assembleReply(AI_OK, okReview, cfg), audit: [] };
    const t = formatForCs(ok);
    assert.match(t, /🟢/);
    assert.match(t, /そのままコピーして貼ってください/);
    assert.ok(!t.includes('🔴'), '安全なものに赤印が付いている');
  });

  test('お客様のレビューと下書きの両方を載せる', () => {
    const t = formatForCs(item);
    assert.match(t, /▼ お客様のレビュー/);
    assert.match(t, /▼ 返信の下書き/);
    assert.match(t, /不良品が届きました/);
  });

  test('コピーする範囲を記号ではっきり示す', () => {
    const t = formatForCs(item);
    const marks = t.split('- - - - - - - - - -').length - 1;
    assert.equal(marks, 2, 'コピー範囲の区切りが上下に無い');
    assert.match(t, /ここまで .*をコピー/);
  });

  test('連番を付けて進捗が分かるようにする', () => {
    assert.match(formatForCs(item, { index: 3, total: 8 }), /【3\/8】/);
  });

  test('点検で引っかかった点も隠さず載せる', () => {
    const t = formatForCs({ ...item, audit: ['送料の記載が誤っています'] });
    assert.match(t, /自動点検で引っかかりました/);
    assert.match(t, /送料の記載が誤っています/);
  });

  test('見出しに作業手順と内訳を書く', () => {
    const h = csHeader({ date: '2026/7/29', total: 8, needHuman: 2, flagged: 1 });
    assert.match(h, /全8件/);
    assert.match(h, /そのまま貼れる: 6件/);
    assert.match(h, /社員の確認が必要: 2件/);
    assert.match(h, /作業手順/);
    assert.match(h, /レビューチェックツール/);
    assert.match(h, /迷ったら投稿しないでください/);
  });

  test('指摘が0件なら、その行は出さない', () => {
    assert.ok(!csHeader({ date: 'x', total: 3, needHuman: 0, flagged: 0 }).includes('自動点検で指摘あり'));
  });
});

describe('レビューページの読み取り', () => {
  // 実際のページと同じ並び（★ / 日付 / 氏名 / 本文）
  const html = `
    <div>5</div><div>2026/07/29</div><div>ポンコナンさん</div>
    <div>女性</div><div>40代</div>
    <div>梱包も綺麗でした。ありがとうございます。</div>
    <div>さらに表示</div><div>注文日：2026/07/25</div>
    <div>参考になった</div><div>不適切レビュー報告</div>
    <div>3</div><div>2026/07/28</div><div>購入者さん</div>
    <div>外箱の傷みは避けて欲しいところです。</div>
    <div>ショップからのコメント</div>
    <div>2026/07/29</div><div>ご意見ありがとうございます。</div>
  `;
  const rows = parseReviews(htmlToLines(html));

  test('レビューを件数どおりに切り出す', () => {
    assert.equal(rows.length, 2);
  });

  test('星・日付・投稿者を取る', () => {
    assert.equal(rows[0].star, 5);
    assert.equal(rows[0].date, '2026/07/29');
    assert.equal(rows[0].who, 'ポンコナンさん');
  });

  test('本文を取る', () => {
    assert.match(rows[0].body, /梱包も綺麗でした/);
  });

  test('ボタン類（さらに表示・注文日）を本文に混ぜない', () => {
    assert.ok(!rows[0].body.includes('さらに表示'));
    assert.ok(!rows[0].body.includes('注文日'));
  });

  test('ショップ返信済みかどうかを見分ける', () => {
    assert.equal(rows[0].shopReply, false);
    assert.equal(rows[1].shopReply, true);
  });

  test('返信済みレビューの本文に、返信文が混ざらない', () => {
    assert.ok(!rows[1].body.includes('ご意見ありがとうございます'));
  });

  test('同じレビューは同じキーになる（二重下書きの防止）', () => {
    assert.equal(reviewKey(rows[0]), reviewKey({ ...rows[0] }));
    assert.notEqual(reviewKey(rows[0]), reviewKey(rows[1]));
  });

  test('空のHTMLでも落ちない', () => {
    assert.deepEqual(parseReviews(htmlToLines('<div></div>')), []);
  });
});
