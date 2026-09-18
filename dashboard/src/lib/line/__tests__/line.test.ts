// LINE AI自動応答の検算: 署名検証・要対応判定・事実カードのプロンプト反映・AI失敗時の安全側動作
import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt, generateAnswer } from '../answer';
import { splitForLine } from '../client';
import { checkEscalation } from '../escalation';
import { loadKnowledge } from '../knowledge';
import { formatStaffNotice } from '../notify';
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

  it('返品・不良・安全語は要対応', () => {
    expect(checkEscalation('届いた商品が初期不良でした。返品したいです', k.always_human).needed).toBe(true);
    expect(checkEscalation('充電中に煙が出ました', k.always_human).needed).toBe(true);
    expect(checkEscalation('使っていてけがをしました', k.always_human).needed).toBe(true);
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

  it('AIの回答をそのまま返し、AI判断の要対応を尊重する', async () => {
    const client = fakeClient({ reply: 'Sサイズは機内持ち込み可能です。', needs_human: false, reason: '', topics: ['サイズ'] });
    const a = await generateAnswer('Sは機内持ち込みできますか', [], { client, knowledge: k });
    expect(a.source).toBe('ai');
    expect(a.reply).toBe('Sサイズは機内持ち込み可能です。');
    expect(a.needsHuman).toBe(false);
  });

  it('AIが要対応でなくても注意語があれば要対応にする', async () => {
    const client = fakeClient({ reply: 'ご案内します。', needs_human: false, reason: '', topics: [] });
    const a = await generateAnswer('返金してほしい', [], { client, knowledge: k });
    expect(a.needsHuman).toBe(true);
    expect(a.reason).toContain('注意語');
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

  it('スタッフ通知にお客様の発言・AI回答・理由が入る', () => {
    const s = formatStaffNotice({ lineUserId: 'Uxxx', userText: '返品したい', reply: '担当が確認します', reason: '注意語: 返品' });
    expect(s).toContain('返品したい');
    expect(s).toContain('担当が確認します');
    expect(s).toContain('注意語: 返品');
  });
});
