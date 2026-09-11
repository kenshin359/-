#!/usr/bin/env node
// ============================================================
//  研修資料をAIで「大手水準」に仕上げる
// ------------------------------------------------------------
//  prompts/handbook-standard.md（大手メーカーの標準テキストの型）を
//  system プロンプトにして、Claude に研修資料の文言を書き直させます。
//
//  ポイントは「AIに丸投げしない」ことです:
//    ① 機械チェック（scripts/handbookLint.js）で直すべき箇所を先に洗い出す
//    ② その指摘を添えて、章（週）ごとにAIへ渡す ＝ 一度に渡す量を小さくする
//    ③ 返ってきたJSONを検査（キー・件数・型）し、壊れていたら採用しない
//    ④ もう一度 機械チェックして、点数が上がったかを表示する
//  これで「前より悪くなる」ことが起きないようにしています。
//
//  実行:
//    npm run handbook:ai -- --config=config/gym-handbook.json --dry-run
//    npm run handbook:ai -- --config=config/gym-handbook.json --write
//    node scripts/handbookAI.js --config=config/newbie-handbook.json --only=3
//
//  ★ANTHROPIC_API_KEY が無いときは、何もせず案内だけ出して終了します。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callClaudeRaw } from '../lib/claude.js';
import { optional } from '../lib/env.js';
import { lintHandbook, summarize } from './handbookLint.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STANDARD = path.join(ROOT, 'prompts', 'handbook-standard.md');

function arg(name, fallback = null) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  return process.argv.includes(`--${name}`) ? true : fallback;
}

/** 章（週）1つぶんの、AIへ渡す文章を組み立てる */
export function buildUserText(unit, label, issues) {
  const lines = [
    `次の「${label}」を、仕上げ基準に沿って書き直してください。`,
    '',
    '守ること:',
    '- JSONのキーと配列の要素数は変えない（文言だけを直す）',
    '- 数値・期限・固有名詞は変えない（曖昧な表現を数値にするのは可）',
    '- 事実を足さない。わからないことは「（要確認）」のまま残す',
    '- 出力はJSONのみ。説明もコードフェンスも付けない',
  ];
  if (issues?.length) {
    lines.push('', '機械チェックで見つかった直すべき点:',
      ...issues.map((i) => `- [${i.rule}] ${i.message}`));
  }
  lines.push('', '対象のJSON:', JSON.stringify(unit, null, 2));
  return lines.join('\n');
}

/** AIの応答からJSONを取り出す（前後に説明が付いていても拾う） */
export function parseJson(text) {
  const t = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('JSONが見つかりませんでした');
  return JSON.parse(t.slice(start, end + 1));
}

/** 書き直したものが、元と同じ形をしているか確かめる（壊れていたら採用しない） */
export function sameShape(before, after) {
  const bk = Object.keys(before).sort();
  const ak = Object.keys(after).sort();
  if (bk.join(',') !== ak.join(',')) {
    return `キーが変わっています（元: ${bk.join('/')} → 後: ${ak.join('/')}）`;
  }
  for (const k of bk) {
    const b = before[k];
    const a = after[k];
    if (Array.isArray(b)) {
      if (!Array.isArray(a)) return `${k} が配列でなくなっています`;
      if (a.length !== b.length) return `${k} の件数が ${b.length} → ${a.length} に変わっています`;
      for (let i = 0; i < b.length; i += 1) {
        if (Array.isArray(b[i]) && (!Array.isArray(a[i]) || a[i].length !== b[i].length)) {
          return `${k}[${i}] の列数が変わっています`;
        }
      }
    } else if (typeof b !== typeof a) {
      return `${k} の型が変わっています`;
    }
  }
  return null;
}

function unitsOf(cfg) {
  if (cfg.chapters) return { key: 'chapters', list: cfg.chapters, name: (u) => `第${u.no}章 ${u.title}` };
  if (cfg.weeks) return { key: 'weeks', list: cfg.weeks, name: (u) => `第${u.no}週` };
  throw new Error('chapters も weeks も無いJSONです');
}

async function main() {
  const file = arg('config');
  if (!file) {
    console.error('使い方: node scripts/handbookAI.js --config=config/gym-handbook.json [--dry-run] [--write]');
    process.exit(1);
  }
  const src = path.isAbsolute(file) ? file : path.join(ROOT, file);
  const cfg = JSON.parse(fs.readFileSync(src, 'utf8'));
  const { key, list, name } = unitsOf(cfg);
  const only = arg('only');
  const dryRun = arg('dry-run') === true;
  const write = arg('write') === true;

  const before = summarize(lintHandbook(cfg));
  console.log(`■ 仕上げ前: ${before.score}点（重大 ${before.errors}件 / 注意 ${before.warns}件）`);

  const system = fs.readFileSync(STANDARD, 'utf8');
  const targets = list.filter((u) => !only || String(u.no) === String(only));
  console.log(`  対象: ${targets.length}件（${key}）／ モデル: ${optional('ANTHROPIC_MODEL', 'claude-sonnet-5')}`);

  if (dryRun) {
    const u = targets[0];
    const issues = lintHandbook({ ...cfg, [key]: [u] }).filter((i) => i.rule !== 'meta' && i.rule !== 'revision');
    console.log('\n--- system（先頭20行）---');
    console.log(system.split('\n').slice(0, 20).join('\n'));
    console.log('\n--- user（1件目）---');
    console.log(buildUserText(u, name(u), issues).slice(0, 1500));
    console.log('\n（--dry-run のため、ここで終了します。APIは呼んでいません）');
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('\nANTHROPIC_API_KEY が設定されていないため、書き直しは行いませんでした。');
    console.log('  .env に ANTHROPIC_API_KEY を入れると動きます。');
    console.log('  キーが無くても、機械チェック（npm run handbook:lint）だけは無料で使えます。');
    return;
  }

  const polished = [];
  let skipped = 0;
  for (const u of targets) {
    const issues = lintHandbook({ ...cfg, [key]: [u] })
      .filter((i) => !['meta', 'revision'].includes(i.rule));
    try {
      const text = await callClaudeRaw({
        system,
        userText: buildUserText(u, name(u), issues),
        maxTokens: 4000,
      });
      const after = parseJson(text);
      const broken = sameShape(u, after);
      if (broken) {
        console.log(`  △ ${name(u)}: 形が変わったため採用しません（${broken}）`);
        polished.push(u);
        skipped += 1;
      } else {
        polished.push(after);
        console.log(`  ✓ ${name(u)}: 書き直しました（指摘 ${issues.length}件）`);
      }
    } catch (e) {
      console.log(`  △ ${name(u)}: 失敗したので元のまま使います（${e.message}）`);
      polished.push(u);
      skipped += 1;
    }
  }

  const next = { ...cfg, [key]: only ? list.map((u) => polished.find((p) => p.no === u.no) ?? u) : polished };
  const after = summarize(lintHandbook(next));
  console.log(`■ 仕上げ後: ${after.score}点（重大 ${after.errors}件 / 注意 ${after.warns}件）`
    + (skipped ? `／ 採用しなかった: ${skipped}件` : ''));

  if (after.score < before.score) {
    console.log('点数が下がったため、保存しません（元のファイルはそのままです）。');
    return;
  }
  const outDir = path.join(ROOT, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = arg('out') || path.join(outDir, path.basename(src).replace('.json', '-polished.json'));
  fs.writeFileSync(outFile, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  console.log(`書き出しました: ${outFile}`);
  if (write) {
    const backup = path.join(outDir, `${path.basename(src)}.bak`);
    fs.copyFileSync(src, backup);
    fs.writeFileSync(src, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    console.log(`元のファイルを更新しました（バックアップ: ${backup}）`);
  } else {
    console.log('元のファイルは変えていません。採用するときは --write を付けて実行してください。');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error('失敗しました:', e.message);
    process.exit(1);
  });
}
