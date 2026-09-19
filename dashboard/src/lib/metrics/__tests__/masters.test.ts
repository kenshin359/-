import { describe, expect, it } from 'vitest';
import { countMasters, isDemoMaster, MASTER_KINDS } from '../masters';

describe('マスター件数（実データ／デモの内訳。デモ判定は prisma/seed.ts の規則）', () => {
  it('seed のデモ行を判定する: demo- コード、main 倉庫、sup-a 仕入先、@demo.local、名前「デモ…」', () => {
    expect(isDemoMaster('series', { code: 'demo-sc-m', name: 'デモスーツケースM' })).toBe(true);
    expect(isDemoMaster('sku', { code: 'demo-sc-m-BK', name: 'デモスーツケースM BK' })).toBe(true);
    expect(isDemoMaster('warehouse', { code: 'main', name: 'メイン倉庫' })).toBe(true);
    expect(isDemoMaster('supplier', { code: 'sup-a', name: 'デモ仕入先A' })).toBe(true);
    expect(isDemoMaster('user', { email: 'admin@demo.local', name: '管理者デモ' })).toBe(true);
    expect(isDemoMaster('supplier', { code: 'x-1', name: 'デモ工場' })).toBe(true);
  });

  it('業務上の実コードは実データ扱い: rakuten/amazon/own、rpp 等、fba/cs 倉庫、実メール', () => {
    expect(isDemoMaster('channel', { code: 'rakuten', name: '楽天' })).toBe(false);
    expect(isDemoMaster('media', { code: 'rpp', name: '楽天RPP' })).toBe(false);
    expect(isDemoMaster('warehouse', { code: 'fba', name: 'FBA' })).toBe(false);
    expect(isDemoMaster('warehouse', { code: 'cs', name: 'CS倉庫' })).toBe(false);
    expect(isDemoMaster('user', { email: 'kitano@libetee.net', name: '北野' })).toBe(false);
    // 'main' はユーザー判定には使わない（email のみ）
    expect(isDemoMaster('user', { code: 'main', email: 'a@libetee.net' })).toBe(false);
  });

  it('件数は total = real + demo。0件でも壊れない', () => {
    const c = countMasters('sku', [
      { code: 'demo-sc-s-BK', name: 'デモスーツケースS BK' },
      { code: 'demo-sc-s-SV', name: 'デモスーツケースS SV' },
      { code: '101', name: 'スーツケースS' },
    ]);
    expect(c).toEqual({ kind: 'sku', label: 'SKU', total: 3, real: 1, demo: 2 });
    const zero = countMasters('supplier', []);
    expect(zero).toMatchObject({ total: 0, real: 0, demo: 0 });
    expect(MASTER_KINDS).toHaveLength(8);
  });
});
