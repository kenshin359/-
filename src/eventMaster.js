// イベントマスタ ── 楽天・Amazon の販促イベントカレンダー。
//
// 予想チーム（forecast）と分析チーム（analyze）が共通で参照する「暦」。
// 売上は平常日とイベント日でまったく別物なので、日付を必ずこの暦で色分けしてから
// 予想・分析する。これが「次のイベント日に売上がいくら伸びるか」を出す土台になる。
//
// 考え方：
//  - 楽天／Amazon の主要イベントは毎月・毎季ほぼ定期で回ってくる（下の RECURRING）。
//  - 具体的な開催日は各モールの告知で毎回変わるため、確定日は FIXED に手で足す。
//    （kintone の各日レコードに event_platform / event_name を入れれば実績と自動で紐づく）
//  - classifyDate() は「その日がイベント日か、平常日か」をベストエフォートで判定する。

// ── 定期イベント（毎月/毎季のパターン。開催傾向の把握用）──
export const RECURRING = {
  楽天: [
    { name: 'お買い物マラソン', cadence: '月1〜2回', typicalDays: 7, note: '複数ショップ買い回りでポイント倍率UP。楽天の主戦場。' },
    { name: 'スーパーSALE', cadence: '3・6・9・12月', typicalDays: 6, note: '年4回の最大級。半額商品と買い回り。準備は2週間前から。' },
    { name: '5と0のつく日', cadence: '毎月 5/10/15/20/25/30日', typicalDays: 1, note: 'エントリーでポイント+。広告を寄せる小ピーク。' },
    { name: 'ワンダフルデー', cadence: '毎月1日', typicalDays: 1, note: '月初のポイントイベント。' },
    { name: '楽天イーグルス感謝祭', cadence: '不定期', typicalDays: 3, note: '球団勝利連動。突発的な上振れ要因。' },
  ],
  Amazon: [
    { name: 'プライムデー', cadence: '7月頃', typicalDays: 2, note: '年間最大。プライム会員向け。在庫とFBA納品を最優先で。' },
    { name: 'プライム感謝祭', cadence: '10月頃', typicalDays: 2, note: '秋の大型セール。' },
    { name: 'ブラックフライデー', cadence: '11月下旬', typicalDays: 6, note: 'サイバーマンデーと連続。年末商戦の起点。' },
    { name: 'タイムセール祭り', cadence: '月1回・週末中心', typicalDays: 3, note: 'ポイントアップキャンペーン併催が多い。' },
    { name: '新生活セール', cadence: '3月', typicalDays: 5, note: '春の需要期。' },
  ],
};

// ── 確定イベント（実際の開催日。分かり次第ここに追記する）──
// 例:
//   { platform: '楽天',   name: 'お買い物マラソン', start: '2026-08-04', end: '2026-08-11' },
//   { platform: 'Amazon', name: 'プライムデー',     start: '2026-07-15', end: '2026-07-16' },
export const FIXED = [
  // ここに今後の確定日程を足していく（社長 or 参謀が告知を見て登録）
];

// ── 日付ユーティリティ ──────────────────────────────
const toDate = (s) => {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const ymd = (dt) =>
  `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;

// 「5と0のつく日」判定
const isGotoubi = (day) => day % 5 === 0;

// その日が FIXED のイベント期間に入っているか
function matchFixed(dateStr) {
  const t = toDate(dateStr).getTime();
  const hits = [];
  for (const e of FIXED) {
    const s = toDate(e.start).getTime();
    const en = toDate(e.end || e.start).getTime();
    if (t >= s && t <= en) hits.push(e);
  }
  return hits;
}

// イベント名を「種別コード」に正規化する。
// 予想の倍率は種別ごとにまったく違う（マラソン ≠ 5と0のつく日 ≠ スーパーSALE）ので、
// フリーテキストのイベント名も、パターン推定も、必ずこの関数で同じ種別に畳む。
// 戻り値の型コード（例）: '楽天_お買い物マラソン' / '楽天_スーパーSALE' / 'Amazon_プライムデー'
export function categorizeEvent(platform, name = '') {
  const s = String(name);
  const p = platform || '';
  if (p === '楽天' || /楽天/.test(s)) {
    if (/マラソン/.test(s)) return '楽天_お買い物マラソン';
    if (/スーパー\s*SALE|スーパーSALE|\bSS\b|スーパーセール/i.test(s)) return '楽天_スーパーSALE';
    if (/5と0|５と０|5・0|ゼロと5|5と０/.test(s)) return '楽天_5と0のつく日';
    if (/ワンダフル/.test(s)) return '楽天_ワンダフルデー';
    if (/イーグルス|感謝祭|優勝/.test(s)) return '楽天_イーグルス感謝祭';
    if (p === '楽天') return '楽天_その他';
  }
  if (p === 'Amazon' || /Amazon|アマゾン/i.test(s)) {
    if (/プライムデー|prime\s*day/i.test(s)) return 'Amazon_プライムデー';
    if (/プライム感謝祭/.test(s)) return 'Amazon_プライム感謝祭';
    if (/ブラックフライデー|black\s*friday|サイバーマンデー/i.test(s)) return 'Amazon_ブラックフライデー';
    if (/タイムセール祭|タイムセール/.test(s)) return 'Amazon_タイムセール祭り';
    if (/新生活/.test(s)) return 'Amazon_新生活セール';
    if (p === 'Amazon') return 'Amazon_その他';
  }
  return p ? `${p}_その他` : 'その他';
}

// 日付を「イベント日 / 平常日」に色分けする。
// 戻り値: { date, isEvent, platforms:[], types:[], events:[{platform,name,type,source}] }
//   source = 'fixed'（確定日程に一致） | 'pattern'（定期パターンに合致）
export function classifyDate(dateStr) {
  const events = [];

  // 1) 確定日程が最優先
  for (const e of matchFixed(dateStr)) {
    events.push({ platform: e.platform, name: e.name, source: 'fixed' });
  }

  // 2) 定期パターン（確定が無い日の補助推定）
  if (!events.length) {
    const dt = toDate(dateStr);
    const day = dt.getUTCDate();
    const month = dt.getUTCMonth() + 1;
    if (isGotoubi(day)) events.push({ platform: '楽天', name: '5と0のつく日', source: 'pattern' });
    if (day === 1) events.push({ platform: '楽天', name: 'ワンダフルデー', source: 'pattern' });
    if ([3, 6, 9, 12].includes(month) && day >= 4 && day <= 11) {
      events.push({ platform: '楽天', name: 'スーパーSALE(推定期間)', source: 'pattern' });
    }
  }

  for (const e of events) e.type = categorizeEvent(e.platform, e.name);
  const platforms = [...new Set(events.map((e) => e.platform))];
  const types = [...new Set(events.map((e) => e.type))];
  return { date: dateStr, isEvent: events.length > 0, platforms, types, events };
}

// 基準日から未来N日ぶんの暦を返す（予想チームが「次のイベント日」を探すのに使う）
export function calendarFrom(startStr, days = 45) {
  const out = [];
  let dt = toDate(startStr);
  for (let i = 0; i < days; i++) {
    out.push(classifyDate(ymd(dt)));
    dt = new Date(dt.getTime() + 86400000);
  }
  return out;
}

// 基準日以降で「次にイベントが来る日」を返す（無ければ null）
export function nextEventDay(startStr, days = 60) {
  return calendarFrom(startStr, days).find((d) => d.isEvent) || null;
}
