import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager as fm
fm.fontManager.addfont('/usr/share/fonts/truetype/fonts-japanese-gothic.ttf')
plt.rcParams['font.family']='IPAGothic'; plt.rcParams['axes.unicode_minus']=False
NAVY='#1F4E78'; RED='#C0392B'; GOLD='#E0A400'; GREEN='#27AE60'; TEAL='#2E9E9E'; GRAY='#AAB2C0'; INK='#22303C'; SUB='#8A94A6'

# ---------- 画像1：セグメント別の数値 ----------
# (label, 日平均(百万), lift, CVR%, color)
rows=[
 ('平日',0.624,1.00,0.26,GRAY),
 ('お買い物マラソン（5と0以外）',0.737,1.18,0.40,'#9BB7D4'),
 ('ワンダフルデー（毎月1日）',1.050,1.68,0.61,TEAL),
 ('スーパーSALE（5と0以外）',1.018,1.63,0.32,'#7FA8C9'),
 ('5と0のつく日（単独）',1.286,2.06,0.48,GREEN),
 ('マラソン × 5と0 かぶり',1.883,3.01,0.73,GOLD),
 ('スーパーSALE × 5と0 かぶり',2.943,4.71,0.74,RED),
]
rows=sorted(rows,key=lambda r:r[1])
fig=plt.figure(figsize=(12,8.4)); fig.patch.set_facecolor('white')
fig.text(0.5,0.955,'楽天 セグメント別 売上 × 転換率（13か月・実績）',ha='center',fontsize=22,fontweight='bold',color=NAVY)
fig.text(0.5,0.915,'「イベント × 5と0のつく日」の重なりに売上が集中する',ha='center',fontsize=13,color=SUB)
ax=fig.add_axes([0.32,0.13,0.60,0.72])
y=range(len(rows))
ax.barh(list(y),[r[1] for r in rows],color=[r[4] for r in rows],height=0.66)
ax.set_yticks(list(y)); ax.set_yticklabels([r[0] for r in rows],fontsize=12)
for i,r in enumerate(rows):
    ax.text(r[1]+0.05,i,f'¥{r[1]:.2f}M / 平日比×{r[2]:.2f}',va='center',fontsize=11,color=INK,fontweight='bold')
    ax.text(r[1]/2,i,f'転換 {r[3]:.2f}%',va='center',ha='center',fontsize=10,color='white')
ax.set_xlim(0,3.7); ax.set_xlabel('1日あたり平均売上（百万円）',fontsize=12)
ax.spines[['top','right']].set_visible(False); ax.grid(axis='x',alpha=0.2)
ax.set_title('棒＝日平均売上／バー内＝転換率（すべてデバイス）',fontsize=11.5,color=INK,loc='left',pad=6)
fig.text(0.06,0.055,'※お気に入り率は本レポート（売上・アクセス）に無し。R-Karte「お気に入り分析」データで追加可能。',fontsize=9.5,color=SUB)
fig.savefig('img_seg.png',dpi=145,facecolor='white'); plt.close(fig); print('img_seg.png')

# ---------- 画像2：広告予算の配分＋回答 ----------
fig=plt.figure(figsize=(12,8.6)); fig.patch.set_facecolor('white')
fig.text(0.5,0.955,'広告予算をどう配分するか（結論）',ha='center',fontsize=23,fontweight='bold',color=NAVY)
fig.text(0.5,0.915,'“イベント全フリ”でも“平日均等”でもない。5と0と重なる日に寄せる。',ha='center',fontsize=13,color=SUB)
# ドーナツ
axp=fig.add_axes([0.055,0.42,0.36,0.42])
sizes=[55,20,25]; labs=['5と0＋かぶり日\n(山) 55%','SALE/マラソン\n平常日 20%','平日(底の維持)\n25%']; cols=[RED,'#7FA8C9',GRAY]
w,_=axp.pie(sizes,colors=cols,startangle=90,counterclock=False,wedgeprops=dict(width=0.42,edgecolor='white'))
axp.text(0,0,'広告\n予算',ha='center',va='center',fontsize=14,fontweight='bold',color=INK)
for i,(s,l) in enumerate(zip(sizes,labs)):
    ang=90-360*(sum(sizes[:i])+s/2)/100; import math; r=0.83
    axp.text(r*math.cos(math.radians(ang)),r*math.sin(math.radians(ang)),l,ha='center',va='center',fontsize=10.5,color=INK)
axp.set_title('推奨：広告予算の配分',fontsize=13.5,fontweight='bold',color=INK)
# 右：3つの問いへの回答
qa=[
 ('Q. 平日も予算を上げるべき？','A. いいえ。平日の転換率は0.26%で最低＝広告効率が\n最も低い。増額分は5と0・かぶり日へ回す。\nただし平日はゼロにしない——アクセスの底が消えると\n10月型の急落に直結（在庫切れの再来を防ぐ）。',RED),
 ('Q. イベント日に全フリすべき？','A. “全部”ではなく“5と0と重なる日”に集中。\nマラソン普通日は×1.18で平日並み。\nSALE×5と0=×4.71、マラソン×5と0=×3.01。\n同じ広告費でも重複日のリターンが桁違い。',GOLD),
 ('Q. イベント日ごとの転換率は？','A. かぶり日 0.73〜0.74% ≫ 5と0/SALE/マラソン\n0.4〜0.5% ＞ 平日 0.26%。\n重複日は転換率が平日の約2.8倍。\nだから重複日に寄せると費用対効果が最大化する。',NAVY),
]
y=0.83
for q,a,c in qa:
    fig.text(0.45,y,q,fontsize=13,fontweight='bold',color='white',va='top',
        bbox=dict(boxstyle='round,pad=0.35',fc=c,ec='none'))
    fig.text(0.455,y-0.05,a,fontsize=10.8,color=INK,va='top',linespacing=1.5)
    y-=0.175
fig.text(0.055,0.33,'配分ルール（山谷型）',fontsize=13,fontweight='bold',color='white',
    bbox=dict(boxstyle='round,pad=0.35',fc=NAVY,ec='none'))
rule=('・最優先：スーパーSALE×5と0（5/10日）とマラソン×5と0（5/10日）＝“かぶり日”に厚く。\n'
      '・次点：15/20/25/30の5と0単独日。ワンダフルデー(1日)も上乗せ。\n'
      '・平日：底を維持する薄い一定額（切らない）。マラソン普通日は盛らない（×1.18のため）。\n'
      '・高単価商品はスーパーSALEへ（客単価¥29,490で最高）／数量は5と0へ寄せる。')
fig.text(0.06,0.285,rule,fontsize=11,color=INK,va='top',linespacing=1.6)
fig.savefig('img_budget.png',dpi=145,facecolor='white'); plt.close(fig); print('img_budget.png')
