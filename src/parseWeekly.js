// SNS / LP チームの「週次業務報告（文章）」を構造化データに変換するパーサー。
// 既存の売上日報パーサー（parseReport.js）と同じ思想で、チャットやドキュメントに
// 貼られる下記のような報告文を、集計・分析できる数値＋区分に変換する：
//
//   SNSチーム週次業務報告（7月21日～24日）
//   ■総括
//   ・合計20投稿（投稿予約含む）
//   ■投稿内訳（投稿予約含む）
//   ・メインアカウント：4投稿
//   ・ガジェティ（Instagram）：6投稿
//   ■スーツケース
//   実施内容
//   ・…
//   来週予定
//   ・…
//   ■MTG予定
//   ・…
//
// 議事録など「チーム週次報告」でない文章は team を判定できず null を返す（呼び出し側でスキップ）。

// カンマ・空白・単位を除いて数値を取り出す
function num(s) {
  if (s == null) return null;
  const m = String(s).replace(/[,，\s]/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// ヘッダー行（■/▪️ セクション、または 【…】 セクション）を判定する。
// マッチした場合はセクション名を返す。そうでなければ null。
function headerTitle(line) {
  // 記号の直後に付く異体字セレクタ(U+FE0F)も許容する（例: "▪️"）
  const bullet = line.match(/^\s*[■□▪▫◾◽●○◆]️?\s*(.+?)\s*$/);
  if (bullet) return bullet[1].trim();
  const bracket = line.match(/^\s*【\s*(.+?)\s*】/);
  if (bracket) return bracket[1].trim();
  return null;
}

// 本文を「■/【】ヘッダー」で区切り、{title, body}[] のセクション配列にする。
function splitSections(text) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  let cur = null;
  for (const line of lines) {
    const title = headerTitle(line);
    if (title !== null) {
      cur = { title, lines: [] };
      // 【来週予定】タスクA のように、【】ヘッダー行に本文が続く書き方にも対応
      // （■ヘッダーは行全体が見出しなので本文へは入れない）
      const inline = /^\s*【/.test(line) ? line.replace(/^\s*【[^】]*】/, '').trim() : '';
      if (inline) cur.lines.push(inline);
      sections.push(cur);
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  return sections.map((s) => ({ title: s.title, body: s.lines.join('\n').trim() }));
}

// 「実施内容 … 来週予定 …」を含む本文を done / next に分ける。
// マーカーが無ければ全文を done として返す。
function splitDoneNext(body) {
  const lines = body.split(/\r?\n/);
  let mode = 'done';
  const done = [];
  const next = [];
  for (const line of lines) {
    const t = line.trim();
    if (/^実施内容[:：]?$/.test(t)) { mode = 'done'; continue; }
    if (/^(来週予定|今後の予定|来週の予定)[:：]?$/.test(t)) { mode = 'next'; continue; }
    (mode === 'next' ? next : done).push(line);
  }
  return { done: done.join('\n').trim(), next: next.join('\n').trim() };
}

// 投稿内訳セクションから「・アカウント名：N投稿」を取り出す。
function parsePosts(body) {
  const posts = [];
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^\s*[・･]?\s*(.+?)\s*[:：]\s*([\d,]+)\s*投稿/);
    if (m) posts.push({ account: m[1].trim(), count: num(m[2]) });
  }
  return posts;
}

// タイトルの種類を判定（特別扱いするセクションの振り分け用）
const isSummary = (t) => /総括|サマリ/.test(t);
const isPosts = (t) => /投稿内訳/.test(t);
const isMtg = (t) => /MTG|ミーティング|打ち合わせ予定|会議予定/i.test(t);
const isNextWeek = (t) => /^来週(の)?予定$|今後の予定|来週やること/.test(t);

// 期間「7月21日～24日」→ { start, end }（ISO文字列）。年は options.year を使う。
function parsePeriod(text, year) {
  const m = text.match(/(\d{1,2})月(\d{1,2})日\s*[～〜~\-–—]\s*(?:(\d{1,2})月)?(\d{1,2})日/);
  if (!m) return { start: null, end: null };
  const sMonth = Number(m[1]);
  const sDay = Number(m[2]);
  const eMonth = m[3] ? Number(m[3]) : sMonth;
  const eDay = Number(m[4]);
  const iso = (mo, d) => (year ? `${year}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null);
  return { start: iso(sMonth, sDay), end: iso(eMonth, eDay) };
}

// チーム判定：SNS / LP。どちらも見つからなければ null（＝週次報告ではない）。
function detectTeam(text) {
  if (/SNS\s*チーム/i.test(text)) return 'SNS';
  if (/LP\s*チーム/i.test(text)) return 'LP';
  return null;
}

// options: { year?: number }  年は報告文に含まれないため呼び出し側から渡す。
export function parseWeekly(text, options = {}) {
  if (!text || typeof text !== 'string') return null;

  const team = detectTeam(text);
  if (!team) return null; // 議事録などはスキップ

  // 年：明示（2026年）があれば優先、なければ options.year
  const yearInText = text.match(/(\d{4})年/);
  const year = yearInText ? Number(yearInText[1]) : options.year ?? null;

  const { start, end } = parsePeriod(text, year);

  const out = {
    team,
    period_start: start,
    period_end: end,
    posts_total: null,
    posts: [],
    summary: '',
    next_week: '',
    mtg: '',
    sections: [],
  };

  for (const sec of splitSections(text)) {
    const { title, body } = sec;
    if (!title) continue;

    if (isSummary(title)) {
      out.summary = body;
      const tm = body.match(/合計\s*([\d,]+)\s*投稿/) || text.match(/合計\s*([\d,]+)\s*投稿/);
      if (tm) out.posts_total = num(tm[1]);
      continue;
    }
    if (isPosts(title)) {
      out.posts = parsePosts(body);
      if (out.posts_total == null && out.posts.length) {
        out.posts_total = out.posts.reduce((a, p) => a + (p.count || 0), 0);
      }
      continue;
    }
    if (isMtg(title)) {
      out.mtg = body;
      continue;
    }
    if (isNextWeek(title)) {
      out.next_week = out.next_week ? `${out.next_week}\n${body}` : body;
      continue;
    }

    // それ以外は商品・カテゴリ別セクションとして done/next に分解
    const { done, next } = splitDoneNext(body);
    out.sections.push({ title, done, next });
  }

  // 投稿内訳が無くても合計投稿数だけは拾えるように保険
  if (out.posts_total == null) {
    const tm = text.match(/合計\s*([\d,]+)\s*投稿/);
    if (tm) out.posts_total = num(tm[1]);
  }

  return out;
}
