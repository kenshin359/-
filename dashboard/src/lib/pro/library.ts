// PRO ⑥ 資料庫2.0 のデータ層（docs/pro-plan.md §5 ⑥）。
// Document テーブルに tags（カンマ区切り）と docType（種別）を持たせ、タグ・カテゴリ・部署・担当者・更新日で横断検索する。
//
// 方針:
// - 検索語は NFKC 正規化して空白で分割し、全語 AND（資料名・メモ・タグ・カテゴリ・部署・登録者・種別のどれかに含まれる）。
// - 機密種別（人事資料 hr・契約書 contract）は管理職以上にしか返さない。判定は searchLibrary（サーバー側）で行い、
//   Prisma の where 句で落とすので、権限が無い人にはその行が届かない（UIの出し分けだけに頼らない）。
// - Google Drive API は任意。未設定なら { status: 'unconfigured' } を返し、画面は「未接続」と出す（成功と偽らない）。
// - このモジュールは client からも定数を import するため、prisma / fetch は関数の中でしか使わない。
import { z } from 'zod';
import { prisma } from '../prisma';
import { DOC_CATEGORIES, DocumentInput, docKind, type DocKind } from '../documents';
import { canSeeConfidential, type Level } from '../rbac';

// ---- 種別 ----
export const DOC_TYPES = [
  { code: 'manual', label: 'マニュアル' },
  { code: 'contract', label: '契約書' },
  { code: 'product', label: '商品資料' },
  { code: 'ad', label: '広告資料' },
  { code: 'logistics', label: '物流資料' },
  { code: 'hr', label: '人事資料' },
  { code: 'other', label: 'その他' },
] as const;
export type DocType = (typeof DOC_TYPES)[number]['code'];
export const DOC_TYPE_CODES = DOC_TYPES.map((t) => t.code) as [DocType, ...DocType[]];
export const DOC_TYPE_LABEL: Record<DocType, string> = Object.fromEntries(DOC_TYPES.map((t) => [t.code, t.label])) as Record<DocType, string>;

/** 管理職以上にしか見せない種別 */
export const CONFIDENTIAL_DOC_TYPES: readonly DocType[] = ['hr', 'contract'];

export function isDocType(v: unknown): v is DocType {
  return typeof v === 'string' && (DOC_TYPE_CODES as readonly string[]).includes(v);
}

export function isConfidentialDocType(t: string | null | undefined): boolean {
  return t != null && (CONFIDENTIAL_DOC_TYPES as readonly string[]).includes(t);
}

/** この権限でその種別の資料を見られるか */
export function canSeeDocType(level: Level, docType: string | null | undefined): boolean {
  return !isConfidentialDocType(docType) || canSeeConfidential(level);
}

// ---- タグ ----
export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 30;

/** 検索・比較用の正規化（NFKC → 小文字 → 前後空白除去） */
export function normalizeText(s: string | null | undefined): string {
  return (s ?? '').normalize('NFKC').toLowerCase().trim();
}

/** タグ1件の正規化。区切り文字（, 、 |）と前後空白を落とし、内側の連続空白は1つに */
export function normalizeTag(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[,、|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TAG_LENGTH);
}

/** カンマ区切り文字列（または配列）→ タグ配列。空・重複（大小文字無視）は除く */
export function parseTags(raw: string | string[] | null | undefined): string[] {
  const parts = Array.isArray(raw) ? raw : (raw ?? '').split(/[,、\n]/);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const t = normalizeTag(p);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** タグ配列 → DB保存用のカンマ区切り（空なら null） */
export function serializeTags(tags: string[]): string | null {
  const t = parseTags(tags);
  return t.length ? t.join(',') : null;
}

export interface TagCount {
  tag: string;
  count: number;
}

/** 使われているタグを件数の多い順（同数なら五十音順）に返す */
export function topTags(docs: { tags: string[] }[], limit = 30): TagCount[] {
  const counts = new Map<string, TagCount>();
  for (const d of docs) {
    for (const tag of d.tags) {
      const key = tag.toLowerCase();
      const cur = counts.get(key);
      if (cur) cur.count++;
      else counts.set(key, { tag, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ja')).slice(0, limit);
}

// ---- 検索語 ----
/** 検索文字列 → 語の配列（NFKC・小文字・空白区切り・重複除去）。全角空白も区切りとして扱う */
export function parseQuery(q: string | null | undefined): string[] {
  const terms = normalizeText(q).split(/\s+/).filter(Boolean);
  return [...new Set(terms)];
}

export interface LibraryDoc {
  id: string;
  title: string;
  category: string;
  department: string;
  url: string;
  note: string;
  tags: string[];
  docType: DocType | null;
  docTypeLabel: string;
  ownerName: string;
  ownerId: string | null;
  kind: DocKind;
  host: string;
  updatedAt: string;
  createdAt: string;
}

/** 検索対象の文字列（資料名・メモ・タグ・カテゴリ・部署・登録者・種別）を1本にする */
export function docSearchText(d: Pick<LibraryDoc, 'title' | 'note' | 'tags' | 'category' | 'department' | 'ownerName' | 'docType' | 'docTypeLabel'>): string {
  return normalizeText([d.title, d.note, d.tags.join(' '), d.category, d.department, d.ownerName, d.docType ?? '', d.docTypeLabel].join(' '));
}

/** 全語 AND で一致するか。語が無ければ常に true */
export function matchesQuery(d: Parameters<typeof docSearchText>[0], terms: string[]): boolean {
  if (terms.length === 0) return true;
  const text = docSearchText(d);
  return terms.every((t) => text.includes(t));
}

// ---- 検索条件 ----
export const UPDATED_WITHIN = [7, 30, 90] as const;
export type UpdatedWithin = (typeof UPDATED_WITHIN)[number];
export const SORTS = ['updated', 'title'] as const;
export type LibrarySort = (typeof SORTS)[number];

const emptyToUndef = (v: unknown) => (v === '' || v == null ? undefined : v);

export const LibrarySearchParams = z.object({
  q: z.preprocess(emptyToUndef, z.string().max(200).optional()),
  docType: z.preprocess(emptyToUndef, z.enum(DOC_TYPE_CODES).optional()),
  category: z.preprocess(emptyToUndef, z.string().max(40).optional()),
  department: z.preprocess(emptyToUndef, z.string().max(40).optional()),
  tag: z.preprocess(emptyToUndef, z.string().max(MAX_TAG_LENGTH).optional()),
  owner: z.preprocess(emptyToUndef, z.string().max(60).optional()),
  updatedWithin: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.union([z.literal(7), z.literal(30), z.literal(90)]).optional()),
  sort: z.preprocess(emptyToUndef, z.enum(SORTS).default('updated')),
  limit: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().int().min(1).max(500).default(200)),
});
export type LibrarySearchParamsType = z.input<typeof LibrarySearchParams>;
export type LibrarySearchParamsParsed = z.output<typeof LibrarySearchParams>;

export interface FacetCount {
  value: string;
  count: number;
}

export interface LibrarySearchResult {
  items: LibraryDoc[];
  total: number; // 条件一致件数（limit 適用前）
  corpus: number; // 権限内で見える全件数
  tags: TagCount[]; // 権限内の全資料から数えたタグ（絞り込み前）
  facets: { docType: FacetCount[]; category: FacetCount[]; department: FacetCount[]; owner: FacetCount[] };
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

type DocRow = {
  id: string;
  title: string;
  category: string;
  department: string | null;
  url: string;
  note: string | null;
  tags: string | null;
  docType: string | null;
  ownerId: string | null;
  ownerName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function toLibraryDoc(d: DocRow): LibraryDoc {
  const docType = isDocType(d.docType) ? d.docType : null;
  return {
    id: d.id,
    title: d.title,
    category: d.category,
    department: d.department ?? '',
    url: d.url,
    note: d.note ?? '',
    tags: parseTags(d.tags),
    docType,
    docTypeLabel: docType ? DOC_TYPE_LABEL[docType] : '未分類',
    ownerName: d.ownerName ?? '',
    ownerId: d.ownerId,
    kind: docKind(d.url),
    host: host(d.url),
    updatedAt: d.updatedAt.toISOString(),
    createdAt: d.createdAt.toISOString(),
  };
}

/** 条件で絞り込んで並べ替える（純関数。テスト対象） */
export function filterDocs(docs: LibraryDoc[], p: LibrarySearchParamsParsed, now = new Date()): LibraryDoc[] {
  const terms = parseQuery(p.q);
  const tag = p.tag ? normalizeTag(p.tag).toLowerCase() : null;
  const owner = p.owner ? normalizeText(p.owner) : null;
  const since = p.updatedWithin ? now.getTime() - p.updatedWithin * 86_400_000 : null;
  const out = docs.filter((d) => {
    if (p.docType && d.docType !== p.docType) return false;
    if (p.category && d.category !== p.category) return false;
    if (p.department && d.department !== p.department) return false;
    if (tag && !d.tags.some((t) => t.toLowerCase() === tag)) return false;
    if (owner && !normalizeText(d.ownerName).includes(owner)) return false;
    if (since != null && new Date(d.updatedAt).getTime() < since) return false;
    return matchesQuery(d, terms);
  });
  if (p.sort === 'title') out.sort((a, b) => a.title.localeCompare(b.title, 'ja') || b.updatedAt.localeCompare(a.updatedAt));
  else out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title, 'ja'));
  return out;
}

function facet(docs: LibraryDoc[], pick: (d: LibraryDoc) => string): FacetCount[] {
  const m = new Map<string, number>();
  for (const d of docs) {
    const v = pick(d);
    if (!v) continue;
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'ja'));
}

/** 権限内で見える資料の where 句（機密種別は管理職以上のみ） */
export function visibilityWhere(level: Level) {
  if (canSeeConfidential(level)) return {};
  return { OR: [{ docType: null }, { docType: { notIn: [...CONFIDENTIAL_DOC_TYPES] } }] };
}

/**
 * 横断検索。actor の権限で見える資料だけを対象にする。
 * 件数は多くても数千件の想定なので、権限で絞った全件を取り出してメモリ上で語一致・並べ替えする（SQLite/Postgres 両対応）。
 */
export async function searchLibrary(params: LibrarySearchParamsType, actor: { level: Level }, now = new Date()): Promise<LibrarySearchResult> {
  const p = LibrarySearchParams.parse(params);
  const rows = await prisma.document.findMany({ where: visibilityWhere(actor.level), orderBy: { updatedAt: 'desc' }, take: 5000 });
  const all = rows.map(toLibraryDoc);
  const matched = filterDocs(all, p, now);
  return {
    items: matched.slice(0, p.limit),
    total: matched.length,
    corpus: all.length,
    tags: topTags(all),
    facets: {
      docType: facet(all, (d) => d.docType ?? ''),
      category: facet(all, (d) => d.category),
      department: facet(all, (d) => d.department),
      owner: facet(all, (d) => d.ownerName),
    },
  };
}

/** 権限内で1件取得（無い・見えない場合は null） */
export async function getLibraryDoc(id: string, actor: { level: Level }): Promise<LibraryDoc | null> {
  const row = await prisma.document.findFirst({ where: { id, ...visibilityWhere(actor.level) } });
  return row ? toLibraryDoc(row) : null;
}

// ---- 登録・編集の入力（Server Action から使う） ----
export const LibraryDocInput = DocumentInput.extend({
  category: z.enum(DOC_CATEGORIES, { message: 'カテゴリを選んでください' }),
  docType: z.preprocess(emptyToUndef, z.enum(DOC_TYPE_CODES, { message: '種別を選んでください' }).default('other')),
  tags: z.preprocess((v) => parseTags(typeof v === 'string' || Array.isArray(v) ? v : ''), z.array(z.string().min(1).max(MAX_TAG_LENGTH)).max(MAX_TAGS, `タグは${MAX_TAGS}個まで`)),
});
export type LibraryDocInputType = z.output<typeof LibraryDocInput>;

/** /api/pro/library の応答（DB検索＋Drive検索の結果） */
export interface LibraryApiResponse extends LibrarySearchResult {
  drive: DriveSearchResult;
}

// ---- Google Drive（任意。サービスアカウントで読み取り専用） ----
export interface DriveHit {
  id: string;
  name: string;
  mimeType: string;
  url: string;
  modifiedTime: string | null;
  kind: DocKind;
}
export type DriveSearchResult =
  | { status: 'unconfigured' }
  | { status: 'ok'; files: DriveHit[]; folderCount: number }
  | { status: 'error'; message: string };

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function readServiceAccount(): ServiceAccount | null {
  const b64 = process.env.GOOGLE_DRIVE_SA_JSON?.trim();
  if (!b64) return null;
  try {
    const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as Partial<ServiceAccount>;
    if (typeof json.client_email !== 'string' || typeof json.private_key !== 'string') return null;
    return { client_email: json.client_email, private_key: json.private_key };
  } catch {
    return null;
  }
}

function folderIds(): string[] {
  return (process.env.GOOGLE_DRIVE_FOLDER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Drive 横断検索が設定済みか（サービスアカウントJSONが読めること） */
export function driveConfigured(): boolean {
  return readServiceAccount() !== null;
}

function b64url(input: ArrayBuffer | Uint8Array | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input instanceof Uint8Array ? input : new Uint8Array(input));
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN [A-Z ]+-----/g, '').replace(/-----END [A-Z ]+-----/g, '').replace(/\s+/g, '');
  const buf = Buffer.from(body, 'base64');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/** RS256 で署名した JWT（Google OAuth2 の JWT bearer 用）。標準の WebCrypto（Node の crypto.subtle）で署名する */
export async function signJwtRS256(claims: Record<string, unknown>, privateKeyPem: string): Promise<string> {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claims));
  const data = `${header}.${payload}`;
  const key = await globalThis.crypto.subtle.importKey('pkcs8', pemToDer(privateKeyPem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await globalThis.crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, Buffer.from(data, 'utf8'));
  return `${data}.${b64url(sig)}`;
}

let tokenCache: { token: string; exp: number } | null = null;

async function driveAccessToken(sa: ServiceAccount): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp - 60 > nowSec) return tokenCache.token;
  const assertion = await signJwtRS256(
    {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: nowSec,
      exp: nowSec + 3600,
    },
    sa.private_key,
  );
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Google 認証に失敗しました（HTTP ${res.status}）`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error('Google 認証の応答にトークンがありません');
  tokenCache = { token: json.access_token, exp: nowSec + (json.expires_in ?? 3600) };
  return json.access_token;
}

/** Drive クエリ文字列のエスケープ（' と \ ） */
export function escapeDriveQuery(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** 検索語 → Drive API の q パラメータ。語ごとに name contains（AND）、指定フォルダ直下に限定、ゴミ箱除外 */
export function buildDriveQuery(q: string, folders: string[]): string {
  const terms = parseQuery(q).slice(0, 5);
  const parts = terms.map((t) => `name contains '${escapeDriveQuery(t)}'`);
  parts.push('trashed = false');
  if (folders.length) parts.push(`(${folders.map((f) => `'${escapeDriveQuery(f)}' in parents`).join(' or ')})`);
  return parts.join(' and ');
}

function driveKind(mimeType: string, url: string): DocKind {
  if (mimeType === 'application/vnd.google-apps.folder') return 'folder';
  if (mimeType === 'application/vnd.google-apps.document') return 'doc';
  if (mimeType === 'application/vnd.google-apps.spreadsheet') return 'sheet';
  if (mimeType === 'application/vnd.google-apps.presentation') return 'slide';
  if (mimeType === 'application/vnd.google-apps.form') return 'form';
  if (mimeType === 'application/pdf') return 'pdf';
  return docKind(url);
}

/** Drive でファイル名検索（未設定なら unconfigured。失敗しても例外にせず error を返す） */
export async function searchDrive(q: string, limit = 20): Promise<DriveSearchResult> {
  const sa = readServiceAccount();
  if (!sa) return { status: 'unconfigured' };
  const terms = parseQuery(q);
  const folders = folderIds();
  if (terms.length === 0) return { status: 'ok', files: [], folderCount: folders.length };
  try {
    const token = await driveAccessToken(sa);
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('q', buildDriveQuery(q, folders));
    url.searchParams.set('fields', 'files(id,name,mimeType,webViewLink,modifiedTime)');
    url.searchParams.set('pageSize', String(Math.min(Math.max(limit, 1), 100)));
    url.searchParams.set('orderBy', 'modifiedTime desc');
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('includeItemsFromAllDrives', 'true');
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!res.ok) return { status: 'error', message: `Drive API がエラーを返しました（HTTP ${res.status}）` };
    const json = (await res.json()) as { files?: { id: string; name: string; mimeType: string; webViewLink?: string; modifiedTime?: string }[] };
    const files: DriveHit[] = (json.files ?? []).map((f) => {
      const link = f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`;
      return { id: f.id, name: f.name, mimeType: f.mimeType, url: link, modifiedTime: f.modifiedTime ?? null, kind: driveKind(f.mimeType, link) };
    });
    return { status: 'ok', files, folderCount: folders.length };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : 'Drive 検索に失敗しました' };
  }
}
