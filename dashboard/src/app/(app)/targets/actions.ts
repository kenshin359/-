'use server';

// 目標・予実管理のサーバーアクション。画面の出し分けに頼らず、ここで必ず editor 以上（canWrite）を検証し AuditLog に残す。
// 保存先: 月間目標 = Target（scope='all'/metric='sales'|'sales_stretch'）、日別の重み = Setting `targets.weights.<YYYY-MM>`（JSON）。
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions, canWrite } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { formatYen } from '@/lib/metrics/format';
import { DEFAULT_WEIGHT, serializeWeights, type WeightMap } from '@/lib/metrics/daily-targets';
import { daysInMonthOf, readEventsCalendar, TARGET_METRIC, weightsSettingKey } from '@/lib/targets-data';

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

const MONTH_RE = /^\d{4}-\d{2}$/;
/** 重みの上限（現場の最大は 2.0。誤入力の 20 などを弾く） */
const MAX_WEIGHT = 10;

async function requireWriter() {
  const session = await getServerSession(authOptions);
  if (!session) throw new Error('ログインが必要です');
  if (!canWrite(session.user.role)) throw new Error('閲覧者は目標を編集できません（編集者以上）');
  return session;
}

/** updatedBy に必ず値を入れる（空だとデモシード扱いになるため） */
function actorName(session: Awaited<ReturnType<typeof requireWriter>>): string {
  return session.user.name || session.user.email || session.user.id;
}

async function audit(userId: string, action: string, detail: string) {
  await prisma.auditLog.create({ data: { userId, action, detail: detail.slice(0, 500) } }).catch(() => undefined);
}

function revalidate() {
  revalidatePath('/targets');
  revalidatePath('/sales');
  revalidatePath('/pro', 'layout');
}

const yenField = z.preprocess(
  (v) => (v === '' || v == null ? null : Number(String(v).replace(/[,¥￥\s]/g, ''))),
  z.number({ message: '金額は数字で入力してください' }).int('金額は整数（円）で入力してください').min(1, '金額は1円以上'),
);

const TargetsInput = z.object({
  month: z.string().regex(MONTH_RE, '対象月の形式が不正です'),
  main: yenField,
  stretch: yenField,
});

export async function saveMonthTargetsAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const session = await requireWriter();
    const parsed = TargetsInput.safeParse({ month: form.get('month'), main: form.get('main'), stretch: form.get('stretch') });
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
    const { month, main, stretch } = parsed.data;
    if (stretch < main) return { ok: false, message: 'ストレッチ目標はメイン目標以上にしてください' };
    const by = actorName(session);
    const upsert = (metric: string, amount: number) =>
      prisma.target.upsert({
        where: { month_scope_scopeCode_metric: { month, scope: 'all', scopeCode: 'all', metric } },
        update: { amount, updatedBy: by },
        create: { month, scope: 'all', scopeCode: 'all', metric, amount, updatedBy: by },
      });
    await prisma.$transaction([upsert(TARGET_METRIC.main, main), upsert(TARGET_METRIC.stretch, stretch)]);
    await audit(session.user.id, 'targets.save', `${month} メイン${formatYen(main)} ストレッチ${formatYen(stretch)}`);
    revalidate();
    return { ok: true, message: `${month} の月間目標を保存しました（メイン ${formatYen(main)}／ストレッチ ${formatYen(stretch)}）` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '保存に失敗しました' };
  }
}

/** 日別の重み・ラベルを保存。フォームのキーは w_<日>（重み）・l_<日>（ラベル）。空欄の重みは 1.0 */
export async function saveWeightsAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const session = await requireWriter();
    const month = String(form.get('month') ?? '');
    if (!MONTH_RE.test(month)) return { ok: false, message: '対象月の形式が不正です' };
    const n = daysInMonthOf(month);
    const weights: WeightMap = {};
    for (let d = 1; d <= n; d++) {
      const rawW = String(form.get(`w_${d}`) ?? '').trim();
      const label = String(form.get(`l_${d}`) ?? '').trim().slice(0, 60);
      let weight = DEFAULT_WEIGHT;
      if (rawW !== '') {
        weight = Number(rawW);
        if (!Number.isFinite(weight) || weight <= 0 || weight > MAX_WEIGHT) {
          return { ok: false, message: `${Number(month.slice(5))}/${d} の重みが不正です（0より大きく ${MAX_WEIGHT} 以下の数字）` };
        }
        weight = Math.round(weight * 100) / 100;
      }
      weights[String(d)] = { label, weight };
    }
    const value = serializeWeights(weights);
    const key = weightsSettingKey(month);
    await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    const eventDays = Object.values(weights).filter((w) => w.weight !== DEFAULT_WEIGHT).length;
    await audit(session.user.id, 'targets.weights', `${month} イベント日${eventDays}日 ${value}`);
    revalidate();
    return { ok: true, message: `${month} の重みを保存しました（重み1.0以外の日: ${eventDays}日）` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '保存に失敗しました' };
  }
}

/**
 * ../daily-report-system/config/chorei/events-<YYYY-MM>.json の重みを Setting に投入する（既存の重みは上書き）。
 * 月間目標（main/stretch）は投入せず、ファイルの値をメッセージで知らせる（目標は上のフォームで保存）。
 */
export async function loadEventsCalendarAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const session = await requireWriter();
    const month = String(form.get('month') ?? '');
    if (!MONTH_RE.test(month)) return { ok: false, message: '対象月の形式が不正です' };
    const res = await readEventsCalendar(month);
    if (res.status === 'missing') {
      return {
        ok: false,
        message: `イベントカレンダーに ${month} がありません（src/data/events/events-${month}.json）。月初に sh scripts/sync-events.sh で取り込むか、下の表で重みを手入力して保存してください。`,
      };
    }
    if (res.status === 'invalid') return { ok: false, message: `ファイルを読めませんでした: ${res.reason}` };
    const { calendar } = res;
    const value = serializeWeights(calendar.weights);
    const key = weightsSettingKey(month);
    await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    const eventDays = Object.keys(calendar.weights).length;
    await audit(session.user.id, 'targets.weights.import', `${month} events-${month}.json イベント日${eventDays}日`);
    revalidate();
    const targetNote = calendar.targets
      ? ` ファイルの月間目標: メイン ${formatYen(calendar.targets.main)}／ストレッチ ${formatYen(calendar.targets.stretch)}（目標は上のフォームで保存してください）。`
      : '';
    const fileNote = calendar.note ? ` ファイルの注記: ${calendar.note}` : '';
    return { ok: true, message: `events-${month}.json から重みを読み込みました（イベント日 ${eventDays}日）。${targetNote}${fileNote}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '読み込みに失敗しました' };
  }
}
