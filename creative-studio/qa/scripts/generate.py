#!/usr/bin/env python3
"""generate.py — 外部画像生成API（Gemini / nano-banana系）への正直な接続クライアント。

このスクリプトは APIキーが提供された場合のみ 動作する。キーが無ければ
「未接続」と正直に報告して終了する（存在しない機能を偽装しない）。

キーの探索順:
  1. 環境変数 GEMINI_API_KEY / IMAGE_API_KEY
  2. creative-studio/.env の GEMINI_API_KEY=...（.gitignore 済み・コミットされない）

使い方:
  # テキストから生成（9:16ストーリー背景など）
  python3 generate.py --prompt "..." --out out.png --aspect 9:16

  # ★参照画像を渡して編集（商品保持・RULE 2 の本命）
  python3 generate.py --prompt "この商品写真を保持したまま背景を..." \
      --image references/products/prod-001.png --image master/story.png \
      --out out.png

  # モデル指定（既定: gemini-2.5-flash-image = nano-banana）
  python3 generate.py --model gemini-2.5-flash-image ...

注意:
  - 生成結果は必ず既存QA（lock_verify.py / diff_check.py / チェックリスト）を通すこと。
  - 生成物には SynthID 等の電子透かしが入る場合がある（Google仕様）。
"""
import sys
import os
import json
import base64
import argparse
import mimetypes
import urllib.request
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))

API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"


def load_key():
    for name in ("GEMINI_API_KEY", "IMAGE_API_KEY"):
        v = os.environ.get(name)
        if v:
            return v.strip(), f"env:{name}"
    env_path = os.path.join(ROOT, ".env")
    if os.path.exists(env_path):
        for line in open(env_path, encoding="utf-8"):
            line = line.strip()
            if line.startswith("GEMINI_API_KEY=") or line.startswith("IMAGE_API_KEY="):
                v = line.split("=", 1)[1].strip().strip('"').strip("'")
                if v:
                    return v, f"file:{env_path}"
    return None, None


def b64_image_part(path):
    mime = mimetypes.guess_type(path)[0] or "image/png"
    with open(path, "rb") as f:
        data = base64.b64encode(f.read()).decode()
    return {"inline_data": {"mime_type": mime, "data": data}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--image", action="append", default=[],
                    help="参照画像（複数可）。商品Ground Truthを必ず渡すこと")
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default="gemini-2.5-flash-image",
                    help="例: gemini-2.5-flash-image (nano-banana)")
    ap.add_argument("--aspect", default=None,
                    help="1:1 / 9:16 / 16:9 / 4:5 など（テキスト生成時に有効）")
    args = ap.parse_args()

    key, src = load_key()
    if not key:
        print("❌ 未接続: APIキーがありません。")
        print("   接続方法（どちらか）:")
        print("   A) 環境変数 GEMINI_API_KEY を設定")
        print(f"   B) {os.path.join(ROOT, '.env')} に GEMINI_API_KEY=... を記載")
        print("   キー取得: https://aistudio.google.com/apikey （無料枠あり）")
        return 3

    parts = [{"text": args.prompt}]
    for p in args.image:
        if not os.path.exists(p):
            print(f"❌ 参照画像が見つかりません: {p}")
            return 2
        parts.append(b64_image_part(p))

    body = {
        "contents": [{"parts": parts}],
        "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]},
    }
    if args.aspect:
        body["generationConfig"]["imageConfig"] = {"aspectRatio": args.aspect}

    url = f"{API_BASE}/{args.model}:generateContent"
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
        method="POST")

    print(f"  model   : {args.model}")
    print(f"  key from: {src}")
    print(f"  refs    : {len(args.image)}枚")
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            resp = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:600]
        print(f"❌ APIエラー HTTP {e.code}\n{detail}")
        if e.code in (401, 403):
            print("→ キーが無効か、権限不足の可能性。")
        elif e.code == 429:
            print("→ レート/クォータ超過。少し待つか課金設定を確認。")
        return 1
    except Exception as e:  # noqa
        print(f"❌ 通信失敗: {e}")
        return 1

    imgs, texts = [], []
    for cand in resp.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            if "inlineData" in part:
                imgs.append(part["inlineData"])
            elif "inline_data" in part:
                imgs.append(part["inline_data"])
            elif "text" in part:
                texts.append(part["text"])

    if not imgs:
        print("❌ 画像が返りませんでした。モデル応答:")
        print((" ".join(texts))[:500] or json.dumps(resp)[:500])
        return 1

    data = imgs[0].get("data")
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "wb") as f:
        f.write(base64.b64decode(data))
    print(f"✅ saved: {args.out}")
    if len(imgs) > 1:
        for i, im in enumerate(imgs[1:], 2):
            alt = args.out.rsplit(".", 1)[0] + f"_{i}.png"
            with open(alt, "wb") as f:
                f.write(base64.b64decode(im.get("data")))
            print(f"   also : {alt}")
    if texts:
        print("  model note:", " ".join(texts)[:300])
    print("  ※ 必ず lock_verify.py / diff_check.py / 各チェックリストでQAすること。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
