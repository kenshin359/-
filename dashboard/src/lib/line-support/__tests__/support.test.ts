// LINE AI自動応答の検算: 署名検証・要対応判定・事実カードのプロンプト反映・AI失敗時の安全側動作
import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt, generateAnswer } from '../answer';
import { DEFAULT_CATEGORIES } from '../categories';
import { splitForLine } from '../client';
import { checkEscalation } from '../escalation';
import { loadKnowledge } from '../knowledge';
import { GROUP_HELP, parseGroupCommand } from '../groupCommands';
import { formatStaffNotice } from '../notify';
import { DEFAULT_POLICY, decideAction } from '../policy';
import { computeLineSignature, verifyLineSignature } from '../signature';

describe('署名検証', () => {
  const secret = 'test-secret';
  const body = '{"events":[]}';

  it('正しい署名を受け入れる', () => {
    const sig = computeLineSignature(secret, body);
    expect(verifyLineSignature(secret, body, sig)).toBe(true);
  });

  it('本文が1文字でも違えば拒否する', () => {
    const sig = computeLineSignature(secret, body);
    expect(verifyLineSignature(secret, body + ' ', sig)).toBe(false);
  });

  it('署名なし・秘密なしは拒否する', () => {
    expect(verifyLineSignature(secret, body, null)).toBe(false);
    expect(verifyLineSignature('', body, computeLineSignature(secret, body))).toBe(false);
  });
});

describe('要対応判定（コード側の二重チェック）', () => {
  const k = loadKnowledge();

  it('返品・不良は要対応（承認以上）、安全語は必ず有人', () => {
    const r1 = checkEscalation('届いた商品が初期不良でした。返品したいです', k.always_human);
    expect(r1.needed).toBe(true);
    expect(r1.human).toBe(false);
    expect(checkEscalation('充電中に煙が出ました', k.always_human).human).toBe(true);
    expect(checkEscalation('使っていてけがをしました', k.always_human).human).toBe(true);
    expect(checkEscalation('弁護士に相談します', k.always_human).human).toBe(true);
  });

  it('通常の質問は要対応にしない', () => {
    expect(checkEscalation('Sサイズは機内持ち込みできますか？', k.always_human).needed).toBe(false);
    expect(checkEscalation('軽いだけが取り柄ですか', k.always_human).needed).toBe(false);
  });
});

describe('事実カード→システムプロンプト', () => {
  const k = loadKnowledge();
  const prompt = buildSystemPrompt(k);

  it('事実カードの内容がすべて含まれる', () => {
    for (const [key, v] of Object.entries(k.facts)) {
      expect(prompt).toContain(key);
      expect(prompt).toContain(v);
    }
  });

  it('答えてはいけない項目（要データ）が列挙される', () => {
    for (const key of Object.keys(k.unknown)) expect(prompt).toContain(key);
  });

  it('説明用の _ キーはプロンプトに混ざらない', () => {
    expect(Object.keys(k.facts).some((x) => x.startsWith('_'))).toBe(false);
    expect(Object.keys(k.unknown).some((x) => x.startsWith('_'))).toBe(false);
  });
});

describe('generateAnswer', () => {
  const k = loadKnowledge();

  function fakeClient(parsed: unknown, stop: string = 'end_turn'): Anthropic {
    return {
      messages: {
        parse: async () => ({ stop_reason: stop, parsed_output: parsed }),
      },
    } as unknown as Anthropic;
  }

  const base = { category: 'product_spec', level: 1, confidence: 92, kb_refs: ['サイズ'], missing_info: [], needs_human: false, reason: '事実カードのサイズ項目で回答', topics: ['サイズ'] };

  it('AIの分類・確信度・根拠をそのまま返し、AI判断の要対応を尊重する', async () => {
    const client = fakeClient({ ...base, reply: 'Sサイズは機内持ち込み可能です。' });
    const a = await generateAnswer('Sは機内持ち込みできますか', [], { client, knowledge: k });
    expect(a.source).toBe('ai');
    expect(a.reply).toBe('Sサイズは機内持ち込み可能です。');
    expect(a.categoryCode).toBe('product_spec');
    expect(a.level).toBe(1);
    expect(a.confidence).toBe(92);
    expect(a.kbRefs).toEqual(['サイズ']);
    expect(a.needsHuman).toBe(false);
  });

  it('AIが要対応でなくても注意語があれば要対応にする（レベルはカテゴリ既定との厳しい方）', async () => {
    const client = fakeClient({ ...base, category: 'return', reply: 'ご案内します。' });
    const a = await generateAnswer('返金してほしい', [], { client, knowledge: k });
    expect(a.needsHuman).toBe(true);
    expect(a.reason).toContain('注意語');
    expect(a.level).toBe(2);
  });

  it('安全語があればAIの判定に関わらずレベル3・必ず有人', async () => {
    const client = fakeClient({ ...base, reply: 'ご案内します。' });
    const a = await generateAnswer('充電中に煙が出ました', [], { client, knowledge: k });
    expect(a.humanRule).toBe(true);
    expect(a.level).toBe(3);
  });

  it('未知のカテゴリコードは other に、事実カードに無い根拠は除外', async () => {
    const client = fakeClient({ ...base, category: 'nope', kb_refs: ['サイズ', '存在しない'], reply: 'x' });
    const a = await generateAnswer('こんにちは', [], { client, knowledge: k });
    expect(a.categoryCode).toBe('other');
    expect(a.kbRefs).toEqual(['サイズ']);
  });

  it('APIエラー時は固定の案内文にして要対応（成功と偽らない）', async () => {
    const client = {
      messages: {
        parse: async () => {
          throw new Error('boom');
        },
      },
    } as unknown as Anthropic;
    const a = await generateAnswer('こんにちは', [], { client, knowledge: k });
    expect(a.source).toBe('fallback');
    expect(a.reply).toBe(k.bot.fallback);
    expect(a.needsHuman).toBe(true);
  });

  it('APIキー未設定なら呼び出さずに固定の案内文', async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const a = await generateAnswer('こんにちは', [], { knowledge: k });
      expect(a.source).toBe('fallback');
      expect(a.reason).toContain('ANTHROPIC_API_KEY');
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });
});

describe('LINEの文字数制限と通知文', () => {
  it('長文は4800字以内・最大5吹き出しに分割する', () => {
    const text = Array.from({ length: 30 }, (_, i) => `段落${i} ` + 'あ'.repeat(1000)).join('\n');
    const parts = splitForLine(text);
    expect(parts.length).toBeLessThanOrEqual(5);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(4800);
  });

  it('承認待ちの通知には回答案・分類・根拠と「#番号 送信」の案内が入る', () => {
    const s = formatStaffNotice({ caseNo: 7, lineUserId: 'U', userText: 'Mの容量は？', reply: '受付しました', reason: 'r', classification: '商品仕様（L1・確信度90）', draft: 'Mサイズは…', kbRefs: ['サイズ'] });
    expect(s).toContain('【LINE #7 回答案】');
    expect(s).toContain('商品仕様（L1・確信度90）');
    expect(s).toContain('Mサイズは…');
    expect(s).toContain('根拠: サイズ');
    expect(s).toContain('「#7 送信」');
  });

  it('スタッフ通知に案件番号・お客様の発言・AI回答・理由・返信方法が入る', () => {
    const s = formatStaffNotice({ caseNo: 12, lineUserId: 'Uxxx', userText: '返品したい', reply: '担当が確認します', reason: '注意語: 返品' });
    expect(s).toContain('#12');
    expect(s).toContain('返品したい');
    expect(s).toContain('担当が確認します');
    expect(s).toContain('注意語: 返品');
    expect(s).toContain('「#12 返信文」');
    expect(s).toContain('完了 #12');
  });

  it('進行中案件への追加メッセージは「追加」と分かる文面でAI回答を含まない', () => {
    const s = formatStaffNotice({ caseNo: 3, lineUserId: 'U', userText: '注文番号は123です', reply: null, reason: '', followUp: true });
    expect(s).toContain('#3 追加メッセージ');
    expect(s).toContain('注文番号は123です');
    expect(s).not.toContain('AIが送った一次回答');
  });
});

describe('スタッフグループのコマンド解釈', () => {
  it('「#番号 返信文」を返信コマンドにする（全角#・全角数字・改行込みも可）', () => {
    expect(parseGroupCommand('#12 ご注文を確認しました。明日発送します')).toEqual({ kind: 'reply', no: 12, text: 'ご注文を確認しました。明日発送します' });
    expect(parseGroupCommand('＃１２　ありがとうございます')).toEqual({ kind: 'reply', no: 12, text: 'ありがとうございます' });
    expect(parseGroupCommand('#5\n1行目\n2行目')).toEqual({ kind: 'reply', no: 5, text: '1行目\n2行目' });
  });

  it('「#番号 送信」は承認コマンド', () => {
    expect(parseGroupCommand('#12 送信')).toEqual({ kind: 'approve', no: 12 });
    expect(parseGroupCommand('#12送信')).toEqual({ kind: 'approve', no: 12 });
    expect(parseGroupCommand('#12 OK')).toEqual({ kind: 'approve', no: 12 });
    expect(parseGroupCommand('#12 送信します')).toEqual({ kind: 'reply', no: 12, text: '送信します' });
  });

  it('完了・一覧・登録・ヘルプ', () => {
    expect(parseGroupCommand('完了 #12')).toEqual({ kind: 'close', no: 12 });
    expect(parseGroupCommand('完了12')).toEqual({ kind: 'close', no: 12 });
    expect(parseGroupCommand('#12 完了')).toEqual({ kind: 'close', no: 12 });
    expect(parseGroupCommand('一覧')).toEqual({ kind: 'list' });
    expect(parseGroupCommand('スタッフ登録')).toEqual({ kind: 'register' });
    expect(parseGroupCommand('ヘルプ')).toEqual({ kind: 'help' });
  });

  it('雑談やコマンドでない文には反応しない', () => {
    expect(parseGroupCommand('今日の売上どうでした？')).toEqual({ kind: 'none' });
    expect(parseGroupCommand('#12')).toEqual({ kind: 'none' });
    expect(parseGroupCommand('')).toEqual({ kind: 'none' });
    expect(parseGroupCommand('案件#12は対応済みです')).toEqual({ kind: 'none' });
  });

  it('ヘルプに主要コマンドが載っている', () => {
    expect(GROUP_HELP).toContain('#番号 返信文');
    expect(GROUP_HELP).toContain('完了 #番号');
    expect(GROUP_HELP).toContain('一覧');
  });
});

describe('運用モードと行動の決定', () => {
  const policy = DEFAULT_POLICY;
  it('Phase 1（APPROVAL）では条件を満たしても承認に回す', () => {
    expect(decideAction({ mode: 'APPROVAL', level: 1, confidence: 99, humanRule: false, kbRefs: ['サイズ'], policy })).toBe('approval');
  });
  it('AUTO はレベル1・確信度しきい値以上・根拠ありのときだけ自動返信', () => {
    expect(decideAction({ mode: 'AUTO', level: 1, confidence: 90, humanRule: false, kbRefs: ['サイズ'], policy })).toBe('auto_reply');
    expect(decideAction({ mode: 'AUTO', level: 1, confidence: 80, humanRule: false, kbRefs: ['サイズ'], policy })).toBe('approval');
    expect(decideAction({ mode: 'AUTO', level: 1, confidence: 95, humanRule: false, kbRefs: [], policy })).toBe('approval');
    expect(decideAction({ mode: 'AUTO', level: 2, confidence: 95, humanRule: false, kbRefs: ['サイズ'], policy })).toBe('approval');
  });
  it('HUMAN_ONLY・レベル3・安全語は有人', () => {
    expect(decideAction({ mode: 'HUMAN_ONLY', level: 1, confidence: 99, humanRule: false, kbRefs: ['サイズ'], policy })).toBe('human');
    expect(decideAction({ mode: 'AUTO', level: 3, confidence: 99, humanRule: false, kbRefs: ['サイズ'], policy })).toBe('human');
    expect(decideAction({ mode: 'AUTO', level: 1, confidence: 99, humanRule: true, kbRefs: ['サイズ'], policy })).toBe('human');
  });
  it('初期カテゴリは17種で、L3 は有人のみ・それ以外は承認', () => {
    expect(DEFAULT_CATEGORIES).toHaveLength(17);
    for (const c of DEFAULT_CATEGORIES) expect(c.mode).toBe(c.level === 3 ? 'HUMAN_ONLY' : 'APPROVAL');
    expect(buildSystemPrompt(loadKnowledge(), DEFAULT_CATEGORIES)).toContain('product_spec: 商品仕様');
  });
});
