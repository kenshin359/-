import { describe, expect, it } from 'vitest';
import {
  buildDriveQuery,
  canSeeDocType,
  escapeDriveQuery,
  filterDocs,
  LibraryDocInput,
  LibrarySearchParams,
  matchesQuery,
  normalizeTag,
  parseQuery,
  parseTags,
  serializeTags,
  toLibraryDoc,
  topTags,
  visibilityWhere,
  type LibraryDoc,
} from '../library';

const base: LibraryDoc = {
  id: '1',
  title: '営業研修資料',
  category: '営業・EC',
  department: '社長室',
  url: 'https://docs.google.com/document/d/x',
  note: '新人向け',
  tags: ['研修', '営業'],
  docType: 'manual',
  docTypeLabel: 'マニュアル',
  ownerName: '北野 拳慎',
  ownerId: 'u1',
  kind: 'doc',
  host: 'docs.google.com',
  updatedAt: '2026-09-17T00:00:00.000Z',
  createdAt: '2026-09-01T00:00:00.000Z',
};

describe('parseQuery（NFKC・空白区切り・重複除去）', () => {
  it('全角空白・全角英数を正規化して語に分ける', () => {
    expect(parseQuery('研修　ＣＳ  cs')).toEqual(['研修', 'cs']);
  });
  it('空や空白だけなら空配列', () => {
    expect(parseQuery('')).toEqual([]);
    expect(parseQuery('   ')).toEqual([]);
    expect(parseQuery(null)).toEqual([]);
  });
});

describe('matchesQuery（全語 AND）', () => {
  it('資料名・メモ・タグ・部署・登録者・種別のどれかに全語が含まれれば一致', () => {
    expect(matchesQuery(base, parseQuery('研修 北野'))).toBe(true);
    expect(matchesQuery(base, parseQuery('マニュアル 社長室'))).toBe(true);
    expect(matchesQuery(base, parseQuery('新人'))).toBe(true);
  });
  it('1語でも含まれなければ不一致', () => {
    expect(matchesQuery(base, parseQuery('研修 広告'))).toBe(false);
  });
  it('語が無ければ常に一致', () => {
    expect(matchesQuery(base, [])).toBe(true);
  });
  it('半角カナ・全角英字も NFKC で一致する', () => {
    const d = { ...base, title: 'ﾚﾋﾞｭｰ返信テンプレート', tags: ['ＦＡＱ'] };
    expect(matchesQuery(d, parseQuery('レビュー faq'))).toBe(true);
  });
});

describe('タグ utilities', () => {
  it('parseTags: カンマ・読点・改行で分割し、空・重複（大小文字無視）を除く', () => {
    expect(parseTags('研修, 営業、営業 ,,\nFAQ,faq')).toEqual(['研修', '営業', 'FAQ']);
    expect(parseTags(null)).toEqual([]);
    expect(parseTags(['a', ' a ', 'b'])).toEqual(['a', 'b']);
  });
  it('normalizeTag: 区切り文字を落とし、長さを制限する', () => {
    expect(normalizeTag(' 楽天|SALE ')).toBe('楽天 SALE');
    expect(normalizeTag('x'.repeat(50))).toHaveLength(30);
  });
  it('serializeTags: 保存形式はカンマ区切り、空なら null', () => {
    expect(serializeTags(['研修', '営業'])).toBe('研修,営業');
    expect(serializeTags([])).toBeNull();
    expect(serializeTags(['', ' '])).toBeNull();
  });
  it('topTags: 件数の多い順（同数は五十音順）', () => {
    const docs = [{ tags: ['営業', '研修'] }, { tags: ['研修'] }, { tags: ['広告'] }];
    expect(topTags(docs)).toEqual([
      { tag: '研修', count: 2 },
      { tag: '営業', count: 1 },
      { tag: '広告', count: 1 },
    ]);
    expect(topTags(docs, 1)).toHaveLength(1);
  });
});

describe('filterDocs（条件・並び順）', () => {
  const now = new Date('2026-09-18T03:00:00Z');
  const docs: LibraryDoc[] = [
    base,
    { ...base, id: '2', title: '広告レポート', category: '広告', department: '広告', tags: ['広告', '月次'], docType: 'ad', docTypeLabel: '広告資料', ownerName: '角南', updatedAt: '2026-06-01T00:00:00.000Z' },
    { ...base, id: '3', title: '雇用契約書テンプレ', category: '総務・管理', department: '人事・管理', tags: [], docType: 'contract', docTypeLabel: '契約書', updatedAt: '2026-09-10T00:00:00.000Z' },
  ];
  const p = (over: Partial<Parameters<typeof LibrarySearchParams.parse>[0]>) => LibrarySearchParams.parse({ ...over });

  it('種別・カテゴリ・部署・タグ・登録者で絞れる', () => {
    expect(filterDocs(docs, p({ docType: 'ad' }), now).map((d) => d.id)).toEqual(['2']);
    expect(filterDocs(docs, p({ category: '総務・管理' }), now).map((d) => d.id)).toEqual(['3']);
    expect(filterDocs(docs, p({ department: '社長室' }), now).map((d) => d.id)).toEqual(['1']);
    expect(filterDocs(docs, p({ tag: '月次' }), now).map((d) => d.id)).toEqual(['2']);
    expect(filterDocs(docs, p({ owner: '角南' }), now).map((d) => d.id)).toEqual(['2']);
  });
  it('更新日（N日以内）で絞れる', () => {
    expect(filterDocs(docs, p({ updatedWithin: 7 }), now).map((d) => d.id)).toEqual(['1']);
    expect(filterDocs(docs, p({ updatedWithin: 30 }), now).map((d) => d.id)).toEqual(['1', '3']);
    expect(filterDocs(docs, p({ updatedWithin: 90 }), now)).toHaveLength(2);
  });
  it('検索語と条件は AND', () => {
    expect(filterDocs(docs, p({ q: '広告', docType: 'manual' }), now)).toHaveLength(0);
    expect(filterDocs(docs, p({ q: '契約' }), now).map((d) => d.id)).toEqual(['3']);
  });
  it('並び順: 既定は更新が新しい順、title は資料名順', () => {
    expect(filterDocs(docs, p({}), now).map((d) => d.id)).toEqual(['1', '3', '2']);
    const titled = [
      { ...base, id: 'b', title: 'い 資料' },
      { ...base, id: 'a', title: 'あ 資料', updatedAt: '2026-01-01T00:00:00.000Z' },
      { ...base, id: 'c', title: 'う 資料' },
    ];
    expect(filterDocs(titled, p({ sort: 'title' }), now).map((d) => d.id)).toEqual(['a', 'b', 'c']);
  });
  it('LibrarySearchParams: 空文字は未指定、不正な値は拒否', () => {
    expect(LibrarySearchParams.parse({ q: '', docType: '', updatedWithin: '30' })).toMatchObject({ q: undefined, docType: undefined, updatedWithin: 30, sort: 'updated', limit: 200 });
    expect(LibrarySearchParams.safeParse({ docType: 'salary' }).success).toBe(false);
    expect(LibrarySearchParams.safeParse({ updatedWithin: '5' }).success).toBe(false);
  });
});

describe('機密種別の可視性（人事資料・契約書は管理職以上）', () => {
  it('canSeeDocType', () => {
    expect(canSeeDocType('staff', 'hr')).toBe(false);
    expect(canSeeDocType('leader', 'contract')).toBe(false);
    expect(canSeeDocType('manager', 'hr')).toBe(true);
    expect(canSeeDocType('ceo', 'contract')).toBe(true);
    expect(canSeeDocType('staff', 'manual')).toBe(true);
    expect(canSeeDocType('staff', null)).toBe(true);
  });
  it('visibilityWhere: 一般社員には where で落とす（null 種別は見える）', () => {
    expect(visibilityWhere('manager')).toEqual({});
    expect(visibilityWhere('staff')).toEqual({ OR: [{ docType: null }, { docType: { notIn: ['hr', 'contract'] } }] });
  });
});

describe('toLibraryDoc / LibraryDocInput', () => {
  it('DB行 → 画面用（タグ分割・種別ラベル・未知の種別は未分類）', () => {
    const row = {
      id: 'x', title: 't', category: '広告', department: null, url: 'https://drive.google.com/drive/folders/abc', note: null,
      tags: '広告, 月次', docType: 'bogus', ownerId: null, ownerName: null, createdAt: new Date('2026-09-01T00:00:00Z'), updatedAt: new Date('2026-09-02T00:00:00Z'),
    };
    const d = toLibraryDoc(row);
    expect(d.tags).toEqual(['広告', '月次']);
    expect(d.docType).toBeNull();
    expect(d.docTypeLabel).toBe('未分類');
    expect(d.kind).toBe('folder');
    expect(d.department).toBe('');
  });
  it('入力: tags はカンマ文字列から配列へ、docType 未指定は other、http は拒否', () => {
    const ok = LibraryDocInput.parse({ title: 't', category: '広告', department: '', url: 'https://example.com/a', note: '', docType: '', tags: '広告,月次,広告' });
    expect(ok.docType).toBe('other');
    expect(ok.tags).toEqual(['広告', '月次']);
    expect(LibraryDocInput.safeParse({ title: 't', category: '広告', url: 'http://example.com', docType: 'ad', tags: '' }).success).toBe(false);
    expect(LibraryDocInput.safeParse({ title: 't', category: '広告', url: 'https://example.com', docType: 'salary', tags: '' }).success).toBe(false);
  });
});

describe('Drive クエリ', () => {
  it('語ごとに name contains（AND）＋ ゴミ箱除外 ＋ フォルダ限定', () => {
    expect(buildDriveQuery('研修 CS', ['f1', 'f2'])).toBe("name contains '研修' and name contains 'cs' and trashed = false and ('f1' in parents or 'f2' in parents)");
    expect(buildDriveQuery('a', [])).toBe("name contains 'a' and trashed = false");
  });
  it("' と \\ をエスケープする", () => {
    expect(escapeDriveQuery("it's \\ x")).toBe("it\\'s \\\\ x");
  });
});
