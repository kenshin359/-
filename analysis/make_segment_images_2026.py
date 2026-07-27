import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager as fm
fm.fontManager.addfont('/usr/share/fonts/truetype/fonts-japanese-gothic.ttf')
plt.rcParams['font.family']='IPAGothic'; plt.rcParams['axes.unicode_minus']=False
NAVY='#1F4E78'; RED='#C0392B'; GOLD='#E0A400'; GREEN='#27AE60'; TEAL='#2E9E9E'; GRAY='#AAB2C0'; INK='#22303C'; SUB='#8A94A6'
# 2026年(1-7月)実績
rows=[('平日',0.740,1.00,0.22,GRAY),
 ('お買い物マラソン（5と0以外）',0.825,1.11,0.26,'#9BB7D4'),
 ('ワンダフルデー（毎月1日）',1.082,1.46,0.35,TEAL),
 ('スーパーSALE（5と0以外）',1.158,1.57,0.26,'#7FA8C9'),
 ('5と0のつく日（単独）',1.632,2.20,0.46,GREEN),
 ('マラソン × 5と0 かぶり',2.235,3.02,0.54,GOLD),
 ('スーパーSALE × 5と0 かぶり',3.568,4.82,0.66,RED)]
rows=sorted(rows,key=lambda r:r[1])
fig=plt.figure(figsize=(12,8.4)); fig.patch.set_facecolor('white')
fig.text(0.5,0.955,'楽天 セグメント別 売上 × 転換率（2026年1〜7月・実績）',ha='center',fontsize=21,fontweight='bold',color=NAVY)
fig.text(0.5,0.915,'今年も「イベント × 5と0のつく日」の重なりに売上が集中',ha='center',fontsize=13,color=SUB)
ax=fig.add_axes([0.33,0.13,0.59,0.72])
ax.barh(range(len(rows)),[r[1] for r in rows],color=[r[4] for r in rows],height=0.66)
ax.set_yticks(range(len(rows))); ax.set_yticklabels([r[0] for r in rows],fontsize=12)
for i,r in enumerate(rows):
    ax.text(r[1]+0.06,i,f'¥{r[1]:.2f}M / 平日比×{r[2]:.2f}',va='center',fontsize=11,color=INK,fontweight='bold')
    ax.text(r[1]/2,i,f'転換 {r[3]:.2f}%',va='center',ha='center',fontsize=10,color='white')
ax.set_xlim(0,4.5); ax.set_xlabel('1日あたり平均売上（百万円）',fontsize=12)
ax.spines[['top','right']].set_visible(False); ax.grid(axis='x',alpha=0.2)
fig.text(0.06,0.05,'※今年分(2026/1-7)で再集計。お気に入り率は本レポートに無し（R-Karte「お気に入り分析」で追加可）。',fontsize=9.5,color=SUB)
fig.savefig('img_seg2026.png',dpi=145,facecolor='white'); plt.close(fig); print('img_seg2026.png')

# 予算配分（2026数値に更新）
fig=plt.figure(figsize=(12,8.6)); fig.patch.set_facecolor('white')
fig.text(0.5,0.955,'広告予算をどう配分するか（今年データ・結論）',ha='center',fontsize=22,fontweight='bold',color=NAVY)
fig.text(0.5,0.915,'“イベント全フリ”でも“平日均等”でもない。5と0と重なる日に寄せる。',ha='center',fontsize=13,color=SUB)
import math
axp=fig.add_axes([0.055,0.42,0.36,0.42])
sizes=[55,20,25]; cols=[RED,'#7FA8C9',GRAY]; labs=['5と0＋かぶり日\n(山) 55%','SALE/マラソン\n平常日 20%','平日(底の維持)\n25%']
axp.pie(sizes,colors=cols,startangle=90,counterclock=False,wedgeprops=dict(width=0.42,edgecolor='white'))
axp.text(0,0,'広告\n予算',ha='center',va='center',fontsize=14,fontweight='bold',color=INK)
for i,(s,l) in enumerate(zip(sizes,labs)):
    ang=90-360*(sum(sizes[:i])+s/2)/100; r=0.83
    axp.text(r*math.cos(math.radians(ang)),r*math.sin(math.radians(ang)),l,ha='center',va='center',fontsize=10.5,color=INK)
axp.set_title('推奨：広告予算の配分',fontsize=13.5,fontweight='bold',color=INK)
qa=[('Q. 平日も予算を上げるべき？','A. いいえ。平日の転換率は0.22%で最低＝広告効率が\n最も低い。増額分は5と0・かぶり日へ回す。\nただし平日はゼロにしない——底が消えると急落＆\n在庫切れの再来を招く。',RED),
 ('Q. イベント日に全フリすべき？','A. “全部”ではなく“5と0と重なる日”に集中。\nマラソン普通日は×1.11で平日並み。\nSALE×5と0=×4.82、マラソン×5と0=×3.02。\n同じ広告費でも重複日のリターンが桁違い。',GOLD),
 ('Q. イベント日ごとの転換率は？','A. かぶり日 0.54〜0.66% ≫ 5と0/SALE/マラソン\n0.26〜0.46% ＞ 平日 0.22%。\n重複日は転換率が平日の約3倍。\nだから重複日に寄せると費用対効果が最大化する。',NAVY)]
y=0.83
for q,a,c in qa:
    fig.text(0.45,y,q,fontsize=13,fontweight='bold',color='white',va='top',bbox=dict(boxstyle='round,pad=0.35',fc=c,ec='none'))
    fig.text(0.455,y-0.05,a,fontsize=10.8,color=INK,va='top',linespacing=1.5); y-=0.175
fig.text(0.055,0.33,'配分ルール（山谷型）',fontsize=13,fontweight='bold',color='white',bbox=dict(boxstyle='round,pad=0.35',fc=NAVY,ec='none'))
rule=('・最優先：SALE×5と0・マラソン×5と0（毎月5日・10日）＝“かぶり日”に厚く。\n'
      '・次点：15/20/25/30の5と0単独日。ワンダフルデー(1日)も上乗せ。\n'
      '・平日：底を維持する薄い一定額（切らない）。マラソン普通日は盛らない(×1.11)。\n'
      '・高単価商品はスーパーSALEへ(客単価¥30,429)／数量は5と0へ。')
fig.text(0.06,0.285,rule,fontsize=11,color=INK,va='top',linespacing=1.6)
fig.savefig('img_budget2026.png',dpi=145,facecolor='white'); plt.close(fig); print('img_budget2026.png')
