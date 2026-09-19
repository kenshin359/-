// 「今どこまで使えるか」の地図（/guide）。状態は山本が更新する定数。画面側で判定・推測しない。
// 紐付け番号（needs）は docs/integrations.md の # が正。ここに無い番号は使わない（テストで検査）。

export type SiteMode = 'standard' | 'pro';
export type SiteStatus = 'ok' | 'partial' | 'off';

export interface SiteMapEntry {
  href: string;
  label: string;
  mode: SiteMode;
  status: SiteStatus;
  /** 画面の数字の出どころ（DBテーブル・取込元） */
  source: string;
  /** 必要な紐付け（docs/integrations.md の番号。例 'A7'） */
  needs: string[];
  note?: string;
}

export const SITE_STATUS_JA: Record<SiteStatus, { label: string; mark: string; cls: string }> = {
  ok: { label: '稼働', mark: '✅', cls: 'bg-emerald-100 text-emerald-800' },
  partial: { label: '一部', mark: '🟡', cls: 'bg-amber-100 text-amber-800' },
  off: { label: '未接続', mark: '⬜', cls: 'bg-slate-100 text-slate-600' },
};

/** 紐付け番号の短い説明（docs/integrations.md より。番号と文言を変えるときは同ファイルを先に直す） */
export const INTEGRATION_LABELS: Record<string, string> = {
  A3: '毎朝の自動取込（GitHub Actions 11:20・INGEST_SECRET 登録待ち）',
  A4: 'Kintone 毎朝KPI(30) 直接読み取り（APIトークン）',
  A5: 'Kintone タスク管理(38) 双方向同期（APIトークン）',
  A6: '原価率（仕入原価）→ 粗利',
  A7: '在庫報告(35) → 在庫金額（Kintoneトークン受領後に取込）',
  A8: 'イベントカレンダー → 日別目標',
  A9: '帰属売上（ROAS）— 楽天RPP／Amazon広告／Meta のAPI接続',
  B3: '社員アカウントと権限レベル（名簿の受領）',
  C3: 'LINE公式アカウント（チャネルシークレット／アクセストークン）',
  C5: 'AIアシスタント（Claude API キー）',
  C6: 'Google Drive API（資料庫2.0 の名前検索・任意）',
  D2: '社内アンケート → 改善ボード（E1〜E6 の回答後に着手）',
  D3: 'SNS投稿スケジュール（シートの共有設定）',
};

export const SITE_MAP: readonly SiteMapEntry[] = [
  // ---- STANDARD（サイドバーの14項目と同じ並び） ----
  { href: '/', label: 'ダッシュボード', mode: 'standard', status: 'partial', source: '経営サマリーはデモ表示。実売上は PRO（/pro）の kpiDaily', needs: [], note: '実数を見るときは右上で PRO に切替' },
  { href: '/sales', label: '売上・利益', mode: 'standard', status: 'ok', source: 'kpiDaily・productSalesDaily（Kintone 売上明細(29) 取込）', needs: ['A6'], note: '粗利のみ「未取得（原価率の入力待ち）」' },
  { href: '/ads', label: '広告分析', mode: 'standard', status: 'ok', source: 'kpiDaily の広告費列（広告費レポート 11:02 取込）', needs: ['A9'], note: 'ROAS・CPC は未取得' },
  { href: '/ads/cpa', label: '合算CPA管理', mode: 'standard', status: 'ok', source: 'cpaDaily（合算CPA取込）', needs: [] },
  { href: '/products', label: '商品分析', mode: 'standard', status: 'ok', source: 'productSalesDaily（Kintone 売上明細(29) 日別×媒体×商品）', needs: [] },
  { href: '/purchasing', label: '新商品・仕入れ', mode: 'standard', status: 'off', source: 'PurchaseOrder／PoLine／Supplier（demo以外は空）', needs: ['A7'], note: '入荷予定の登録は Kintone 在庫報告(35) が正' },
  { href: '/inventory', label: '在庫管理', mode: 'standard', status: 'off', source: 'InventoryMove／Sku／Warehouse（demo以外は空）', needs: ['A7'], note: 'A7 は A4（Kintoneトークン）の後に着手' },
  { href: '/targets', label: '目標・予実管理', mode: 'standard', status: 'ok', source: 'target（月間目標）・Setting targets.weights（イベント加重）・kpiDaily', needs: [] },
  { href: '/tasks', label: 'タスク管理', mode: 'standard', status: 'partial', source: 'ローカルDB（Kintone(38) 未接続の間）', needs: ['A5'] },
  { href: '/documents', label: '資料庫', mode: 'standard', status: 'ok', source: 'Document（リンク登録）', needs: [] },
  { href: '/proposals', label: 'AI改善提案', mode: 'standard', status: 'partial', source: 'proposal（demo除外）＋アラート（listOpenAlerts）', needs: ['C5'], note: 'LLM提案は未接続。ルール提案はアラートと統合中' },
  { href: '/reports', label: 'レポート', mode: 'standard', status: 'ok', source: 'report（PRO 報告）・kpiDaily（日別売上CSV）・定時レポート一覧', needs: [] },
  { href: '/integrations', label: 'データ連携設定', mode: 'standard', status: 'ok', source: '環境変数の接続状態（未接続は未接続と表示）', needs: [] },
  { href: '/masters', label: '各種マスター管理', mode: 'standard', status: 'partial', source: 'マスター各テーブルの件数（編集できるのはユーザー管理のみ）', needs: [] },
  // ---- PRO（pro-nav.ts と同じ並び。/guide 自身は除く） ----
  { href: '/pro', label: '経営ダッシュボード', mode: 'pro', status: 'ok', source: 'kpiDaily（日別×媒体の売上・広告費）', needs: [] },
  { href: '/pro/today', label: '今日やること', mode: 'pro', status: 'ok', source: 'タスク・アラート・KPI（DB）', needs: [] },
  { href: '/pro/alerts', label: 'アラート', mode: 'pro', status: 'ok', source: 'Alert（ルール判定）', needs: [] },
  { href: '/pro/teams', label: '部署', mode: 'pro', status: 'ok', source: 'Team・Task', needs: [] },
  { href: '/pro/tasks', label: 'タスク2.0', mode: 'pro', status: 'partial', source: 'Task（ローカルDB）', needs: ['A5'] },
  { href: '/pro/kpi', label: 'KPI', mode: 'pro', status: 'ok', source: 'kpiDaily・KpiValue', needs: [] },
  { href: '/pro/creative', label: '制作依頼', mode: 'pro', status: 'ok', source: 'Googleスプレッドシート「画像作成依頼シート」（D1 済）', needs: [] },
  { href: '/pro/sns', label: 'SNS投稿', mode: 'pro', status: 'partial', source: 'Googleスプレッドシート「SNS投稿スケジュール（Libetee）」', needs: ['D3'] },
  { href: '/pro/reports', label: '報告', mode: 'pro', status: 'ok', source: 'Report（日報・週報・中間報告）', needs: [] },
  { href: '/pro/library', label: '資料庫2.0', mode: 'pro', status: 'ok', source: 'Document（リンク登録）', needs: ['C6'], note: 'Drive の名前検索は任意。無くてもリンク登録で運用可' },
  { href: '/pro/survey', label: '社内アンケート', mode: 'pro', status: 'ok', source: 'Googleスプレッドシート「社内アンケート」（回答本文は保存せずテーマ別件数のみ）', needs: [], note: '代表・取締役・管理職のみ。シート（リンク共有）を5分ごとに読み取り' },
  { href: '/pro/people', label: '社員・組織', mode: 'pro', status: 'partial', source: 'User・Team', needs: ['B3'] },
  { href: '/pro/line', label: 'LINE監査役', mode: 'pro', status: 'off', source: 'LineGroup・LineMessage（Webhook・抽出・追いかけは実装済み）', needs: ['C3'] },
  { href: '/pro/line-support', label: 'LINE顧客対応', mode: 'pro', status: 'partial', source: 'LINE公式アカウント（AI自動応答）の会話ログ。環境変数 LINE_SUPPORT_CHANNEL_SECRET／LINE_SUPPORT_CHANNEL_ACCESS_TOKEN・ANTHROPIC_API_KEY', needs: ['C5'], note: '接続状態はその画面の上部が環境変数から判定して表示（未設定は未接続）' },
  { href: '/pro/settings', label: 'PRO設定', mode: 'pro', status: 'ok', source: 'Setting', needs: [] },
];

export function siteMapFor(mode: SiteMode): SiteMapEntry[] {
  return SITE_MAP.filter((e) => e.mode === mode);
}

export function siteMapCounts(mode: SiteMode): Record<SiteStatus, number> {
  const c: Record<SiteStatus, number> = { ok: 0, partial: 0, off: 0 };
  for (const e of siteMapFor(mode)) c[e.status] += 1;
  return c;
}

/** 紐付け番号 → 「A7 在庫報告(35) → 在庫金額…」の表示文 */
export function integrationLabel(code: string): string {
  const l = INTEGRATION_LABELS[code];
  return l ? `${code} ${l}` : code;
}
