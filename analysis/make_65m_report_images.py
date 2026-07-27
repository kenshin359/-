import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager as fm
fm.fontManager.addfont('/usr/share/fonts/truetype/fonts-japanese-gothic.ttf')
plt.rcParams['font.family']='IPAGothic'; plt.rcParams['axes.unicode_minus']=False
NAVY='#1F4E78'; RED='#C0392B'; GOLD='#E0A400'; GREEN='#27AE60'; TEAL='#2E9E9E'; GRAY='#AAB2C0'; INK='#22303C'; SUB='#8A94A6'

# ===== 画像1: 65M作戦サマリー =====
fig=plt.figure(figsize=(12.5,8.8)); fig.patch.set_facecolor('white')
fig.text(0.5,0.955,'月商 ¥6,500万への作戦報告（楽天・8月）',ha='center',fontsize=22,fontweight='bold',color=NAVY)
fig.text(0.5,0.915,'攻めプラン（平日3万/イベント5万アクセス）を土台に、転換率とセット率で届かせる　参謀室',ha='center',fontsize=12,color=SUB)
ax=fig.add_axes([0.08,0.44,0.42,0.42])
labels=['転換率×0.8\n(現行の保守見積)','転換率×0.9','転換率 据え置き\n(×1.0)']
vals=[57.9,64.0,70.1]; cols=[GRAY,TEAL,GREEN]
bars=ax.bar(labels,vals,color=cols,width=0.55)
ax.axhline(65,color=RED,lw=2.2,ls='--')
ax.text(2.45,65.4,'目標 ¥65M',color=RED,fontsize=12,fontweight='bold',ha='right')
for i,v in enumerate(vals): ax.text(i,v+0.7,f'¥{v:.1f}M',ha='center',fontsize=12,fontweight='bold',color=INK)
ax.set_ylim(0,76); ax.set_ylabel('月商（百万円）',fontsize=11.5)
ax.spines[['top','right']].set_visible(False); ax.grid(axis='y',alpha=0.2); ax.tick_params(labelsize=10)
ax.set_title('転換率をどこまで守れるかで着地が決まる',fontsize=13.5,fontweight='bold',color=INK,loc='left',pad=8)
# 右: 3ルート
y=0.82
routes=[('ルートA：転換率防衛のみ',NAVY,'転換率の下落を−8.3%以内に抑える（保持率91.7%）\n→ それだけで¥65M。防衛策は次ページ7策。'),
 ('ルートB：セット販売のみ',GRAY,'転換率×0.8のままなら、セット率18%(289組)が必要。\n単独では非現実的 → 併用が正解。'),
 ('ルートC：併用【推奨】',RED,'転換率の下落を−12%以内 ＋ セット率5%(約91組/月)\n→ ¥65.0M ちょうど。どちらも現実的な水準。')]
for t,c,d in routes:
    fig.text(0.56,y,t,fontsize=13,fontweight='bold',color='white',va='top',bbox=dict(boxstyle='round,pad=0.35',fc=c,ec='none'))
    fig.text(0.565,y-0.05,d,fontsize=10.8,color=INK,va='top',linespacing=1.5)
    y-=0.145
fig.text(0.08,0.335,'結論',fontsize=13,fontweight='bold',color='white',bbox=dict(boxstyle='round,pad=0.35',fc=RED,ec='none'))
fig.text(0.085,0.30,('アクセス増だけに頼らず、「転換率を守る7策」と「客単価を上げる7策」を同時に走らせる。\n'
 '保持88%＋セット率5%＝¥64.99M、保持88%＋セット率8%なら¥66.3M。目標に対して二重の保険が効く。\n'
 '前提：スーツケース在庫（特にマットブラックS・かぶり日3日分）。在庫が崩れたら全ルート不成立。'),fontsize=11.2,color=INK,va='top',linespacing=1.6)
fig.text(0.5,0.03,'試算基盤：7月公式実績・8月公式カレンダー・アクセス単価SC¥10/FAN¥8。セット1組の追加売上＝2個目¥29,500−クーポン¥5,000=¥24,500。',ha='center',fontsize=9,color=SUB)
fig.savefig('img_65a.png',dpi=145,facecolor='white'); plt.close(fig); print('img_65a')

# ===== 画像2: 施策リスト =====
fig=plt.figure(figsize=(13,9.2)); fig.patch.set_facecolor('white')
fig.text(0.5,0.96,'¥6,500万への具体施策（14策）',ha='center',fontsize=22,fontweight='bold',color=NAVY)
fig.text(0.5,0.925,'左：転換率を「据え置き」に守る7策　／　右：客単価を上げる7策',ha='center',fontsize=12,color=SUB)
fig.text(0.045,0.875,'🛡 転換率を守る（LP・広告精度）',fontsize=14,fontweight='bold',color='white',bbox=dict(boxstyle='round,pad=0.4',fc=NAVY,ec='none'))
L=[('① 楽天アプリへ流す導線【最重要】','7月実測：アプリ転換率4〜8% vs スマホWeb 0.03〜0.13%＝約50倍。メタ→アプリで開かせる\n(ディープリンク/アプリ限定クーポン訴求)だけで新規の転換率が段違いに変わる。'),
 ('② テレビ出演・放映実績の活用','「ヒルナンデス放送」実績を広告1枚目とLPファーストビューに。新規TV露出が決まれば\n放映日に広告増額をぶつける（信頼の後ろ盾で冷たい客の転換率が上がる）。'),
 ('③ LPに動きをつける（動画LP化）','ファーストビューに6秒動画：フロントオープン→ストッパー→静音キャスターを実演。\nGIF/ショート動画は静止画より冷たい流入に強い。'),
 ('④ 楽天広告(RPP/CA)の精度','検索語の絞込と除外、売れ筋SKU(多機能PC)に入札集中、イベント日だけ増額の山谷運用。'),
 ('⑤ メタ広告の精度','購入者リストで類似オーディエンス作成、動画視聴→カート→購入のリタゲ階層、\nレビュー/UGC型クリエイティブでLP前に信頼を作る。'),
 ('⑥ 商品ページCRO','レビュー動画・サイズ比較表・Q&A先回り・クーポンの視認性UP。迷いを1つずつ消す。'),
 ('⑦ カゴ落ち回収','カート放棄への再訪クーポン(Rクーポン)。買いかけ客は最も安い転換率改善。')]
y=0.845
for t,d in L:
    fig.text(0.05,y,t,fontsize=11.5,fontweight='bold',color=NAVY,va='top')
    fig.text(0.055,y-0.028,d,fontsize=9.3,color=INK,va='top',linespacing=1.45)
    y-=0.107
fig.text(0.52,0.875,'💰 客単価を上げる（セット・アップセル）',fontsize=14,fontweight='bold',color='white',bbox=dict(boxstyle='round,pad=0.4',fc=GREEN,ec='none'))
R=[('① 2個セット¥5,000クーポン【社長案・採用】','2個目の獲得コスト¥5,000 ＜ 広告の新規獲得(平日約¥6,600)。利益は削るが広告より安い。\n対象：多機能PC/ノーマルアルミ/多機能アルミ。'),
 ('② 段階クーポン（3個¥9,000）','家族需要向け。帰省・家族旅行の8月は「家族分まとめて」が刺さる季節。'),
 ('③ ペア割の見せ方','同じ2個割でも「夫婦で色違い」訴求に。マットブラック×シルバーの組み合わせ提案。'),
 ('④ S→Mアップセル','購入者の57%はSサイズ。「+¥6,900でMサイズ(3〜7泊)」の比較表を目立たせて1段上へ。'),
 ('⑤ 圧縮バッグ同梱の拡販','SCとセットで1000円OFFは既に月17組売れている実績あり。全SCページに同梱枠を設置。'),
 ('⑥ 夏旅セット（SC＋ハンディファン）','旅行文脈で自然なクロスセル。ファン在庫の消化にも効く。'),
 ('⑦ お盆・帰省ギフト訴求','8月特有需要。のし・ラッピング対応を前面に（実家への贈答・買い替え需要）。')]
y=0.845
for t,d in R:
    fig.text(0.525,y,t,fontsize=11.5,fontweight='bold',color=GREEN,va='top')
    fig.text(0.53,y-0.028,d,fontsize=9.3,color=INK,va='top',linespacing=1.45)
    y-=0.107
fig.text(0.5,0.035,'目安：転換率防衛は①②③が3本柱（新規流入の質×信頼×伝わるLP）。客単価は①⑤が即効（実績/根拠あり）。',ha='center',fontsize=10,color=SUB)
fig.savefig('img_65b.png',dpi=145,facecolor='white'); plt.close(fig); print('img_65b')
