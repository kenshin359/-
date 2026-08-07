import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../config.js";
import { reviewHash } from "../util/hash.js";

// 送信済みレビューの記録。
// ★落とし穴2-5：ハッシュだけを保存し、本文・投稿者名は残しません。
// ★落とし穴5-5：記録が無いと毎朝同じ下書きを送り続けるので、必ず残します。

const STATE_PATH = join(ROOT, "state/replied-reviews.json");

export function loadReplied() {
  try {
    const data = JSON.parse(readFileSync(STATE_PATH, "utf8"));
    return new Set(data.hashes || []);
  } catch {
    // ファイルが無い/壊れている場合は空から始める（初回など）
    return new Set();
  }
}

export function isReplied(set, review) {
  return set.has(reviewHash(review));
}

// レビュー群を「処理済み」として記録に追加し、保存する。
// ★本文・投稿者名は書かない。ハッシュのみ。
export function markReplied(set, reviews) {
  for (const r of reviews) set.add(reviewHash(r));
  saveReplied(set);
}

export function saveReplied(set) {
  const payload = {
    _comment:
      "送信済みレビューの記録。ハッシュのみ（本文・投稿者名は保存しない）。毎朝の重複送信を防ぐため必ずコミットします。",
    hashes: [...set],
  };
  writeFileSync(STATE_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");
}
