#!/usr/bin/env node
// ============================================================
//  研修資料の品質チェック（大手水準の「仕上げ基準」に照らす）
// ------------------------------------------------------------
//  prompts/handbook-standard.md の基準を、機械で判定できる形にしたものです。
//  AIを使わずに動くので、いつでも・無料で・同じ結果が出ます。
//  （AIでの書き直しは scripts/handbookAI.js。仕上げの合否判定はこちらが担当）
//
//  実行:
//    npm run handbook:lint                    # config/*-handbook.json をすべて検査
//    node scripts/handbookLint.js config/gym-handbook.json --strict
//
//  --strict を付けると、重大な指摘（error）が1件でもあれば終了コード1。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 「なるべく」のような、人によって解釈が変わる言葉
export const VAGUE = ['なるべく', '適宜', '随時', 'しっかり', 'きちんと', '可能な限り',
  '出来る限り', 'できる限り', '努める', '徹底する', '速やかに', 'なるはや', '早急に'];

// 使ってはいけない表現（言い切りの誇大表現・断定的な医療表現・人格評価）
export const BANNED = ['絶対に', '絶対', '100%', '必ず治', '完治', '保証します', '保証する',
  'やる気がない', '根性', '気合い', 'サボ'];

// 数字（半角・全角）を含むか
export const hasNumber = (s) => /[0-9０-９]/.test(String(s ?? ''));

/** 句点で文に切る（箇条書きの「・」も区切りとして扱う） */
export function sentences(text) {
  return String(text ?? '')
    .split(/[。\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 長すぎる文（既定60字）を返す */
export function longSentences(text, limit = 60) {
  return sentences(text).filter((s) => s.length > limit);
}

/** 曖昧語を含むか。目安欄（許容）は呼び出し側で除外する */
export function vagueWords(text) {
  const s = String(text ?? '');
  return VAGUE.filter((w) => s.includes(w));
}

export function bannedWords(text) {
  const s = String(text ?? '');
  // 「必ず守る」「必ず確認する」は正しい使い方なので、「必ず」単体は禁止しない。
  // 「絶対に痩せる」のように、かぎかっこで囲んだ“悪い例”は指摘しない
  //（悪い例を示すのは、むしろ正しい教え方のため）。
  const quoted = [...s.matchAll(/[「『][^」』]*[」』]/g)].map((m) => m[0]).join('');
  return BANNED.filter((w) => s.includes(w) && !quoted.includes(w));
}

/** 指示が動詞で終わっているか（「〜する」「〜こと」「〜しない」など） */
export function endsWithVerb(text) {
  // 末尾の句点と、末尾の（補足）を外してから語尾を見る
  let s = String(text ?? '').trim();
  for (let i = 0; i < 3; i += 1) {
    s = s.replace(/[。．\s]+$/, '').replace(/[（(][^（()）]*[)）]$/, '').trim();
  }
  if (!s) return false;
  // 日本語の動詞の言い切りは「う段」で終わる（する・書く・つなぐ・落とす・呼ぶ…）
  if ('うくぐすずつづぬふぶむる'.includes(s.slice(-1))) return true;
  // 指示として認められる終わり方（〜こと／〜しない／〜まで／〜以内 など）
  return /(こと|ない|禁止|以内|まで|よい|いい|可|不可|OK)$/.test(s);
}


const issue = (level, rule, where, message) => ({ level, rule, where, message });

/**
 * 研修資料の設定JSONを検査する。
 * kind: 'chapters'（章立て）か 'weeks'（週別）を自動で見分ける。
 */
export function lintHandbook(cfg, label = '') {
  const out = [];
  const add = (...a) => out.push(issue(...a));
  const at = (...parts) => [label, ...parts].filter(Boolean).join(' / ');

  // --- 共通: 表紙 ---
  for (const key of ['title', 'subtitle', 'lead', 'target']) {
    if (!cfg.meta?.[key]) add('error', 'meta', at('meta'), `${key} が空です`);
  }
  if (!cfg.meta?.revision) {
    add('warn', 'revision', at('meta'), '版数・改訂日（meta.revision）がありません。改訂管理ができません');
  }

  // --- テキスト全体の言い回し ---
  const walk = (node, where) => {
    if (typeof node === 'string') {
      // phrases[i][0] は「こう言ってはいけない」の悪い例なので検査しない
      if (/^phrases\[\d+\]\[0\]$/.test(where)) return;
      const isGuide = /目安|guides/.test(where);
      for (const w of bannedWords(node)) {
        add('error', 'banned', at(where), `使ってはいけない表現「${w}」: ${node.slice(0, 40)}…`);
      }
      if (!isGuide) {
        for (const w of vagueWords(node)) {
          add('warn', 'vague', at(where), `あいまいな言葉「${w}」は数値か具体的な動作に置き換える: ${node.slice(0, 40)}…`);
        }
      }
      for (const s of longSentences(node)) {
        add('warn', 'long', at(where), `一文が${s.length}字（60字以内にする）: ${s.slice(0, 40)}…`);
      }
      return;
    }
    if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${where}[${i}]`));
    if (node && typeof node === 'object') {
      return Object.entries(node).forEach(([k, v]) => {
        if (k.startsWith('_')) return;
        walk(v, where ? `${where}.${k}` : k);
      });
    }
  };
  walk(cfg, '');

  // --- 章立ての本（トレーナー研修・管理職育成） ---
  for (const c of cfg.chapters ?? []) {
    const w = at(`第${c.no}章`);
    const need = ['goal', 'steps', 'fixed', 'guides', 'checks', 'solo'];
    for (const k of need) {
      if (!c[k] || (Array.isArray(c[k]) && c[k].length === 0)) {
        add('error', 'structure', w, `${k} がありません（章の構成は7パート固定）`);
      }
    }
    const words = c.words ?? c.terms ?? [];
    if (words.length < 3) add('warn', 'terms', w, '用語の説明が3つ未満です');
    for (const row of words) {
      if (!row[1]) add('error', 'terms', w, `用語「${row[0]}」の説明が空です`);
    }
    if (c.goal && !/合図|合格/.test(c.goal)) {
      add('warn', 'goal', w, 'ゴールに「合格の合図」がありません（どうなれば到達か）');
    }
    for (const s of c.solo ?? []) {
      // 測れない言葉（理解した・意識する など）は不可。行動や状態で書く
      if (/理解|意識|心がけ|把握|努め|考える|わかる|分かる/.test(s) && !hasNumber(s)) {
        add('error', 'solo', w, `合格の判定が測れません（行動か数値で書く）: ${s}`);
      }
    }
    for (const s of c.steps ?? []) {
      if (!endsWithVerb(s)) add('warn', 'steps', w, `手順が動詞で終わっていません: ${s.slice(0, 30)}…`);
    }
    for (const ck of c.checks ?? []) {
      if (/、かつ|および|ならびに/.test(ck)) {
        add('warn', 'checks', w, `1項目に2つの内容が入っています（分ける）: ${ck}`);
      }
    }
  }

  // --- 週別の本（新人研修） ---
  for (const wk of cfg.weeks ?? []) {
    const w = at(`第${wk.no}週`);
    for (const k of ['goals', 'numbers', 'todos', 'checks']) {
      if (!wk[k] || wk[k].length === 0) add('error', 'structure', w, `${k} がありません`);
    }
    for (const [item, value] of wk.numbers ?? []) {
      if (!hasNumber(value)) add('error', 'numbers', w, `目標「${item}」が数値ではありません: ${value}`);
    }
    for (const row of wk.words ?? []) {
      if (!row[1] || !row[2]) add('error', 'terms', w, `言葉「${row[0]}」の説明かたとえが空です`);
    }
    for (const t of wk.todos ?? []) {
      if (!endsWithVerb(t)) add('warn', 'steps', w, `やることが動詞で終わっていません: ${t.slice(0, 30)}…`);
    }
  }

  // --- 確認テスト ---
  for (const [q, a] of cfg.test ?? []) {
    if (!a) add('error', 'test', at('確認テスト'), `解答がありません: ${q}`);
  }
  if ((cfg.test ?? []).length && !(cfg.chapters ?? cfg.weeks ?? []).length) {
    add('warn', 'test', at('確認テスト'), '章・週が無いのにテストだけあります');
  }

  return out;
}

export function summarize(issues) {
  const errors = issues.filter((i) => i.level === 'error').length;
  const warns = issues.filter((i) => i.level === 'warn').length;
  // 100点から、重大は5点・注意は1点を引く（下限0点）
  const score = Math.max(0, 100 - errors * 5 - warns * 1);
  return { errors, warns, score };
}

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const files = args.filter((a) => !a.startsWith('--'));
  const targets = files.length
    ? files
    : fs.readdirSync(path.join(ROOT, 'config'))
        .filter((f) => f.endsWith('-handbook.json'))
        .map((f) => path.join('config', f));

  let total = 0;
  for (const rel of targets) {
    const file = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    const issues = lintHandbook(cfg, '');
    const { errors, warns, score } = summarize(issues);
    total += errors;
    console.log(`\n■ ${path.basename(file)}  ${score}点（重大 ${errors}件 / 注意 ${warns}件）`);
    const byRule = new Map();
    for (const i of issues) {
      if (!byRule.has(i.rule)) byRule.set(i.rule, []);
      byRule.get(i.rule).push(i);
    }
    for (const [rule, list] of [...byRule.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  [${rule}] ${list.length}件`);
      for (const i of list.slice(0, 5)) {
        console.log(`    ${i.level === 'error' ? '×' : '△'} ${i.where}: ${i.message}`);
      }
      if (list.length > 5) console.log(`    … ほか${list.length - 5}件`);
    }
    if (!issues.length) console.log('  指摘なし。基準を満たしています。');
  }
  console.log('');
  if (strict && total > 0) {
    console.error(`重大な指摘が ${total}件 あります。直してから配布してください。`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
