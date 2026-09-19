import { describe, expect, it } from 'vitest';
import { INTEGRATION_LABELS, SITE_MAP, integrationLabel, siteMapCounts, siteMapFor } from '../site-map';
import { PRO_NAV } from '@/components/pro-nav';

const STANDARD_MENU = ['/', '/sales', '/ads', '/ads/cpa', '/products', '/purchasing', '/inventory', '/targets', '/tasks', '/documents', '/proposals', '/reports', '/integrations', '/masters'];

describe('使える範囲マップ（src/lib/site-map.ts）の整合', () => {
  it('href はすべてユニーク', () => {
    const hrefs = SITE_MAP.map((e) => e.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
  it('status は ok / partial / off のいずれか、mode は standard / pro のいずれか', () => {
    for (const e of SITE_MAP) {
      expect(['ok', 'partial', 'off']).toContain(e.status);
      expect(['standard', 'pro']).toContain(e.mode);
      expect(e.source.length).toBeGreaterThan(0);
    }
  });
  it('needs の紐付け番号は docs/integrations.md 由来の一覧（INTEGRATION_LABELS）にある', () => {
    for (const e of SITE_MAP) for (const n of e.needs) expect(INTEGRATION_LABELS[n], `${e.href} の ${n}`).toBeDefined();
    expect(integrationLabel('A7')).toMatch(/^A7 在庫報告\(35\)/);
    expect(integrationLabel('Z9')).toBe('Z9');
  });
  it('STANDARD はサイドバーの14画面、PRO は pro-nav.ts の並び（/guide 自身を除く）と一致する', () => {
    expect(siteMapFor('standard').map((e) => e.href)).toEqual(STANDARD_MENU);
    expect(siteMapFor('pro').map((e) => e.href)).toEqual(PRO_NAV.map((i) => i.href).filter((h) => h !== '/guide'));
    expect(SITE_MAP.some((e) => e.href === '/guide')).toBe(false);
  });
  it('未接続（off）の画面には必要な紐付けが必ず書いてある', () => {
    for (const e of SITE_MAP.filter((x) => x.status === 'off')) expect(e.needs.length, e.href).toBeGreaterThan(0);
    const c = siteMapCounts('standard');
    expect(c.ok + c.partial + c.off).toBe(14);
  });
});
