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

  // 3) 一覧を整備（旧「連絡先一覧」は「全員一覧」に置き換え。PUTは全置換なので新セットのみ渡す）
  const views = {};
  const mk = (name, index, fields, filterCond) => {
    views[name] = { index, type: 'LIST', name, fields, ...(filterCond ? { filterCond } : {}), sort: 'name asc' };
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

// ============================================================
// ③ 案件報告(5) → 案件報告（クリエイター配信管理・32）へ統合
// ============================================================
async function consolidateAnken() {
  const APP = arg('anken-app', '') || '32';
  console.log('── 案件報告の統合を開始 ──');

  // 1) 契約管理系のフィールドを32に追加（既にあればスキップ）
  const cur = await call('GET', `/k/v1/preview/app/form/fields.json?app=${APP}`);
  const have = new Set(Object.keys(cur.properties ?? {}));
  const newFields = {
    staff_name: { type: 'SINGLE_LINE_TEXT', code: 'staff_name', label: '社内担当者' },
    contract_stage: drop('contract_stage', '契約段階', [
      '依頼検討中', '返信待ち', '返信あり', '返信なし', '契約返答待ち', '契約済み',
      '下書き提出待ち', '下書き提出済み', '投稿済み', '報酬支払い済み',
    ]),
    secondary_use: drop('secondary_use', '二次利用', ['二次利用なし', '二次利用あり']),
    secondary_period: { type: 'MULTI_LINE_TEXT', code: 'secondary_period', label: '二次利用期間' },
    contract_detail: { type: 'MULTI_LINE_TEXT', code: 'contract_detail', label: '契約内容詳細' },
    account_info: { type: 'MULTI_LINE_TEXT', code: 'account_info', label: 'アカウント情報' },
    contract_files: { type: 'FILE', code: 'contract_files', label: '契約書PDF' },
    record_files: { type: 'FILE', code: 'record_files', label: '取引記録' },
  };
  const toAdd = Object.fromEntries(Object.entries(newFields).filter(([k]) => !have.has(k)));
  if (Object.keys(toAdd).length) {
    await call('POST', '/k/v1/preview/app/form/fields.json', { app: APP, properties: toAdd });
    console.log(`  フィールド追加: ${Object.keys(toAdd).length}個`);
  }

  // 2) 「契約管理」一覧を追加（既存の一覧は残す）
  const vw = await call('GET', `/k/v1/preview/app/views.json?app=${APP}`);
  const views = vw.views ?? {};
  if (!views['契約管理']) {
    const maxIdx = Math.max(-1, ...Object.values(views).map((x) => Number(x.index)));
    views['契約管理'] = {
      index: maxIdx + 1,
      type: 'LIST',
      name: '契約管理',
      fields: ['creator_name', 'staff_name', 'contract_stage', 'post_date', 'secondary_use', 'memo'],
      sort: 'post_date desc',
    };
    await call('PUT', '/k/v1/preview/app/views.json', { app: APP, views });
    console.log('  「契約管理」一覧を追加');
  }
  await call('POST', '/k/v1/preview/app/deploy.json', { apps: [{ app: APP }] });
  await waitDeploy(APP);

  // 3) レコード移行（名前＋投稿予定日で重複チェック）
  const STAGE_TO_TIEUP = { 投稿済み: '投稿済', 依頼検討中: '予定' };
  const src = await fetchAll('5');
  const existing = new Set((await fetchAll(APP)).map((r) => `${v(r, 'creator_name')}|${v(r, 'post_date')}`));
  let added = 0;
  let files = 0;
  for (const r of src) {
    const name = v(r, '文字列__1行_') || '(名前なし)';
    const date = v(r, '日付_0');
    if (existing.has(`${name}|${date}`)) continue;
    const stage = v(r, 'ラジオボタン');
    const secondary = (r['チェックボックス']?.value ?? []).includes('二次利用あり') ? '二次利用あり' : '二次利用なし';
    const record = {
      creator_name: { value: name },
      staff_name: { value: v(r, '文字列__1行__0') },
      contract_detail: { value: v(r, '文字列__複数行_') },
      account_info: { value: v(r, '文字列__複数行__0') },
      secondary_period: { value: v(r, '文字列__複数行__1') },
      memo: { value: v(r, '文字列__複数行__2') },
      secondary_use: { value: secondary },
      tieup: { value: STAGE_TO_TIEUP[stage] ?? '依頼済' },
    };
    if (stage) record.contract_stage = { value: stage };
    if (date) record.post_date = { value: date };
    for (const [srcCode, dstCode] of [['添付ファイル', 'contract_files'], ['添付ファイル_0', 'record_files']]) {
      const atts = r[srcCode]?.value ?? [];
      if (!atts.length) continue;
      const keys = [];
      for (const f of atts) {
        try {
          keys.push({ fileKey: await transferFile(f.fileKey, f.name, f.contentType) });
          files++;
        } catch {
          console.log('  ⚠ 添付1件の移行に失敗（スキップ）');
        }
      }
      if (keys.length) record[dstCode] = { value: keys };
    }
    await call('POST', '/k/v1/record.json', { app: APP, record });
    added++;
  }
  console.log(`✅ 案件報告統合完了: ${added}件移行（添付${files}件・重複スキップ${src.length - added}件）`);
}

// ============================================================
// ④ 販促費管理(42) → 「広告費記載（全て）」へ拡張
// ============================================================
async function upgradeAdCostApp() {
  const APP = arg('adcost-app', '') || '42';
  console.log('── 広告費記載アプリへの拡張を開始 ──');

  const cur = await call('GET', `/k/v1/preview/app/form/fields.json?app=${APP}`);
  const have = new Set(Object.keys(cur.properties ?? {}));

  // 1) ブランドとCSV添付を追加
  const newFields = {
    brand: drop('brand', 'ブランド', ['リベティ', 'O2', 'ガジェティ']),
    csv_files: { type: 'FILE', code: 'csv_files', label: '広告CSV・資料' },
  };
  const toAdd = Object.fromEntries(Object.entries(newFields).filter(([k]) => !have.has(k)));
  if (Object.keys(toAdd).length) {
    await call('POST', '/k/v1/preview/app/form/fields.json', { app: APP, properties: toAdd });
    console.log(`  フィールド追加: ${Object.keys(toAdd).length}個（ブランド・CSV添付）`);
  }

  // 2) 費目の選択肢を全ブランド対応に置き換え（レコード0件なので安全）
  const cat = cur.properties?.category;
  if (cat) {
    const options = ['メタ広告', 'RPP', 'Amazon広告', 'Google広告', 'TikTok広告', '案件依頼', 'PRタイムズ', 'テレビ出演費用', 'その他'];
    await call('PUT', '/k/v1/preview/app/form/fields.json', {
      app: APP,
      properties: {
        category: {
          ...cat,
          options: Object.fromEntries(options.map((o, i) => [o, { label: o, index: String(i) }])),
        },
      },
    });
    console.log('  費目を全ブランド対応に更新');
  }

  // 3) 一覧を再構成（全て／今月／ブランド別）
  const F = ['cost_date', 'brand', 'category', 'amount', 'partner', 'product', 'csv_files', 'memo'];
  const views = {
    全て: { index: 0, type: 'LIST', name: '全て', fields: F, sort: 'cost_date desc' },
    今月: { index: 1, type: 'LIST', name: '今月', fields: F, filterCond: 'cost_date = THIS_MONTH()', sort: 'cost_date desc' },
    リベティ: { index: 2, type: 'LIST', name: 'リベティ', fields: F, filterCond: 'brand in ("リベティ")', sort: 'cost_date desc' },
    O2: { index: 3, type: 'LIST', name: 'O2', fields: F, filterCond: 'brand in ("O2")', sort: 'cost_date desc' },
    ガジェティ: { index: 4, type: 'LIST', name: 'ガジェティ', fields: F, filterCond: 'brand in ("ガジェティ")', sort: 'cost_date desc' },
  };
  await call('PUT', '/k/v1/preview/app/views.json', { app: APP, views });
  console.log('  一覧を5種類（全て/今月/ブランド別）に整備');

  // 4) アプリ名を変更してデプロイ
  await call('PUT', '/k/v1/preview/app/settings.json', { app: APP, name: '広告費記載（全て）' });
  await call('POST', '/k/v1/preview/app/deploy.json', { apps: [{ app: APP }] });
  await waitDeploy(APP);
  console.log(`✅ 広告費記載アプリ完成（appId=${APP}・名称「広告費記載（全て）」）`);
}

async function main() {
  const mode = arg('mode', 'both');
  if (mode === 'directory' || mode === 'both') await consolidateDirectory();
  if (mode === 'calendar' || mode === 'both') await consolidateCalendar();
  if (mode === 'anken') await consolidateAnken();
  if (mode === 'adcost') await upgradeAdCostApp();
  if (mode === 'anken+adcost') { await consolidateAnken(); await upgradeAdCostApp(); }
}

main().catch((e) => {
  console.error('エラー:', JSON.stringify(e.body ?? e.message).slice(0, 500));
  process.exit(1);
});
