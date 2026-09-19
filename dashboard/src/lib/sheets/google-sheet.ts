// Googleスプレッドシートの読み取り。xlsx でエクスポートして読む（gviz/CSV はフィルタで隠れた行が落ちるため）。書き込みはしない。
// 取得方式は2つ（両対応）:
//   1) GOOGLE_SHEETS_SA_JSON があればサービスアカウントで Drive API からエクスポート（シートはそのアカウントにだけ共有すればよい・推奨）
//   2) 無ければ「リンクを知っている全員」の公開エクスポート（暫定）
import * as XLSX from 'xlsx';
import { getServiceAccountToken } from './service-account';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** どちらの方式で読んだか（画面の出典表記用） */
export type SheetAccessMode = 'service-account' | 'public-link';

async function downloadWorkbook(sheetId: string, revalidateSec: number): Promise<{ wb: XLSX.WorkBook; mode: SheetAccessMode }> {
  if (!/^[A-Za-z0-9_-]{20,}$/.test(sheetId)) throw new SheetFetchError('スプレッドシートIDの形式が不正です');
  const token = await getServiceAccountToken().catch((e: unknown) => {
    throw new SheetFetchError(e instanceof Error ? e.message : String(e));
  });
  let res: Response;
  let mode: SheetAccessMode;
  if (token) {
    mode = 'service-account';
    res = await fetch(`https://www.googleapis.com/drive/v3/files/${sheetId}/export?mimeType=${encodeURIComponent(XLSX_MIME)}`, {
      headers: { authorization: `Bearer ${token}` },
      next: { revalidate: revalidateSec },
    });
    if (res.status === 403 || res.status === 404) {
      throw new SheetFetchError('サービスアカウントにこのシートが共有されていません（シートの「共有」でサービスアカウントのメールアドレスを閲覧者に追加してください）');
    }
  } else {
    mode = 'public-link';
    res = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`, { next: { revalidate: revalidateSec }, redirect: 'follow' });
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('text/html')) throw new SheetFetchError('スプレッドシートがログインを要求しています（共有設定が「制限付き」）。サービスアカウント方式（docs/sheets-setup.md）か「リンクを知っている全員（閲覧者）」にしてください');
  }
  if (!res.ok) throw new SheetFetchError(`スプレッドシートを取得できません（HTTP ${res.status}）`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { wb: XLSX.read(buf, { type: 'buffer', cellDates: true }), mode };
}

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
  const { wb } = await downloadWorkbook(sheetId, revalidateSec);
  const name = tabName && wb.SheetNames.includes(tabName) ? tabName : wb.SheetNames[0];
  if (!name) throw new SheetFetchError('タブがありません');
  if (tabName && name !== tabName) throw new SheetFetchError(`タブ「${tabName}」が見つかりません（あるタブ: ${wb.SheetNames.join('、')}）`);
  const ws = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json<SheetCell[]>(ws, { header: 1, raw: true, defval: '' });
  return { rows, fetchedAt: new Date() };
}

export interface SheetTabNamed extends SheetTab {
  /** タブ名 */
  name: string;
}

export interface SheetWorkbook {
  tabs: SheetTabNamed[];
  fetchedAt: Date;
}

/**
 * 指定シートの全タブを行列で返す（タブ名が分からないシート向け。fetchSheetRows とは独立）。
 * @param sheetId スプレッドシートID（URLの /d/ と /edit の間）
 * @param revalidateSec Next の fetch キャッシュ秒数（既定 5分）
 */
export async function fetchSheetTabs(sheetId: string, revalidateSec = 300): Promise<SheetWorkbook> {
  const { wb } = await downloadWorkbook(sheetId, revalidateSec);
  if (wb.SheetNames.length === 0) throw new SheetFetchError('タブがありません');
  const fetchedAt = new Date();
  const tabs: SheetTabNamed[] = wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json<SheetCell[]>(wb.Sheets[name], { header: 1, raw: true, defval: '' }),
    fetchedAt,
  }));
  return { tabs, fetchedAt };
}
