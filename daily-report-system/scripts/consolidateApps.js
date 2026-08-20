#!/usr/bin/env node
// ============================================================
//  アプリ統合（名簿・カレンダー）
// ------------------------------------------------------------
//  ① directory: 会社情報アプリ(40)を「会社名簿」へ拡張し、
//     顧客リスト(8)のレコードを移行（社員名簿34は0件のため枠のみ）
//  ② calendar : 「会社カレンダー（統合）」アプリを新規作成し、
//     Event Calendar(16=会社 / 17=個人)のレコード＋添付を移行
//
//  ★移行元アプリ(8/34/16/17)は読むだけ。一切変更しません。
//  ★ログには件数のみ。レコードの中身は出しません。
//
//  実行:
//    node scripts/consolidateApps.js --mode=directory
//    node scripts/consolidateApps.js --mode=calendar [--calendar-app=44]
//    node scripts/consolidateApps.js --mode=both
// ============================================================
import { required, optional } from '../lib/env.js';
import { fetchWithRetry } from '../lib/httpRetry.js';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
function base() {
  return required('KINTONE_BASE_URL').replace(/\/$/, '');
}
function authHeader() {
  return {
    'X-Cybozu-Authorization': Buffer.from(
      `${required('KINTONE_USER')}:${required('KINTONE_PASSWORD')}`
    ).toString('base64'),
  };
}
async function call(method, path, body) {
  const res = await fetchWithRetry(
    `${base()}${path}`,
    {
      method,
      headers: method === 'GET'
        ? { ...authHeader() }
        : { 'Content-Type': 'application/json', ...authHeader() },
      body: body !== undefined && method !== 'GET' ? JSON.stringify(body) : undefined,
    },
    { label: `kintone ${method} ${path}` }
  );
  return res.json ?? {};
}
async function fetchAll(app, extraQuery = '') {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const q = encodeURIComponent(`${extraQuery} limit 100 offset ${offset}`.trim());
    const r = await call('GET', `/k/v1/records.json?app=${app}&query=${q}`);
    out.push(...(r.records ?? []));
    if ((r.records ?? []).length < 100) break;
  }
  return out;
}
async function waitDeploy(app) {
  for (let i = 0; i < 40; i++) {
    const r = await call('GET', `/k/v1/preview/app/deploy.json?apps[0]=${app}`);
    const s = r.apps?.[0]?.status;
    if (s === 'SUCCESS') return;
    if (s === 'FAIL' || s === 'CANCEL') throw new Error(`デプロイ失敗: ${s}`);
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error('デプロイがタイムアウトしました');
}
const drop = (code, label, options) => ({
  type: 'DROP_DOWN',
  code,
  label,
  options: Object.fromEntries(options.map((o, i) => [o, { label: o, index: String(i) }])),
});
const v = (rec, code) => rec[code]?.value ?? '';

// ── 添付ファイルの移し替え（元からDL→新アプリ用にUL）──
async function transferFile(fileKey, name, contentType) {
  const dl = await fetch(`${base()}/k/v1/file.json?fileKey=${encodeURIComponent(fileKey)}`, {
    headers: { ...authHeader() },
  });
  if (!dl.ok) throw new Error(`file download ${dl.status}`);
  const buf = Buffer.from(await dl.arrayBuffer());
  const form = new FormData();
  form.append('file', new Blob([buf], { type: contentType || 'application/octet-stream' }), name);
  const ul = await fetch(`${base()}/k/v1/file.json`, {
    method: 'POST',
    headers: { ...authHeader() },
    body: form,
  });
  const json = await ul.json();
  if (!ul.ok) throw new Error(`file upload ${ul.status}`);
  return json.fileKey;
}

// ============================================================
// ① 名簿の統合
// ============================================================
async function consolidateDirectory() {
  const APP = arg('directory-app', '') || optional('KINTONE_CONTACTS_APP_ID', '40');
  console.log('── 名簿統合を開始 ──');

  // 1) 新しいフィールドを追加（既にあればスキップ）
  const cur = await call('GET', `/k/v1/preview/app/form/fields.json?app=${APP}`);
  const have = new Set(Object.keys(cur.properties ?? {}));
  const newFields = {
    dept: { type: 'SINGLE_LINE_TEXT', code: 'dept', label: '部署名・役職' },
    postal: { type: 'SINGLE_LINE_TEXT', code: 'postal', label: '郵便番号' },
    rank: drop('rank', '顧客ランク', ['A', 'B', 'C']),
    emp_no: { type: 'SINGLE_LINE_TEXT', code: 'emp_no', label: '社員番号' },
    furigana: { type: 'SINGLE_LINE_TEXT', code: 'furigana', label: 'ふりがな' },
    birthday: { type: 'DATE', code: 'birthday', label: '生年月日' },
    joining: { type: 'DATE', code: 'joining', label: '入社年月日' },
  };
  const toAdd = Object.fromEntries(Object.entries(newFields).filter(([k]) => !have.has(k)));
  if (Object.keys(toAdd).length) {
    await call('POST', '/k/v1/preview/app/form/fields.json', { app: APP, properties: toAdd });
    console.log(`  フィールド追加: ${Object.keys(toAdd).length}個`);
  }

  // 2) 区分に「顧客」「社員」を追加（既存の並びは維持）
  const cat = cur.properties?.category;
  if (cat) {
    const opts = { ...cat.options };
    let idx = Object.keys(opts).length;
    for (const o of ['顧客', '社員']) {
      if (!opts[o]) opts[o] = { label: o, index: String(idx++) };
    }
    await call('PUT', '/k/v1/preview/app/form/fields.json', {
      app: APP,
      properties: { category: { ...cat, options: opts } },
    });
    console.log('  区分に 顧客・社員 を追加');
  }

  // 3) 一覧を整備
  const vw = await call('GET', `/k/v1/preview/app/views.json?app=${APP}`);
  const views = vw.views ?? {};
  const mk = (name, index, fields, filterCond) => {
    views[name] = { ...(views[name] ?? {}), index, type: 'LIST', name, fields, ...(filterCond ? { filterCond } : {}) , sort: 'name asc' };
  };
  mk('全員一覧', 0, ['category', 'name', 'office', 'dept', 'phone', 'email', 'memo']);
  mk('顧客', 1, ['name', 'office', 'dept', 'phone', 'email', 'rank', 'memo'], 'category in ("顧客")');
  mk('社員', 2, ['name', 'furigana', 'emp_no', 'phone', 'email', 'joining'], 'category in ("社員")');
  mk('専門家・取引先', 3, ['category', 'name', 'office', 'phone', 'email', 'memo'],
    'category in ("弁護士","社労士","税理士","銀行","保険","不動産","その他")');
  await call('PUT', '/k/v1/preview/app/views.json', { app: APP, views });
  console.log('  一覧を4種類に整備');

  // 4) アプリ名を変更
  await call('PUT', '/k/v1/preview/app/settings.json', {
    app: APP,
    name: '会社名簿（社員・顧客・専門家・取引先）',
  });
  await call('POST', '/k/v1/preview/app/deploy.json', { apps: [{ app: APP }] });
  await waitDeploy(APP);
  console.log('  アプリ名を「会社名簿（社員・顧客・専門家・取引先）」に変更・デプロイ完了');

  // 5) 顧客リスト(8)を移行（名前で重複チェック）
  const src = await fetchAll('8');
  const existing = new Set((await fetchAll(APP)).map((r) => v(r, 'name')));
  let added = 0;
  for (const r of src) {
    const name = v(r, '担当者名') || v(r, '会社名');
    if (!name || existing.has(name)) continue;
    const memoParts = [];
    if (v(r, '備考')) memoParts.push(v(r, '備考'));
    if (v(r, 'FAX')) memoParts.push(`FAX: ${v(r, 'FAX')}`);
    const record = {
      category: { value: '顧客' },
      name: { value: name },
      office: { value: v(r, '会社名') },
      dept: { value: v(r, '部署名') },
      phone: { value: v(r, 'TEL') },
      email: { value: v(r, 'メールアドレス') },
      postal: { value: v(r, '郵便番号') },
      address: { value: v(r, '住所') },
      memo: { value: memoParts.join('\n') },
    };
    const rank = v(r, '顧客ランク');
    if (rank) record.rank = { value: rank };
    await call('POST', '/k/v1/record.json', { app: APP, record });
    added++;
  }
  console.log(`✅ 名簿統合完了: 顧客リストから${added}件移行（重複スキップ${src.length - added}件）`);
}

// ============================================================
// ② カレンダーの統合
// ============================================================
const CAL_FIELDS = {
  event_date: { type: 'DATE', code: 'event_date', label: '日付', required: true },
  title: { type: 'SINGLE_LINE_TEXT', code: 'title', label: '予定・イベント名', required: true },
  cal_kind: drop('cal_kind', '種別', ['会社', '個人', 'イベント', 'その他']),
  owner: { type: 'SINGLE_LINE_TEXT', code: 'owner', label: '担当・対象者' },
  detail: { type: 'MULTI_LINE_TEXT', code: 'detail', label: '内容・概要' },
  review: { type: 'MULTI_LINE_TEXT', code: 'review', label: '報告・振り返り' },
  photos: { type: 'FILE', code: 'photos', label: '写真・資料' },
};

async function consolidateCalendar() {
  console.log('── カレンダー統合を開始 ──');
  let APP = arg('calendar-app', '');
  if (!APP) {
    const created = await call('POST', '/k/v1/preview/app.json', { name: '会社カレンダー（統合）' });
    APP = created.app;
    await call('POST', '/k/v1/preview/app/form/fields.json', { app: APP, properties: CAL_FIELDS });
    const views = {
      カレンダー: { index: 0, type: 'CALENDAR', name: 'カレンダー', date: 'event_date', title: 'title' },
      新しい順: {
        index: 1, type: 'LIST', name: '新しい順',
        fields: ['event_date', 'cal_kind', 'title', 'owner', 'detail'],
        sort: 'event_date desc',
      },
    };
    await call('PUT', '/k/v1/preview/app/views.json', { app: APP, views });
    await call('POST', '/k/v1/preview/app/deploy.json', { apps: [{ app: APP }] });
    await waitDeploy(APP);
    console.log(`  アプリ作成完了（appId=${APP}）`);
  } else {
    console.log(`  既存アプリ ${APP} へ移行します`);
  }

  const existing = new Set(
    (await fetchAll(APP)).map((r) => `${v(r, 'event_date')}|${v(r, 'title')}`)
  );
  let added = 0;
  let files = 0;
  for (const [srcApp, kind] of [['16', '会社'], ['17', '個人']]) {
    const src = await fetchAll(srcApp);
    for (const r of src) {
      const title = v(r, '文字列__1行_') || '(無題)';
      const date = v(r, '日付');
      if (existing.has(`${date}|${title}`)) continue;
      const record = {
        title: { value: title },
        cal_kind: { value: kind },
        detail: { value: v(r, '文字列__複数行_') },
        review: { value: v(r, '文字列__複数行__0') },
      };
      if (date) record.event_date = { value: date };
      const atts = r['添付ファイル']?.value ?? [];
      if (atts.length) {
        const keys = [];
        for (const f of atts) {
          try {
            keys.push({ fileKey: await transferFile(f.fileKey, f.name, f.contentType) });
            files++;
          } catch {
            console.log('  ⚠ 添付1件の移行に失敗（スキップ）');
          }
        }
        if (keys.length) record.photos = { value: keys };
      }
      await call('POST', '/k/v1/record.json', { app: APP, record });
      added++;
    }
  }
  console.log(`✅ カレンダー統合完了: ${added}件移行（添付${files}件）／統合先 appId=${APP}`);
}

async function main() {
  const mode = arg('mode', 'both');
  if (mode === 'directory' || mode === 'both') await consolidateDirectory();
  if (mode === 'calendar' || mode === 'both') await consolidateCalendar();
}

main().catch((e) => {
  console.error('エラー:', JSON.stringify(e.body ?? e.message).slice(0, 500));
  process.exit(1);
});
