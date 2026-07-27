import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager as fm
fm.fontManager.addfont('/usr/share/fonts/truetype/fonts-japanese-gothic.ttf')
plt.rcParams['font.family']='IPAGothic'; plt.rcParams['axes.unicode_minus']=False
NAVY='#1F4E78'; RED='#C0392B'; GOLD='#E0A400'; GREEN='#27AE60'; GRAY='#AAB2C0'; INK='#22303C'; SUB='#8A94A6'
fig=plt.figure(figsize=(12,8.8)); fig.patch.set_facecolor('white')
fig.text(0.5,0.955,'8月シミュレーション：アクセス増でどうなるか',ha='center',fontsize=22,fontweight='bold',color=NAVY)
fig.text(0.5,0.915,'公式カレンダー確定版（マラソン2回・かぶり日3日）　参謀室 予想チーム／検証チーム合格',ha='center',fontsize=12,color=SUB)
# 左：月商比較バー
ax=fig.add_axes([0.09,0.42,0.40,0.42])
labels=['2025年8月\n実績','2026年8月\n現行プラン\n(平日1万/イベント3万)','新プラン\n(平日1.5万/イベント4万)']
vals=[26.3,31.0,44.3]; cols=[GRAY,NAVY,RED]
bars=ax.bar(labels,vals,color=cols,width=0.55)
ax.errorbar(2,44.3,yerr=[[3.3],[3.3]],fmt='none',ecolor=INK,capsize=6,lw=1.6)
ax.text(0,26.3+0.8,'¥26.3M',ha='center',fontsize=11.5,fontweight='bold',color=INK)
ax.text(1,31.0+0.8,'¥31.0M\n(+18%)',ha='center',fontsize=11.5,fontweight='bold',color=NAVY)
ax.text(2,48.5,'¥41.0〜47.6M\n(+56〜81%)',ha='center',fontsize=12,fontweight='bold',color=RED)
ax.set_ylim(0,52); ax.set_ylabel('月商（百万円）',fontsize=11.5)
ax.spines[['top','right']].set_visible(False); ax.grid(axis='y',alpha=0.22); ax.tick_params(labelsize=10)
ax.set_title('月商はどう変わるか',fontsize=14,fontweight='bold',color=INK,loc='left',pad=8)
# 右：内訳と条件
y=0.82
items=[
 ('追加売上の内訳（上限）',NAVY,'平日17日×5千 = +¥4.3M ／ イベント14日×1万 = +¥12.3M\nうち かぶり日(8/5・10・25)だけで +¥4.0M(1日+¥134万)'),
 ('現実ライン（CVR6割掛け）',GOLD,'メタ経由の追加流入はアプリ常連より転換が低め。\n現実的には +¥9.9M → 月商 約¥41M'),
 ('コストとリターン',GREEN,'追加アクセス22.5万 × 単価¥12 = 追加広告費 約¥270万\n増分ROAS 3.7〜6.1倍 → やる価値あり'),
]
for t,c,d in items:
    fig.text(0.55,y,t,fontsize=13,fontweight='bold',color='white',va='top',bbox=dict(boxstyle='round,pad=0.35',fc=c,ec='none'))
    fig.text(0.555,y-0.052,d,fontsize=10.8,color=INK,va='top',linespacing=1.5)
    y-=0.155
# 在庫警告（右下・単独ブロック）
fig.text(0.55,0.345,'絶対条件＝スーツケースの在庫',fontsize=13,fontweight='bold',color='white',va='top',bbox=dict(boxstyle='round,pad=0.35',fc=RED,ec='none'))
fig.text(0.555,0.293,'追加注文 +420〜700件/月。在庫が無ければ全部消える\n（10月▲44%の教訓）。かぶり日3日は在庫最厚で。',fontsize=10.8,color=INK,va='top',linespacing=1.5)
# 下：公式カレンダー要点（左下）
fig.text(0.09,0.30,'公式カレンダー（画像より確定）',fontsize=13,fontweight='bold',color='white',bbox=dict(boxstyle='round,pad=0.35',fc=NAVY,ec='none'))
cal=('・マラソン① 8/4(火)20:00〜8/11(火)01:59（プレ8/2）\n'
     '・マラソン② 8/24(月)20:00〜8/27(木)09:59（プレ8/22）\n'
     '・かぶり日＝8/5・8/10・8/25の3日\n'
     '　（★8/25は公式で新発見。マラソン②×5と0）\n'
     '・5と0単独＝8/15・20・30　・8/1ワンダフルデー\n'
     '・8/18ご愛顧感謝デーP4倍（会員限定・控えめ想定）')
fig.text(0.095,0.26,cal,fontsize=10.5,color=INK,va='top',linespacing=1.6)
fig.text(0.5,0.03,'1アクセスの価値(2026実績・転換率×客単価)：かぶり¥134/ワンダフル¥107/5と0¥93/マラソン¥63/平日¥50。検証チーム再計算一致・合格。',
    ha='center',fontsize=9.3,color=SUB)
fig.savefig('img_sim8.png',dpi=145,facecolor='white'); print('img_sim8.png')
