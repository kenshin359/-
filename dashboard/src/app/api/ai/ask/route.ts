// AIアシスタント（PRO ⑦）の質問API。ログイン必須。会社の状態（ダッシュボードの取込値）を Claude に渡して回答を返す。
// ANTHROPIC_API_KEY が無いときは { status: 'unavailable' } を 200 で返す（「未接続」を成功と偽らない）。
// 機密（粗利）は管理職未満には渡さない（src/lib/ai/context.ts）。監査ログには質問の文字数だけ残し、本文は保存しない。
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canSeeCompanyWide, currentActor } from '@/lib/rbac';
import { jstDateKey } from '@/lib/metrics/format';
import { getCompanyOverview } from '@/lib/pro/overview';
import { listOpenAlerts } from '@/lib/pro/alerts';
import { listKpis } from '@/lib/pro/kpi';
import { listReports } from '@/lib/pro/reports';
import { getProductSalesMonth } from '@/lib/product-sales-data';
import { buildCompanyContext, buildSystemPrompt } from '@/lib/ai/context';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** 既定モデル: 最新の Sonnet 系（claude-api スキルのモデル表）。ANTHROPIC_MODEL で上書き可 */
const DEFAULT_MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 1024;
const TIMEOUT_MS = 25_000;
const UNAVAILABLE_REASON = '未接続（ANTHROPIC_API_KEY 未設定）';

const AskInput = z.object({
  question: z.string().trim().min(1, '質問を入力してください').max(1000, '質問は1000文字以内にしてください'),
});

function apiKey(): string {
  return (process.env.ANTHROPIC_API_KEY || '').trim();
}

function modelId(): string {
  return (process.env.ANTHROPIC_MODEL || '').trim() || DEFAULT_MODEL;
}

/** 接続状態の確認（パネルを開いたときに「未接続」を先に出すため） */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!apiKey()) return NextResponse.json({ status: 'unavailable', reason: UNAVAILABLE_REASON });
  return NextResponse.json({ status: 'ok', model: modelId() });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON本文が必要です' }, { status: 400 });
  }
  const parsed = AskInput.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '入力が不正です' }, { status: 400 });
  }
  const question = parsed.data.question;

  const key = apiKey();
  if (!key) return NextResponse.json({ status: 'unavailable', reason: UNAVAILABLE_REASON });

  // 会社の状態を集める（取れたものだけ渡す。1つ失敗しても他は渡す）
  const now = new Date();
  const today = jstDateKey(now);
  const month = today.slice(0, 7);
  const companyWide = canSeeCompanyWide(actor.level);
  const [overview, alerts, kpis, reports, products] = await Promise.all([
    getCompanyOverview(actor, now).catch(() => null),
    listOpenAlerts(actor, now).catch(() => null),
    listKpis(now).catch(() => null),
    listReports(companyWide ? {} : { visibleAuthorId: actor.id, visibleTeamCode: actor.teamCode }).catch(() => null),
    getProductSalesMonth(month)
      .then((r) => r.matrix.lines)
      .catch(() => null),
  ]);
  const context = buildCompanyContext({ actor: { name: actor.name, level: actor.level }, today, overview, alerts, kpis, reports, products });

  const model = modelId();
  const client = new Anthropic({ apiKey: key, timeout: TIMEOUT_MS, maxRetries: 0 });
  try {
    const res = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: buildSystemPrompt(context),
      // 短い質問応答なので思考は浅く（max_tokens 1024 を回答に残す）
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: question }],
    });
    await prisma.auditLog
      .create({ data: { userId: actor.id, action: 'ai.ask', detail: `chars=${question.length} model=${model}` } })
      .catch(() => undefined);

    if (res.stop_reason === 'refusal') {
      return NextResponse.json({ status: 'error', reason: 'AIが回答を辞退しました（安全上の理由）' });
    }
    const answer = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (!answer) {
      return NextResponse.json({
        status: 'error',
        reason: res.stop_reason === 'max_tokens' ? '回答が長すぎて途中で切れました。質問を絞ってください' : 'AIの回答が空でした',
      });
    }
    return NextResponse.json({ status: 'ok', answer, model, truncated: res.stop_reason === 'max_tokens' });
  } catch (e) {
    let reason: string;
    if (e instanceof Anthropic.AuthenticationError) reason = 'APIキーが無効です（ANTHROPIC_API_KEY を確認）';
    else if (e instanceof Anthropic.NotFoundError) reason = `モデル「${model}」が見つかりません（ANTHROPIC_MODEL を確認）`;
    else if (e instanceof Anthropic.RateLimitError) reason = 'APIの利用上限に達しました。しばらく待ってから再試行してください';
    else if (e instanceof Anthropic.APIConnectionTimeoutError) reason = `${TIMEOUT_MS / 1000}秒以内に応答がありませんでした`;
    else if (e instanceof Anthropic.APIError) reason = `Claude API エラー（${e.status ?? '—'}）: ${e.message.split('\n')[0].slice(0, 200)}`;
    else reason = e instanceof Error ? e.message.slice(0, 200) : String(e);
    console.error('[ai.ask]', reason);
    return NextResponse.json({ status: 'error', reason });
  }
}
