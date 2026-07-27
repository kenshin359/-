import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager as fm
fm.fontManager.addfont('/usr/share/fonts/truetype/fonts-japanese-gothic.ttf')
plt.rcParams['font.family']='IPAGothic'; plt.rcParams['axes.unicode_minus']=False
NAVY='#1F4E78'; RED='#C0392B'; GOLD='#E0A400'; GREEN='#27AE60'; TEAL='#2E9E9E'; GRAY='#AAB2C0'; INK='#22303C'; SUB='#8A94A6'; LT='#9BB7D4'

# セグメント: (名称, 日数, 現行/日, 1アクセス価値, Δアクセス, 色)
segs=[('かぶり日(8/5・10・25)',3,2234584,133.9254,10000,RED),
      ('5と0単独(15・20・30)',3,1631874,92.5842,10000,GREEN),
      ('ワンダフルデー(8/1)',1,1081629,107.2855,10000,TEAL),
      ('マラソン通常(7日)',7,824846,63.0136,10000,LT),
      ('平日(17日)',17,740103,50.2436,5000,GRAY)]
rows=[]
for name,n,cur,vpa,da,c in segs:
    add=round(da*vpa); rows.append((name,n,cur,cur+add,add,add*n,c))
tot_cur=sum(n*cur for name,n,cur,vpa,da,c in segs)
tot_add=sum(r[5] for r in rows)
print('現行',tot_cur,'追加',tot_add,'新',tot_cur+tot_add)

fig=plt.figure(figsize=(12.5,8.8)); fig.patch.set_facecolor('white')
fig.text(0.5,0.955,'通常予算 vs 増額：売上の差額（転換率キープ）',ha='center',fontsize=22,fontweight='bold',color=NAVY)
fig.text(0.5,0.915,'平日 1万→1.5万アクセス（+50%）／ イベント日 3万→4万アクセス（メタ広告・スーツケース調整）',ha='center',fontsize=12.5,color=SUB)

# 左：1日あたり 現行vs増額
ax=fig.add_axes([0.24,0.40,0.44,0.44])
names=[r[0] for r in rows][::-1]
cur=[r[2]/1e6 for r in rows][::-1]; new=[r[3]/1e6 for r in rows][::-1]; cols=[r[6] for r in rows][::-1]
import numpy as np
y=np.arange(len(rows)); h=0.36
ax.barh(y+h/2,cur,h,color='#D5DBE4',label='通常予算')
ax.barh(y-h/2,new,h,color=cols,label='増額後')
for i,r in enumerate(rows[::-1]):
    ax.text(r[3]/1e6+0.05,i-h/2,f'+¥{r[4]:,}/日',va='center',fontsize=10.5,fontweight='bold',color=INK)
    ax.text(r[2]/1e6+0.05,i+h/2,f'¥{r[2]/1e6:.2f}M',va='center',fontsize=9,color=SUB)
ax.set_yticks(y); ax.set_yticklabels(names,fontsize=11.5)
ax.set_xlim(0,4.4); ax.set_xlabel('1日あたり売上（百万円）',fontsize=11)
ax.spines[['top','right']].set_visible(False); ax.grid(axis='x',alpha=0.2)
ax.legend(fontsize=10.5,loc='lower right')
ax.set_title('1日あたり：通常予算 → 増額後（転換率キープ）',fontsize=13,fontweight='bold',color=INK,loc='left',pad=8)

# 右：月間まとめ
fig.text(0.74,0.82,'月間の差額（8月・公式カレンダー）',fontsize=13,fontweight='bold',color='white',bbox=dict(boxstyle='round,pad=0.35',fc=NAVY,ec='none'))
fig.text(0.745,0.765,f'通常予算   ¥{tot_cur:,}',fontsize=12.5,color=INK)
fig.text(0.745,0.725,f'増額後     ¥{tot_cur+tot_add:,}',fontsize=12.5,color=INK,fontweight='bold')
fig.text(0.745,0.665,f'差額 +¥{tot_add:,}',fontsize=17,fontweight='bold',color=RED)
fig.text(0.745,0.625,f'（+{tot_add/tot_cur*100:.0f}%）',fontsize=12,color=RED)

# 下：差額の内訳（横帯）
fig.text(0.065,0.30,'差額 +¥16.5M の内訳（月間）',fontsize=13,fontweight='bold',color='white',bbox=dict(boxstyle='round,pad=0.35',fc=RED,ec='none'))
ax2=fig.add_axes([0.065,0.15,0.87,0.10])
left=0
order=[(r[0],r[5],r[6]) for r in rows]
for name,val,c in order:
    ax2.barh(0,val/1e6,left=left/1e6,color=c,height=0.6)
    lbl=f'{name.split("(")[0]}\n+¥{val/1e6:.2f}M'
    ax2.text((left+val/2)/1e6,0,lbl,ha='center',va='center',fontsize=9.5,color='white' if c!=GRAY else INK,fontweight='bold')
    left+=val
ax2.set_xlim(0,left/1e6); ax2.set_ylim(-0.6,0.6); ax2.axis('off')
fig.text(0.065,0.075,'ポイント：同じ+1万アクセスでも価値が違う。かぶり日+¥134万/日 ＞ ワンダフル+¥107万 ＞ 5と0+¥93万 ＞ マラソン+¥63万。平日は+5千で+¥25万/日。',fontsize=10.5,color=INK)
fig.text(0.065,0.045,'※転換率キープ前提の理論値（1アクセス価値=2026年実績の転換率×客単価）。前提はスーツケース在庫の確保（追加注文+約700件/月）。検証チーム再計算一致。',fontsize=9,color=SUB)
fig.savefig('img_diff.png',dpi=145,facecolor='white'); print('img_diff.png')
