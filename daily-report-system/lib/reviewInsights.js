// ============================================================
//  レビューから「商品改良のタネ」を取り出す
// ------------------------------------------------------------
//  「満足度が高い／低い」で止めず、
//  **どの部位が、どう不満なのか**まで降ろします。
//
//  やっていること:
//   ① レビュー本文を文単位に割る
//   ② 不満・要望を示す言い回しを含む文だけを拾う
//   ③ その文がどの部位の話かを判定する
//   ④ 部位ごとに件数・平均★・実際の声を集計する
//
//  ★AIは使いません。すべて辞書と規則による集計です（費用ゼロ・再現可能）。
//  ★「言い切れないこと」は言い切らないため、判定できない文は捨てます。
// ============================================================

/** 商品の部位。上から順に判定するので、具体的なものを先に置く */
export const PARTS = [
  { key: 'front_open', label: 'フロントオープン', re: /フロントオープン|前開き|前面|フロント部/ },
  { key: 'lock', label: 'ロック・TSA・ダイヤル', re: /tsaロック|tsa|ダイヤル|暗証番号|施錠|鍵|ロック番号/i },
  { key: 'stopper', label: 'ストッパー・キャスターロック', re: /ストッパー|キャスターロック|ブレーキ|固定/ },
  { key: 'caster', label: 'キャスター・タイヤ', re: /キャスター|タイヤ|車輪|走行|転がり/ },
  { key: 'noise', label: '走行音・静音性', re: /音が|静音|静か|うるさ|騒音|ガラガラ/ },
  { key: 'handle', label: 'ハンドル・持ち手', re: /ハンドル|持ち手|キャリーバー|伸縮|取っ手|グリップ/ },
  { key: 'usb', label: 'USB・充電', re: /usb|充電|モバイルバッテリー|給電|ポート/i },
  { key: 'drink', label: 'ドリンクホルダー', re: /ドリンクホルダー|カップホルダー|ペットボトル|飲み物/ },
  { key: 'interior', label: '内装・仕切り・ポケット', re: /内装|仕切り|ベルト|ポケット|メッシュ|中身|内側/ },
  { key: 'weight', label: '重量', re: /重[いさくみ]|重量|軽[いさくく]|軽量|kg|キロ/ },
  { key: 'capacity', label: '容量・収納力', re: /容量|収納|入らな|入りき|狭[いく]|広[いく]|荷物が/ },
  { key: 'exterior', label: '外装・傷・質感', re: /傷|キズ|汚れ|塗装|質感|光沢|指紋|マット|エナメル/ },
  { key: 'frame', label: 'フレーム・強度', re: /フレーム|強度|頑丈|丈夫|歪|たわ|ヒビ|割れ/ },
  { key: 'size', label: 'サイズ感', re: /サイズ|大きさ|思ったより大き|思ったより小さ|機内持ち込み/ },
  { key: 'accessory', label: '付属品・カバー・タグ', re: /カバー|ネームタグ|付属|同梱|説明書|取扱説明/ },
  // ── ハンディファンなど他商品 ──
  { key: 'fan_power', label: '風量（ファン）', re: /風量|風力|強風|弱風|涼し/ },
  { key: 'fan_battery', label: 'バッテリー持ち（ファン）', re: /電池|バッテリー|持ち時間|連続使用/ },
];

/** 不満・要望が書かれている文を見分ける言い回し */
const COMPLAINT = [
  /残念/, /惜しい/, /不便/, /使いにく/, /使いづら/, /分かりにく/, /わかりにく/,
  /改善/, /欲しかった/, /ほしかった/, /あれば良かった/, /あればよかった/,
  /だったら良/, /だったらよ/, /もう少し/, /もうちょっと/, /もっと/,
  /気になる/, /気になった/, /difficult/, /ただ、/, /ただし/, /しかし/, /但し/,
  /マイナス/, /デメリット/, /悪い点/, /難点/, /弱点/, /苦労/, /困っ/,
  /ought/, /硬[いく]/, /固[いく]/, /緩[いく]/, /きつ[いく]/,
];

/** 称賛だけの文を落とすための語（不満語と同時に出たら不満を優先する） */
const PRAISE_ONLY = /最高|大満足|完璧|文句なし|申し分/;

/** 文に割る。日本語の句点と改行、感嘆符で切る */
export function splitSentences(text) {
  return String(text ?? '')
    .split(/(?<=[。！!？?])\s*|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6);
}

/** その文が不満・要望を含むか */
export function isComplaint(sentence) {
  const s = String(sentence);
  if (!COMPLAINT.some((re) => re.test(s))) return false;
  // 「もっと使いたい」のような前向きな用法を落とす
  if (/もっと(使|愛用|活用|早く買)/.test(s)) return false;
  if (PRAISE_ONLY.test(s) && !/ただ|しかし|残念|惜しい|難点/.test(s)) return false;
  return true;
}

/** その文がどの部位の話か（複数該当しうる） */
export function detectParts(sentence) {
  return PARTS.filter((p) => p.re.test(sentence)).map((p) => p.key);
}

/**
 * レビュー群から、部位ごとの改良のタネを取り出す。
 *
 * @param {object[]} reviews { star, body, date, source }
 * @returns {object}
 */
export function extractInsights(reviews) {
  const parts = new Map(PARTS.map((p) => [p.key, {
    key: p.key, label: p.label,
    mentions: 0, complaints: 0,
    starSum: 0, starCount: 0,
    complaintStarSum: 0,
    voices: [],
  }]));

  let sentenceCount = 0;
  let complaintCount = 0;

  for (const r of reviews) {
    const sentences = splitSentences(r.body);
    sentenceCount += sentences.length;

    // 1レビュー内で同じ部位を何度も数えない（多弁な人に引っぱられないため）
    const seenMention = new Set();
    const seenComplaint = new Set();

    for (const s of sentences) {
      const hit = detectParts(s);
      if (!hit.length) continue;
      const bad = isComplaint(s);
      if (bad) complaintCount++;

      for (const key of hit) {
        const p = parts.get(key);
        if (!seenMention.has(key)) {
          p.mentions++;
          p.starSum += r.star;
          p.starCount++;
          seenMention.add(key);
        }
        if (bad && !seenComplaint.has(key)) {
          p.complaints++;
          p.complaintStarSum += r.star;
          seenComplaint.add(key);
          p.voices.push({ star: r.star, date: r.date, text: s.slice(0, 160) });
        }
      }
    }
  }

  const list = [...parts.values()]
    .filter((p) => p.mentions > 0)
    .map((p) => ({
      key: p.key,
      label: p.label,
      mentions: p.mentions,
      complaints: p.complaints,
      // 言及のうち何割が不満か。改良の優先度を決める中心の指標。
      complaintRate: Number(((p.complaints / p.mentions) * 100).toFixed(1)),
      avgStar: Number((p.starSum / p.starCount).toFixed(2)),
      complaintAvgStar: p.complaints
        ? Number((p.complaintStarSum / p.complaints).toFixed(2))
        : null,
      // 声は代表的なものだけ残す（低評価を優先）
      voices: p.voices.sort((a, b) => a.star - b.star).slice(0, 6),
    }))
    .sort((a, b) => b.complaints - a.complaints);

  return {
    reviewCount: reviews.length,
    sentenceCount,
    complaintSentences: complaintCount,
    parts: list,
  };
}

/**
 * 具体的な指摘の辞書。
 *
 * 部位（PARTS）より一段細かく、「何がどう困っているか」で数えます。
 * レビューを読んで見つかった実際の指摘だけを載せています。
 * 新しい指摘が出てきたら、ここに足してください。
 */
export const ISSUES = [
  { label: '開封時の傷・汚れ', group: '品質管理',
    re: /(開封|届いた|到着|最初から|使う前|新品).{0,25}(傷|キズ|汚れ|シミ)|(傷|キズ|汚れ).{0,20}(あっ|付いて|ついて).{0,15}(残念|がっかり|ゲンナリ)/ },
  { label: '組立・仕上げの不良', group: '品質管理',
    re: /歪ん|よれ|寄れ|浮いたまま|ほつれ|糸が出|めくれ上が|ズレて(取り付|固定)/ },
  { label: '保護フィルムが剥がしにくい', group: '品質管理',
    re: /(フィルム|シート).{0,15}(剥が|はが).{0,10}(にく|づら|れな|大変)/ },
  { label: '重さが気になる', group: '設計トレードオフ',
    re: /重[いさ].{0,20}(気に|残念|ネック|マイナス|覚悟)|(もう少し|もっと).{0,10}軽/ },
  { label: 'メイン収納が狭くなる', group: '設計トレードオフ',
    re: /(メイン|片側|収納).{0,20}(狭|少なく|制限|減)/ },
  { label: '機能が多すぎる・選択制の要望', group: '設計トレードオフ',
    re: /機能.{0,20}(多い|多す|選択|要らな|いらな)/ },
  { label: '急速充電に非対応', group: '機能',
    re: /急速充電/ },
  { label: '充電が実用的でない', group: '機能',
    re: /充電.{0,25}(使えな|限られ|不便|意味が|活かせ)/ },
  { label: 'モバイルバッテリーは預け入れ不可', group: '機能',
    re: /(モバイルバッテリー|充電器).{0,25}(預け入れ|預入|入れられ)/ },
  { label: 'フロントオープンのダイヤルの向き', group: '小改良',
    re: /ダイヤル.{0,15}(向き|逆|反対)/ },
  { label: 'フロントオープンの強度不安', group: '小改良',
    re: /(フロントオープン|パネル).{0,15}(強度|心配|不安|弱)/ },
  { label: 'ストッパーが片側のみ', group: '小改良',
    re: /ストッパー.{0,25}(片側|2個|２個)/ },
  { label: 'キャスターロックの操作性', group: '小改良',
    re: /キャスターロック.{0,25}(足元|操作|不便|しにく)/ },
  { label: 'レバーがデッドスペースを生む', group: '小改良',
    re: /(レバー|凸).{0,25}(デッドスペース|出っ張|邪魔)/ },
  { label: '色味・質感が想像と違った', group: '売り場',
    re: /(色味|カラー|色が).{0,30}(想像|イメージ|思っ).{0,15}(違|異な)|想像.{0,20}(色|シルバー).{0,20}(違|残念)/ },
  { label: '説明書が分かりにくい', group: '売り場',
    re: /(説明書|取扱説明|マニュアル).{0,20}(分かりにく|わかりにく|不親切)/ },
];

/**
 * 具体的な指摘ごとに件数・平均★・実際の声を集める。
 *
 * ★件数だけでは優先順位を誤ります。
 *   「件数は少ないが平均★が低い」指摘は、1件あたりの打撃が大きい。
 *   逆に「件数は多いが平均★が高い」指摘は、承知の上で買われている。
 *   両方を出して判断できるようにします。
 */
export function countIssues(reviews) {
  const total = reviews.length || 1;
  return ISSUES.map((iss) => {
    const hit = reviews.filter((r) => iss.re.test(r.body));
    if (!hit.length) return null;
    const avg = hit.reduce((s, r) => s + r.star, 0) / hit.length;
    return {
      label: iss.label,
      group: iss.group,
      count: hit.length,
      share: Number(((hit.length / total) * 100).toFixed(1)),
      avgStar: Number(avg.toFixed(2)),
      voices: hit
        .sort((a, b) => a.star - b.star)
        .slice(0, 4)
        .map((r) => ({ star: r.star, date: r.date, text: pickSentence(r.body, iss.re) })),
    };
  })
    .filter(Boolean)
    .sort((a, b) => a.avgStar - b.avgStar || b.count - a.count);
}

/** 指摘が書かれている文だけを抜き出す（前後の文脈を少し含める） */
function pickSentence(body, re) {
  for (const s of splitSentences(body)) {
    if (re.test(s)) return s.slice(0, 170);
  }
  return String(body).slice(0, 150);
}

/**
 * 改良の優先度をつける。
 *
 * 考え方:
 *   影響 = どれだけ多くの人が触れているか（mentions）
 *   痛み = そのうち何割が不満か（complaintRate）
 *   この2つの積を「改良インパクト」とする。
 *
 *   言及が少ない部位は、不満率が高くても優先度は上げない
 *   （一部の人の声で商品を変えると、他の人の満足を壊すため）。
 */
export function prioritize(parts, minMentions = 8) {
  return parts
    .filter((p) => p.mentions >= minMentions && p.complaints > 0)
    .map((p) => ({
      ...p,
      impact: Number(((p.mentions * p.complaintRate) / 100).toFixed(1)),
    }))
    .sort((a, b) => b.impact - a.impact);
}
