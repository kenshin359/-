import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager as fm
fm.fontManager.addfont('/usr/share/fonts/truetype/fonts-japanese-gothic.ttf')
plt.rcParams['font.family']='IPAGothic'; plt.rcParams['axes.unicode_minus']=False
NAVY='#1F4E78'; RED='#C0392B'; GRAY='#B7BFCC'; INK='#22303C'; GREEN='#27AE60'
fig=plt.figure(figsize=(11,7.6)); fig.patch.set_facecolor('white')
fig.text(0.5,0.95,'在庫切れの機会損失（2025年10-11月・楽天）',ha='center',fontsize=22,fontweight='bold',color=NAVY)
fig.text(0.5,0.905,'「在庫があれば売れていた」分を金額化　参謀室 分析チーム',ha='center',fontsize=12,color='#8A94A6')
ax=fig.add_axes([0.12,0.30,0.80,0.52])
months=['10月','11月']; act=[14.41,15.09]; exp=[27.27,26.39]
x=[0,1]; w=0.34
ax.bar([i-w/2 for i in x],exp,w,color=GRAY,label='平常運転なら（7-9月の日商ベース）')
ax.bar([i+w/2 for i in x],act,w,color=NAVY,label='実績（在庫切れ）')
for i in x:
    ax.text(i-w/2,exp[i]+0.4,f'¥{exp[i]:.1f}M',ha='center',fontsize=11,color='#66707F')
    ax.text(i+w/2,act[i]+0.4,f'¥{act[i]:.1f}M',ha='center',fontsize=11,color=NAVY,fontweight='bold')
    loss=exp[i]-act[i]
    ax.annotate('',xy=(i,act[i]),xytext=(i,exp[i]),arrowprops=dict(arrowstyle='<->',color=RED,lw=1.8))
    ax.text(i+0.05,(act[i]+exp[i])/2,f'▲¥{loss:.1f}M\n失った',color=RED,fontsize=11.5,fontweight='bold',va='center')
ax.set_xticks(x); ax.set_xticklabels(months,fontsize=13); ax.set_ylim(0,31)
ax.set_ylabel('月商（百万円）',fontsize=12); ax.spines[['top','right']].set_visible(False)
ax.grid(axis='y',alpha=0.25); ax.legend(fontsize=11,loc='upper right',framealpha=0.95)
fig.text(0.12,0.185,'2か月合計の機会損失（推定）',fontsize=13,color=INK)
fig.text(0.12,0.115,'¥1,700万 〜 ¥2,400万',fontsize=30,fontweight='bold',color=RED)
fig.text(0.63,0.135,'在庫を切らさなければ、売上はほぼ倍。\n在庫確保はイベント広告より先の"最優先投資"。',fontsize=12,color=INK,va='center',linespacing=1.6)
fig.text(0.5,0.03,'※ 平常運転＝在庫切れ前3か月(7-9月)の日商¥879,537/日で試算。季節性を考慮した保守値〜上限の範囲。SKU別在庫があれば正確に確定可。',
    ha='center',fontsize=9,color='#8A94A6')
fig.savefig('img_loss.png',dpi=145,facecolor='white'); print('saved img_loss.png')
