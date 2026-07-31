// ============================================================
//  日次CSV提出ボックスの読み書き
// ------------------------------------------------------------
//  毎朝スタッフが置いた8つのCSVを、
//    ・そろっているか確認する
//    ・広告費管理アプリへ取り込む
//    ・売上ファイルは集計して報告する
//  ために使う道具です。
//
//  ★kintone は、このアプリと広告費管理アプリ以外には書き込みません。
//    売上・転換率報告アプリ（人が手で書いているもの）や
//    日報アプリには一切触れません。
// ============================================================
import { optional, required } from './env.js';
import { fetchWithRetry } from './httpRetry.js';
import { ALL_SLOTS, SALES_SLOTS, AD_SLOTS, dedupKey, slotStatus } from '../kintone/intakeSchema.js';

function base() {
  return required('KINTONE_BASE_URL').replace(/\/$/, '');
}

function auth() {
  const token = optional('KINTONE_API_TOKEN_INTAKE');
  if (token) return { 'X-Cybozu-API-Token': token };
  const user = process.env.KINTONE_USER;
  const pass = process.env.KINTONE_PASSWORD;
  if (!user || !pass) {
    throw new Error(
      'kintone の認証情報がありません。\n' +
        '  KINTONE_API_TOKEN_INTAKE、もしくは KINTONE_USER と KINTONE_PASSWORD を .env に設定してください。'
    );
  }
  return { 'X-Cybozu-Authorization': Buffer.from(`${user}:${pass}`).toString('base64') };
}

export async function call(method, path, body) {
  const res = await fetchWithRetry(
    `${base()}${path}`,
    {
      method,
      // ★GET に Content-Type を付けると kintone は 400 を返す
      headers: method === 'GET' ? { ...auth() } : { 'Content-Type': 'application/json', ...auth() },
      body: body !== undefined && method !== 'GET' ? JSON.stringify(body) : undefined,
    },
    { label: `kintone ${method} ${path}` }
  );
  return res.json ?? {};
}

export function intakeAppId() {
  const id = optional('KINTONE_INTAKE_APP_ID');
  if (!id) {
    throw new Error(
      'KINTONE_INTAKE_APP_ID が未設定です。\n' +
        '  `npm run create-business-apps intake` で作成し、表示された行を .env に貼ってください。'
    );
  }
  return id;
}

/** その日のレコードを取る（無ければ null） */
export async function findDay(dateISO, app = intakeAppId()) {
  const q = encodeURIComponent(`dedup_key = "${dedupKey(dateISO)}" limit 1`);
  const r = await call('GET', `/k/v1/records.json?app=${app}&query=${q}`);
  return r.records?.[0] ?? null;
}

/** その日の空レコードを作る（毎朝の受け皿を先に用意しておくため） */
export async function createDay(dateISO, app = intakeAppId()) {
  const record = {
    report_date: { value: dateISO },
    dedup_key: { value: dedupKey(dateISO) },
    status: { value: '提出中' },
  };
  const r = await call('POST', '/k/v1/record.json', { app, record });
  return r.id;
}

/**
 * その日の提出状況をまとめる。
 * @returns {{date, exists, slots, missing, filled, allDone}}
 */
export async function checkDay(dateISO, app = intakeAppId()) {
  const record = await findDay(dateISO, app);
  const slots = record ? slotStatus(record) : ALL_SLOTS.map((s) => ({ ...s, count: 0, filled: false, files: [] }));
  const missing = slots.filter((s) => !s.filled);
  const filled = slots.filter((s) => s.filled);
  return {
    date: dateISO,
    exists: !!record,
    recordId: record?.$id?.value ?? null,
    status: record?.status?.value ?? null,
    slots,
    missing,
    filled,
    allDone: missing.length === 0,
  };
}

/**
 * ファイルを1つ落とす（中身をそのままのバイト列で返す）。
 *
 * ★文字列として受け取ってはいけません。
 *   楽天やAmazonのCSVは Shift_JIS のことがあり、
 *   UTF-8として読んだ時点で日本語が壊れて元に戻せなくなります。
 *   バイト列のまま渡し、文字コードの判定は lib/csv.js に任せます。
 */
export async function downloadFile(fileKey) {
  const url = `${base()}/k/v1/file.json?fileKey=${encodeURIComponent(fileKey)}`;
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: auth() });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      // 4xx（429以外）は再試行しても直らない
      if (res.status < 500 && res.status !== 429) {
        throw new Error(`添付ファイルの取得に失敗: HTTP ${res.status}`);
      }
      lastErr = new Error(`添付ファイルの取得に失敗: HTTP ${res.status}`);
    } catch (e) {
      if (/HTTP 4\d\d/.test(e.message) && !/429/.test(e.message)) throw e;
      lastErr = e;
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
  throw lastErr ?? new Error('添付ファイルの取得に失敗しました');
}

/** 取込ログと状態を書き戻す */
export async function writeBack(recordId, { log, status }, app = intakeAppId()) {
  const record = {};
  if (log !== undefined) record.import_log = { value: String(log).slice(0, 60000) };
  if (status !== undefined) record.status = { value: status };
  if (!Object.keys(record).length) return;
  await call('PUT', '/k/v1/record.json', { app, id: recordId, record });
}

/** 提出状況の報告文（Chatwork用） */
export function formatIntakeCheck(check, opts = {}) {
  const { weekday = '' } = opts;
  const L = [];
  const total = check.slots.length;

  L.push(`📥 CSV提出チェック（${check.date}${weekday ? ` ${weekday}` : ''}）`);
  L.push('');

  if (!check.exists) {
    L.push('本日のレコードがまだ作られていません。');
    L.push('kintone「日次CSV提出ボックス」で新規レコードを作成してください。');
    return L.join('\n');
  }

  L.push(`そろっている: ${check.filled.length} / ${total}`);
  L.push('');

  const line = (s) => `${s.filled ? '✅' : '⬜'} ${s.label}${s.filled ? `（${s.count}件）` : ''}`;
  L.push('【売上】');
  for (const s of check.slots.filter((x) => SALES_SLOTS.some((y) => y.code === x.code))) L.push(`　${line(s)}`);
  L.push('');
  L.push('【広告】');
  for (const s of check.slots.filter((x) => AD_SLOTS.some((y) => y.code === x.code))) L.push(`　${line(s)}`);

  if (check.allDone) {
    L.push('');
    L.push('🎉 本日ぶんはすべてそろっています。ありがとうございます。');
  } else {
    L.push('');
    L.push('【未提出】');
    for (const s of check.missing) L.push(`　・${s.label}`);
    L.push('');
    L.push('※ 休業日などで元々ファイルが出ない場合は、');
    L.push('　 状態を「対象外(休業日)」にしていただければ、翌日から催促しません。');
  }

  return L.join('\n');
}
