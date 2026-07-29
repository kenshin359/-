#!/usr/bin/env python3
# ============================================================
#  ショート動画の編集パターンを数値化する
# ------------------------------------------------------------
#  リールやTikTokの動画ファイルを読み、編集の癖を数字にします。
#  担当者が辞めても「何をやっていたか」が数字として残るようにするためです。
#
#  実行:
#    python3 scripts/analyzeVideos.py                    … data/videos/ を解析
#    python3 scripts/analyzeVideos.py --dir=/path/to/mp4
#    python3 scripts/analyzeVideos.py --frames           … 判定用の静止画も書き出す
#
#  分かること:
#    ・尺、解像度、縦横比、fps
#    ・カット数、平均カット長、カットの分布
#    ・★冒頭2秒に何カット入れているか（フックの作り方）
#    ・テロップがどこに置かれているか（上/中/下）
#    ・よく使う色（ブランドカラーの実態）
#    ・無音区間、音の大きさ（BGMの入れ方）
#
#  ★動画の中身（何を言っているか）までは分かりません。
#    そこは担当者への聞き取りで埋めます（docs/sns-handover-interview.md）。
# ============================================================
import json
import os
import re
import subprocess
import sys
import tempfile
from collections import Counter

try:
    import imageio_ffmpeg
    FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:
    FFMPEG = 'ffmpeg'

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VIDEO_EXT = ('.mp4', '.mov', '.m4v', '.webm', '.avi')

# カット検出の設定
# SAMPLE_FPS       … 1秒あたり何枚を見て比べるか。8なら0.125秒の精度。
# PIXEL_DIFF_THRESHOLD … 前後の絵がどれだけ変わったらカットとみなすか（0〜255）
#                        18前後が、CapCutのカット編集とよく一致します。
# MIN_CUT_GAP_SEC  … これより近い反応は1カットにまとめる（フェード対策）
SAMPLE_FPS = 8
PIXEL_DIFF_THRESHOLD = 18
MIN_CUT_GAP_SEC = 0.3


def arg(name, default=None):
    for a in sys.argv[1:]:
        if a.startswith(f'--{name}='):
            return a[len(name) + 3:]
    return default


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, errors='replace')


def probe(path):
    """尺・解像度・fps を取る（ffprobe が無い環境でも ffmpeg の出力から拾う）"""
    r = run([FFMPEG, '-i', path, '-hide_banner'])
    out = r.stderr

    info = {}
    m = re.search(r'Duration:\s*(\d+):(\d+):(\d+\.?\d*)', out)
    if m:
        info['duration'] = int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])
    m = re.search(r'Stream.*Video.*?,\s*(\d{2,5})x(\d{2,5})', out)
    if m:
        info['width'], info['height'] = int(m[1]), int(m[2])
    m = re.search(r'(\d+\.?\d*)\s*fps', out)
    if m:
        info['fps'] = float(m[1])
    info['has_audio'] = 'Audio:' in out
    return info


def detect_cuts(path, duration):
    """
    カットの切り替わり時刻を取る。

    ★ffmpeg の scene 検出（select='gt(scene,X)' や scdet）は、
      **動画の最初のカットを構造的に取りこぼします。**
      閾値を 0.05 まで下げても検出されないことを実測で確認しました。

      「冒頭2秒に何カット入れているか」はこの解析の中心となる数字なので、
      そこが欠けるのは許容できません。そのため自前で判定します。

    やり方:
      一定間隔（既定8fps）で小さな画像を書き出し、
      前後のフレームの明るさ・色の差を測って、大きく変わった時刻をカットとみなす。
    """
    fps = SAMPLE_FPS
    outdir = tempfile.mkdtemp(prefix='cuts_')
    r = run([
        FFMPEG, '-i', path, '-vf', f'fps={fps},scale=64:-2',
        '-q:v', '4', os.path.join(outdir, '%05d.jpg'),
    ])

    files = sorted(f for f in os.listdir(outdir) if f.endswith('.jpg'))
    if len(files) < 2:
        return []

    try:
        from PIL import Image
    except ImportError:
        return []

    frames = []
    for f in files:
        try:
            frames.append(list(Image.open(os.path.join(outdir, f)).convert('RGB').getdata()))
        except Exception:
            frames.append(None)

    cuts = []
    for i in range(1, len(frames)):
        a, b = frames[i - 1], frames[i]
        if not a or not b or len(a) != len(b):
            continue
        # 画素ごとのRGB差の平均（0〜255）
        diff = sum(
            abs(p[0] - q[0]) + abs(p[1] - q[1]) + abs(p[2] - q[2]) for p, q in zip(a, b)
        ) / (len(a) * 3)
        if diff >= PIXEL_DIFF_THRESHOLD:
            cuts.append(round(i / fps, 2))

    # 連続して反応した場合は1カットにまとめる（フェードやズームで続けて出るため）
    merged = []
    for t in cuts:
        if not merged or t - merged[-1] > MIN_CUT_GAP_SEC:
            merged.append(t)

    for f in files:
        try:
            os.remove(os.path.join(outdir, f))
        except OSError:
            pass
    try:
        os.rmdir(outdir)
    except OSError:
        pass

    return merged


def detect_silence(path):
    """無音区間（BGMの切り方・タメの作り方が出る）"""
    r = run([FFMPEG, '-i', path, '-af', 'silencedetect=n=-35dB:d=0.25', '-f', 'null', '-'])
    starts = [float(x) for x in re.findall(r'silence_start:\s*(-?\d+\.?\d*)', r.stderr)]
    ends = [float(x) for x in re.findall(r'silence_end:\s*(\d+\.?\d*)', r.stderr)]
    return list(zip(starts, ends))[:20]


def loudness(path):
    """全体の音量（BGMをどのくらい張っているか）"""
    r = run([FFMPEG, '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'])
    m = re.findall(r'I:\s*(-?\d+\.?\d*)\s*LUFS', r.stderr)
    return float(m[-1]) if m else None


def sample_frames(path, duration, n=9):
    """判定用に静止画を抜き出す"""
    outdir = tempfile.mkdtemp(prefix='frames_')
    paths = []
    for i in range(n):
        t = duration * (i + 0.5) / n
        p = os.path.join(outdir, f'{i:02d}.png')
        run([FFMPEG, '-ss', f'{t:.2f}', '-i', path, '-frames:v', '1', '-y', p])
        if os.path.exists(p):
            paths.append((t, p))
    return outdir, paths


def analyze_frames(frame_paths):
    """
    テロップの位置と主要な色を推定する。

    テロップの判定:
      画面を縦に9分割し、各帯の「輪郭の多さ」を測る。
      文字は輪郭が密になるので、値が高い帯にテロップが置かれている。
      ※文字を読むわけではないので、位置の傾向だけが分かります。
    """
    try:
        from PIL import Image, ImageFilter
    except ImportError:
        return None

    bands = [0.0] * 9
    colors = Counter()

    for _, p in frame_paths:
        try:
            im = Image.open(p).convert('RGB')
        except Exception:
            continue
        w, h = im.size

        edges = im.convert('L').filter(ImageFilter.FIND_EDGES)
        for b in range(9):
            box = edges.crop((0, h * b // 9, w, h * (b + 1) // 9))
            px = list(box.getdata())
            bands[b] += sum(px) / max(1, len(px))

        small = im.resize((60, 100))
        for r, g, bl in small.getdata():
            # 20刻みに丸めて、近い色をまとめる
            colors[(r // 20 * 20, g // 20 * 20, bl // 20 * 20)] += 1

    n = max(1, len(frame_paths))
    bands = [round(v / n, 1) for v in bands]

    top = sum(bands[0:3])
    mid = sum(bands[3:6])
    bottom = sum(bands[6:9])
    total = top + mid + bottom or 1
    where = max([('上', top), ('中央', mid), ('下', bottom)], key=lambda x: x[1])[0]

    return {
        'band_edge_density': bands,
        'telop_zone_ratio': {
            '上': round(top / total * 100, 1),
            '中央': round(mid / total * 100, 1),
            '下': round(bottom / total * 100, 1),
        },
        'telop_likely_zone': where,
        'top_colors': [
            {'rgb': list(c), 'hex': '#%02x%02x%02x' % c, 'share': round(v / sum(colors.values()) * 100, 1)}
            for c, v in colors.most_common(6)
        ],
    }


def analyze(path, want_frames=False):
    name = os.path.basename(path)
    info = probe(path)
    dur = info.get('duration')
    if not dur:
        return {'file': name, 'error': '動画として読めませんでした'}

    cuts = detect_cuts(path, dur)
    # 冒頭2秒のカット数 = フックの作り込み具合
    first2 = [t for t in cuts if t <= 2.0]
    first3 = [t for t in cuts if t <= 3.0]

    gaps = [round(b - a, 2) for a, b in zip(cuts, cuts[1:])] if len(cuts) > 1 else []

    outdir, frames = sample_frames(path, dur, 9)
    visual = analyze_frames(frames) if frames else None

    result = {
        'file': name,
        'duration_sec': round(dur, 2),
        'resolution': f"{info.get('width','?')}x{info.get('height','?')}",
        'aspect': round(info['width'] / info['height'], 3) if info.get('width') and info.get('height') else None,
        'is_vertical': bool(info.get('height', 0) > info.get('width', 0)),
        'fps': info.get('fps'),
        'has_audio': info.get('has_audio'),
        'cuts_total': len(cuts),
        'cuts_per_10sec': round(len(cuts) / dur * 10, 1) if dur else None,
        'cuts_in_first_2sec': len(first2),
        'cuts_in_first_3sec': len(first3),
        'avg_cut_len_sec': round(sum(gaps) / len(gaps), 2) if gaps else None,
        'shortest_cut_sec': min(gaps) if gaps else None,
        'longest_cut_sec': max(gaps) if gaps else None,
        'cut_times': [round(t, 2) for t in cuts[:60]],
        'silences': [[round(a, 2), round(b, 2)] for a, b in detect_silence(path)],
        'loudness_lufs': loudness(path),
        'visual': visual,
    }

    if want_frames:
        keep = os.path.join(ROOT, 'out', 'frames', os.path.splitext(name)[0])
        os.makedirs(keep, exist_ok=True)
        for t, p in frames:
            os.replace(p, os.path.join(keep, f'{t:06.2f}s.png'))
        result['frames_dir'] = keep

    return result


def main():
    d = arg('dir') or os.path.join(ROOT, 'data', 'videos')
    want_frames = '--frames' in sys.argv

    if not os.path.isdir(d):
        print(f'フォルダがありません: {d}')
        print('  動画（.mp4 など）を入れてから、もう一度実行してください。')
        sys.exit(1)

    files = sorted(f for f in os.listdir(d) if f.lower().endswith(VIDEO_EXT))
    if not files:
        print(f'{d} に動画がありません。')
        sys.exit(1)

    print(f'{len(files)}本の動画を解析します…')
    results = []
    for f in files:
        print(f'  解析中: {f}')
        results.append(analyze(os.path.join(d, f), want_frames))

    ok = [r for r in results if 'error' not in r]
    summary = {}
    if ok:
        def avg(key):
            vals = [r[key] for r in ok if r.get(key) is not None]
            return round(sum(vals) / len(vals), 2) if vals else None

        summary = {
            'videos': len(ok),
            'avg_duration_sec': avg('duration_sec'),
            'avg_cuts': avg('cuts_total'),
            'avg_cuts_per_10sec': avg('cuts_per_10sec'),
            'avg_cuts_in_first_2sec': avg('cuts_in_first_2sec'),
            'avg_cut_len_sec': avg('avg_cut_len_sec'),
            'vertical_ratio': round(sum(1 for r in ok if r['is_vertical']) / len(ok) * 100, 1),
            'telop_zone': Counter(
                r['visual']['telop_likely_zone'] for r in ok if r.get('visual')
            ).most_common(),
        }

    out = os.path.join(ROOT, 'out', 'video-analysis.json')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        json.dump({'summary': summary, 'videos': results}, f, ensure_ascii=False, indent=1)

    print(f'\n✅ 書き出しました: {out}')
    if summary:
        print(f"  平均尺 {summary['avg_duration_sec']}秒 / 平均{summary['avg_cuts']}カット")
        print(f"  10秒あたり {summary['avg_cuts_per_10sec']}カット")
        print(f"  冒頭2秒のカット数 平均 {summary['avg_cuts_in_first_2sec']}")
        print(f"  テロップの位置: {summary['telop_zone']}")


if __name__ == '__main__':
    main()
