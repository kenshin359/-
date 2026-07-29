// ============================================================
//  AI経営チームの実行
// ------------------------------------------------------------
//  prompts/team/ の各部署に、それぞれ必要な数字だけを渡して
//  並行に走らせ、最後に統括が1枚にまとめます。
//
//  設計の要点:
//   ① 計算はすべてここ（JS側）で終わらせ、AIには結果だけ渡す
//   ② 部署ごとに渡すデータを絞る（精度が上がり、費用が下がる）
//   ③ データが無い部署は動かさない（幻の指摘と無駄な費用を防ぐ）
//   ④ 1部署が落ちても他は続行する（全滅させない）
//
//  組み立て部分（buildBriefings）は純粋な関数なので、
//  ネットワーク無しでテストできます。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEAM_DIR = path.resolve(__dirname, '..', 'prompts', 'team');

/** 部署の定義。order は統括に渡すときの並び順 */
export const DEPARTMENTS = [
  { key: 'finance',  name: '財務部',             prompt: '02-finance.md',      order: 1 },
  { key: 'marketing', name: 'マーケティング部',   prompt: '03-marketing.md',    order: 2 },
  { key: 'supply',   name: 'サプライチェーン部',  prompt: '04-supply-chain.md', order: 3 },
  { key: 'risk',     name: '品質・リスク管理室',  prompt: '05-risk-quality.md', order: 4 },
  { key: 'people',   name: '人事・現場運営',      prompt: '06-people.md',       order: 5 },
];

export const STRATEGY = { key: 'strategy', name: '経営企画室', prompt: '01-strategy.md' };
export const CHIEF = { key: 'chief', name: '統括補佐', prompt: '00-chief-of-staff.md' };

export function readTeamPrompt(file) {
  return fs.readFileSync(path.join(TEAM_DIR, file), 'utf8');
}

/**
 * 各部署に渡す資料を組み立てる。
 *
 * ★データが無い部署は結果に含めない（＝動かさない）。
 *
 * @param {object} ctx {
 *   date, sales, marketing, inventory, reports, staffing
 * }
 * @returns {object} { finance: {...}, marketing: {...}, ... }
 */
export function buildBriefings(ctx = {}) {
  const out = {};

  // ── 財務部: 売上と広告費の集計値 ──
  if (ctx.sales && hasNumbers(ctx.sales)) {
    out.finance = {
      日付: ctx.date ?? null,
      売上: ctx.sales,
      広告: ctx.adCosts ?? null,
    };
  }

  // ── マーケ: 転換率・アクセス・商品別 ──
  if (ctx.marketing && hasNumbers(ctx.marketing)) {
    out.marketing = {
      日付: ctx.date ?? null,
      集客と転換: ctx.marketing,
      // 商品は多すぎると費用も精度も悪化するので上位のみ渡す
      商品別: (ctx.products ?? []).slice(0, 12),
    };
  }

  // ── SCM: 在庫と欠品 ──
  // 在庫データが無くても、販売個数の連続ゼロがあれば動かす価値がある
  const hasStock = ctx.inventory && Object.keys(ctx.inventory).length > 0;
  const hasGaps = Array.isArray(ctx.stockoutSuspects) && ctx.stockoutSuspects.length > 0;
  if (hasStock || hasGaps) {
    out.supply = {
      日付: ctx.date ?? null,
      在庫データの有無: hasStock ? 'あり' : 'なし（在庫アプリ未作成のため、販売個数からの推定のみ）',
      在庫: ctx.inventory ?? null,
      欠品の疑い: ctx.stockoutSuspects ?? [],
    };
  }

  // ── 品質・リスク: 日報の要約 ──
  if (Array.isArray(ctx.reports) && ctx.reports.length) {
    out.risk = {
      日付: ctx.date ?? null,
      日報の要約: ctx.reports.map((r) => ({
        氏名: r.reporter ?? null,
        要約: r.summary ?? null,
        緊急: r.urgent ?? false,
        緊急理由: r.urgent_reason || null,
      })),
    };
  }

  // ── 人事・現場: 提出状況 ──
  if (ctx.staffing && hasNumbers(ctx.staffing)) {
    out.people = {
      日付: ctx.date ?? null,
      提出状況: ctx.staffing,
    };
  }

  return out;
}

/** 数値が1つでも入っているか（空オブジェクトで部署を起動しないため） */
function hasNumbers(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return Object.values(obj).some((v) => {
    if (v === null || v === undefined) return false;
    if (typeof v === 'number') return isFinite(v);
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return hasNumbers(v);
    return String(v).trim() !== '';
  });
}

/**
 * 部署の出力から、重要度の高い指摘だけを抜き出す。
 * 統括と経営企画に渡す量を絞るために使う。
 */
export function pickImportant(deptResults, levels = ['高', '中']) {
  const picked = [];
  for (const [key, res] of Object.entries(deptResults)) {
    if (!res || !Array.isArray(res.findings)) continue;
    const dept = DEPARTMENTS.find((d) => d.key === key);
    for (const f of res.findings) {
      if (!levels.includes(f.重要度)) continue;
      picked.push({ 部署: dept?.name ?? key, ...f });
    }
  }
  // 重要度「高」を先に
  return picked.sort((a, b) => (a.重要度 === '高' ? -1 : 1) - (b.重要度 === '高' ? -1 : 1));
}

/**
 * チームを実行する。
 *
 * @param {object} briefings buildBriefings の結果
 * @param {object} opts { callJson: (system, userObj) => Promise<object> }
 *        callJson を差し替えられるようにしてあるのでテストしやすい
 * @returns {Promise<{departments, strategy, chief, errors}>}
 */
export async function runTeam(briefings, { callJson }) {
  if (typeof callJson !== 'function') throw new Error('callJson が必要です');

  const errors = [];
  const active = DEPARTMENTS.filter((d) => briefings[d.key]);

  // ── 各部署を並行に走らせる。1つ落ちても他は続ける ──
  const settled = await Promise.all(
    active.map(async (d) => {
      try {
        const res = await callJson(readTeamPrompt(d.prompt), briefings[d.key]);
        return [d.key, res];
      } catch (e) {
        errors.push(`${d.name}: ${e.message}`);
        return [d.key, null];
      }
    })
  );

  const departments = {};
  for (const [k, v] of settled) if (v) departments[k] = v;

  if (!Object.keys(departments).length) {
    return { departments: {}, strategy: null, chief: null, errors };
  }

  const important = pickImportant(departments);

  // ── 経営企画室: 各部署の要約と重要指摘だけを見る ──
  let strategy = null;
  try {
    strategy = await callJson(readTeamPrompt(STRATEGY.prompt), {
      各部署の要約: Object.fromEntries(
        Object.entries(departments).map(([k, v]) => [
          DEPARTMENTS.find((d) => d.key === k)?.name ?? k,
          v.summary ?? null,
        ])
      ),
      重要な指摘: important,
    });
  } catch (e) {
    errors.push(`${STRATEGY.name}: ${e.message}`);
  }

  // ── 統括: 全部を1枚にまとめる ──
  let chief = null;
  try {
    chief = await callJson(readTeamPrompt(CHIEF.prompt), {
      各部署の要約: Object.fromEntries(
        Object.entries(departments).map(([k, v]) => [
          DEPARTMENTS.find((d) => d.key === k)?.name ?? k,
          v.summary ?? null,
        ])
      ),
      重要な指摘: important,
      経営企画室の提案: strategy,
    });
  } catch (e) {
    errors.push(`${CHIEF.name}: ${e.message}`);
  }

  return { departments, strategy, chief, errors };
}

/**
 * 実行結果を通知用の文面にする。
 * 統括の出力を主とし、経営企画の「今週」を添える。
 */
export function formatBoardBrief(result, { date } = {}) {
  const out = [];
  const c = result.chief;
  const s = result.strategy;

  out.push(`🏛 経営ブリーフィング${date ? `（${date}）` : ''}`);
  out.push('');

  if (c?.today) {
    out.push(c.today);
    out.push('');
  }

  if (c?.判断が必要?.length) {
    out.push('【社長の判断が必要】');
    for (const x of c.判断が必要) {
      out.push(`■ ${x.件名}　[${x.期限感 ?? '—'}]`);
      out.push(`  ${x.内容}`);
      if (x.部署) out.push(`  — ${x.部署}`);
    }
    out.push('');
  }

  if (s?.今週?.length) {
    out.push('【今週の打ち手】');
    for (const x of s.今週) {
      out.push(`■ ${x.課題}`);
      out.push(`  打ち手: ${x.打ち手}`);
      out.push(`  根拠　: ${x.根拠}`);
      if (x.期待効果) out.push(`  効果　: ${x.期待効果}`);
    }
    out.push('');
  }

  if (c?.報告?.length) {
    out.push('【報告】');
    for (const x of c.報告) out.push(`・${x.件名}: ${x.内容}`);
    out.push('');
  }

  if (c?.良い兆し?.length) {
    out.push('【良い兆し】');
    for (const x of c.良い兆し) out.push(`・${x}`);
    out.push('');
  }

  if (s?.監視?.length) {
    out.push('【監視中】');
    for (const x of s.監視) out.push(`・${x}`);
    out.push('');
  }

  // 動いた部署を明示する（何を見た上での結論かを分かるようにする）
  const names = Object.keys(result.departments)
    .map((k) => DEPARTMENTS.find((d) => d.key === k)?.name ?? k);
  if (names.length) out.push(`稼働した部署: ${names.join(' / ')}`);

  if (result.errors?.length) {
    out.push('');
    out.push('【この回で動かせなかった部署】');
    for (const e of result.errors) out.push(`・${e}`);
  }

  return out.join('\n').trim();
}
