// SNS/LP チームの週次報告（文章）をパースして
// 「SNS/LP週次報告（新）」アプリへ構造化レコードとして投入する。
//
// 入力元は2通り（週次報告はチャットやドキュメントに貼られることが多いため）:
//   ① kintone の既存アプリ … KINTONE_WEEKLY_OLD_APP_ID を設定すると、そのアプリの
//      全レコードの文字列フィールドを走査してパースする。
//   ② ローカルのサンプル … 上記未設定なら samples/weekly/ 配下の .txt / .md を読む。
//      1ファイル内に複数の報告がある場合は「———」等の区切り線で分割する。
//
//   実行: npm run migrate-weekly  （まず DRY_RUN=1 で確認してから本投入を推奨）
import { kintone, qs } from './client.js';
import { parseWeekly } from './parseWeekly.js';

const OLD = process.env.KINTONE_WEEKLY_OLD_APP_ID;
const NEW = process.env.KINTONE_WEEKLY_APP_ID;
const DRY = process.env.DRY_RUN === '1';
const SAMPLES_DIR = process.env.WEEKLY_SAMPLES_DIR || 'samples/weekly';
const YEAR = process.env.WEEKLY_YEAR ? Number(process.env.WEEKLY_YEAR) : null;

// 区切り線（3文字以上の罫線・ダッシュ・アンダースコア）で複数報告を分割
const SEPARATOR = /^[\s]*[-–—―─＿_]{3,}[\s]*$/m;

// $id カーソルで全レコードを取得
async function fetchAll(app) {
  const all = [];
  let last = 0;
  for (;;) {
    const query = `$id > ${last} order by $id asc limit 100`;
    const r = await kintone('GET', `/k/v1/records.json?${qs({ app, query })}`);
    const recs = r.records || [];
    if (!recs.length) break;
    all.push(...recs);
    last = Number(recs[recs.length - 1].$id.value);
    if (recs.length < 100) break;
  }
  return all;
}

// 入力元から「報告文（＋年ヒント）」の配列を集める
async function collectChunks() {
  const chunks = [];

  if (OLD) {
    console.log(`移行元アプリ ${OLD} を読み込み中 …`);
    const oldRecords = await fetchAll(OLD);
    console.log(`  ${oldRecords.length} レコード取得`);
    for (const rec of oldRecords) {
      for (const f of Object.values(rec)) {
        if (f && typeof f.value === 'string' && /チーム/.test(f.value)) {
          for (const part of f.value.split(SEPARATOR)) chunks.push({ text: part, year: YEAR });
        }
      }
    }
    return chunks;
  }

  // ローカルのサンプルを読む
  const { readdirSync, readFileSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  if (!existsSync(SAMPLES_DIR)) {
    throw new Error(
      `入力元がありません。KINTONE_WEEKLY_OLD_APP_ID を設定するか、${SAMPLES_DIR}/ にサンプル(.txt/.md)を置いてください。`
    );
  }
  console.log(`ローカルサンプルを読み込み中 … ${SAMPLES_DIR}/`);
  const files = readdirSync(SAMPLES_DIR).filter((f) => /\.(txt|md)$/i.test(f));
  for (const file of files) {
    // ファイル名の先頭 4桁を年ヒントに使う（例: 2026-07-21_sns.txt）
    const ym = file.match(/(\d{4})/);
    const year = ym ? Number(ym[1]) : YEAR;
    const raw = readFileSync(join(SAMPLES_DIR, file), 'utf8');
    for (const part of raw.split(SEPARATOR)) chunks.push({ text: part, year });
  }
  console.log(`  ${files.length} ファイル / ${chunks.length} ブロック`);
  return chunks;
}

// パース結果 → 新アプリのレコード形式
function toRecord(p) {
  const v = (x) => ({ value: x ?? '' });
  return {
    team: v(p.team),
    period_start: v(p.period_start),
    period_end: v(p.period_end),
    posts_total: v(p.posts_total),
    summary: v(p.summary),
    next_week: v(p.next_week),
    mtg: v(p.mtg),
    posts: {
      value: p.posts.map((x) => ({
        value: { account: { value: x.account }, count: { value: x.count ?? '' } },
      })),
    },
    sections: {
      value: p.sections.map((x) => ({
        value: { title: { value: x.title }, done: { value: x.done }, next: { value: x.next } },
      })),
    },
  };
}

async function main() {
  const chunks = await collectChunks();

  // 週次報告としてパースできたものだけ採用（議事録などは team=null で除外）
  const reports = [];
  for (const c of chunks) {
    const p = parseWeekly(c.text, { year: c.year });
    if (p && p.team && p.period_start) reports.push(p);
  }

  // チーム＋期間開始日で重複排除（後勝ち）→ 期間・チーム順
  const byKey = new Map();
  for (const p of reports) byKey.set(`${p.period_start}#${p.team}`, p);
  const parsed = [...byKey.values()].sort((a, b) =>
    a.period_start === b.period_start ? (a.team < b.team ? -1 : 1) : a.period_start < b.period_start ? -1 : 1
  );

  console.log(`  → ${parsed.length} 件の週次報告を抽出`);
  for (const p of parsed) {
    console.log(
      `  例) ${p.period_start}〜${p.period_end || '?'} [${p.team}]  ` +
        `合計${p.posts_total ?? '-'}投稿 / 内訳${p.posts.length}件 / トピック${p.sections.length}件`
    );
  }

  if (DRY) {
    console.log('\n[DRY_RUN] 投入は行いません。抽出結果を out/weekly-preview.json に書き出します。');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync('out', { recursive: true });
    writeFileSync('out/weekly-preview.json', JSON.stringify(parsed, null, 2));
    return;
  }

  if (!NEW) throw new Error('KINTONE_WEEKLY_APP_ID が未設定です（.env を確認）');
  if (!parsed.length) {
    console.log('投入対象がありません。');
    return;
  }

  const records = parsed.map(toRecord);
  for (let i = 0; i < records.length; i += 100) {
    const batch = records.slice(i, i + 100);
    await kintone('POST', '/k/v1/records.json', { app: NEW, records: batch });
    console.log(`  投入 ${Math.min(i + 100, records.length)}/${records.length}`);
  }
  console.log(`\n完了 ✅  ${records.length} 件を新アプリへ投入しました。`);
}

main().catch((e) => {
  console.error('エラー:', e.detail || e.message);
  process.exit(1);
});
