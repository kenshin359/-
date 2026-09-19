// Googleスプレッドシートの読み取り（リンク共有＝「リンクを知っている全員」のシートを xlsx でエクスポートして読む）。
// gviz/CSV はフィルタで隠れた行が落ちるため、全行を含む xlsx を使う。書き込みはしない。
// サービスアカウント方式へ切り替えるときは fetchSheetRows の取得部分だけを差し替える。
import * as XLSX from 'xlsx';

export type SheetCell = string | number | boolean | Date | null;

export interface SheetTab {
  /** 見出し行を含む全行（空セルは ''） */
  rows: SheetCell[][];
  fetchedAt: Date;
}

export class SheetFetchError extends Error {}

/**
 * 指定シートの1タブを行列で返す。
 * @param sheetId スプレッドシートID（URLの /d/ と /edit の間）
 * @param tabName タブ名（無ければ最初のタブ）
 * @param revalidateSec Next の fetch キャッシュ秒数（既定 5分）
 */
export async function fetchSheetRows(sheetId: string, tabName?: string, revalidateSec = 300): Promise<SheetTab> {
  if (!/^[A-Za-z0-9_-]{20,}$/.test(sheetId)) throw new SheetFetchError('スプレッドシートIDの形式が不正です');
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;
  const res = await fetch(url, { next: { revalidate: revalidateSec }, redirect: 'follow' });
  if (!res.ok) throw new SheetFetchError(`スプレッドシートを取得できません（HTTP ${res.status}）。共有設定が「リンクを知っている全員」になっているか確認してください`);
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/html')) throw new SheetFetchError('スプレッドシートがログインを要求しています（共有設定が「制限付き」）');
  const buf = Buffer.from(await res.arrayBuffer());
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const name = tabName && wb.SheetNames.includes(tabName) ? tabName : wb.SheetNames[0];
  if (!name) throw new SheetFetchError('タブがありません');
  if (tabName && name !== tabName) throw new SheetFetchError(`タブ「${tabName}」が見つかりません（あるタブ: ${wb.SheetNames.join('、')}）`);
  const ws = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json<SheetCell[]>(ws, { header: 1, raw: true, defval: '' });
  return { rows, fetchedAt: new Date() };
}
