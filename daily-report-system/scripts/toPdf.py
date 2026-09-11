#!/usr/bin/env python3
# ============================================================
#  Excel（.xlsx）を印刷用PDFに変換する
# ------------------------------------------------------------
#  LibreOffice（soffice）を使って out/ の .xlsx を PDF にします。
#  印刷設定（用紙・向き・幅合わせ・見出し行の繰り返し）は
#  各シートに入れてあるので、そのままの体裁で出ます。
#
#  実行:
#    npm run pdf:excel                      # out/ の .xlsx をすべて変換
#    python3 scripts/toPdf.py out/シフト表.xlsx
#
#  ★soffice が無い環境では、入れ方を案内して終了します（失敗にしません）。
#    Ubuntu: sudo apt-get install -y libreoffice-calc
# ============================================================
import glob
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'out')


def main():
    soffice = shutil.which('soffice') or shutil.which('libreoffice')
    if not soffice:
        print('LibreOffice が見つからないため、PDF変換をとばしました。')
        print('  入れ方（Ubuntu）: sudo apt-get install -y libreoffice-calc')
        print('  Windows/Mac は Excel で「名前を付けて保存 → PDF」でも同じものが作れます。')
        return 0

    targets = sys.argv[1:] or sorted(glob.glob(os.path.join(OUT, '*.xlsx')))
    if not targets:
        print(f'変換するファイルがありません（{OUT}/*.xlsx）。先に npm run store:all を実行してください。')
        return 0

    # LibreOffice は書き込めるプロファイルを必要とするので、一時フォルダを渡す
    with tempfile.TemporaryDirectory() as profile:
        env = {**os.environ, 'HOME': profile}
        ok = 0
        for src in targets:
            if not os.path.exists(src):
                print(f'  見つかりません: {src}')
                continue
            r = subprocess.run(
                [soffice, '--headless', f'-env:UserInstallation=file://{profile}/lo',
                 '--convert-to', 'pdf', '--outdir', os.path.dirname(src) or OUT, src],
                capture_output=True, text=True, env=env, timeout=300)
            pdf = os.path.splitext(src)[0] + '.pdf'
            if r.returncode == 0 and os.path.exists(pdf):
                ok += 1
                print(f'  できました: {os.path.basename(pdf)}')
            else:
                print(f'  変換できませんでした: {os.path.basename(src)}')
                if r.stderr.strip():
                    print('   ', r.stderr.strip().splitlines()[-1])
    print(f'PDFに変換: {ok}件 / {len(targets)}件')
    return 0


if __name__ == '__main__':
    sys.exit(main())
