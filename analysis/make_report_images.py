import json, datetime as dt, statistics as st
from collections import defaultdict
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager as fm
fp='/usr/share/fonts/truetype/fonts-japanese-gothic.ttf'
fm.fontManager.addfont(fp); plt.rcParams['font.family']='IPAGothic'
plt.rcParams['axes.unicode_minus']=False

NAVY='#1F4E78'; TEAL='#2E9E9E'; RED='#C0392B'; GREEN='#27AE60'; GRAY='#8A94A6'; GOLD='#E0A400'; INK='#22303C'
days=json.load(open('rakuten_all.json'))
for x in days: x['d']=dt.date.fromisoformat(x['date'])
days.sort(key=lambda x:x['d'])
def cl(d):
    m=d.month
    if m in(3,6,9,12) and 4<=d.day<=11:return'SALE'
    if m not in(3,6,9,12) and 4<=d.day<=11:return'マラソン'
    if d.day in(15,20,25,30):return'5と0'
    if d.day==1:return'ワンダフル'
    return'平常'
for x in days:x['ev']=cl(x['d'])
mon=defaultdict(lambda:{'s':0,'a':0}); 
for x in days: k=x['d'].strftime('%Y-%m'); mon[k]['s']+=x['sales']; mon[k]['a']+=x['access']
ks=sorted(mon); sales=[mon[k]['s']/1e6 for k in ks]; acc=[mon[k]['a']/1e4 for k in ks]
labels=[k[2:] for k in ks]  # 25-07 ...

# ========== 画像1：診断 ==========
fig=plt.figure(figsize=(12,9.5)); fig.patch.set_facecolor('white')
fig.text(0.5,0.965,'楽天 売上の下落要因 診断',ha='center',fontsize=25,fontweight='bold',color=NAVY)
fig.text(0.5,0.935,'2025年7月 〜 2026年7月（13か月・実績）　参謀室 分析チーム',ha='center',fontsize=12.5,color=GRAY)

ax1=fig.add_axes([0.08,0.60,0.87,0.29])
bars=ax1.bar(labels,sales,color=NAVY,width=0.62)
for i,k in enumerate(ks):
    if k=='2026-07': bars[i].set_color(GOLD)
    if k in('2025-10','2026-05'): bars[i].set_color(RED)
ax1.set_title('① 月商推移（百万円）',fontsize=15,fontweight='bold',color=INK,loc='left',pad=8)
ax1.spines[['top','right']].set_visible(False); ax1.tick_params(labelsize=10.5)
ax1.set_ylabel('月商（百万円）',fontsize=11); ax1.grid(axis='y',alpha=0.25)
ax1.annotate('▲44%\n集客が半減',xy=(3,sales[3]),xytext=(3,30),ha='center',fontsize=11,color=RED,fontweight='bold',
    arrowprops=dict(arrowstyle='->',color=RED))
ax1.annotate('▲25%',xy=(10,sales[10]),xytext=(10,30),ha='center',fontsize=11,color=RED,fontweight='bold',
    arrowprops=dict(arrowstyle='->',color=RED))
ax1.annotate('過去最高\nペース',xy=(12,sales[12]),xytext=(12,50),ha='center',fontsize=11,color=GOLD,fontweight='bold',
    arrowprops=dict(arrowstyle='->',color=GOLD))

ax2=fig.add_axes([0.08,0.20,0.87,0.29])
ax2.plot(labels,sales,'-o',color=NAVY,lw=2.4,ms=6,label='月商（百万円）')
ax2b=ax2.twinx()
ax2b.plot(labels,acc,'--s',color=TEAL,lw=2,ms=5,label='アクセス（万人）')
ax2.set_title('② 売上とアクセス（集客）はぴったり連動する',fontsize=15,fontweight='bold',color=INK,loc='left',pad=8)
ax2.set_ylabel('月商（百万円）',fontsize=11,color=NAVY); ax2b.set_ylabel('アクセス（万人）',fontsize=11,color=TEAL)
ax2.spines[['top']].set_visible(False); ax2b.spines[['top']].set_visible(False)
ax2.tick_params(labelsize=10.5); ax2.grid(axis='y',alpha=0.2)
l1,la=ax2.get_legend_handles_labels(); l2,lb=ax2b.get_legend_handles_labels()
ax2.legend(l1+l2,la+lb,loc='upper left',fontsize=10.5,framealpha=0.9)

fig.text(0.08,0.135,'結論',fontsize=13,fontweight='bold',color='white',
    bbox=dict(boxstyle='round,pad=0.35',fc=RED,ec='none'))
concl=('売上が下がった月は、例外なく「アクセス（集客）が落ちた月」。転換率・客単価はほぼ一定（客単価 約¥26,000〜30,000／転換 0.3〜0.9%）。\n'
       'つまり原因は商品力でも価格でもなく“集客”。集客はイベントと広告で作られる。落ちた月＝前月のイベントで需要を先食い＋その月の広告が薄かった。\n'
       '→ 打ち手は明確：イベント日に広告を集中させ、平常日も広告を切らさない。これで「10月型・5月型の急落」を防げる。')
fig.text(0.085,0.115,concl,fontsize=11.3,color=INK,va='top',linespacing=1.5)
fig.savefig('img_shindan.png',dpi=145,facecolor='white'); plt.close(fig)
print('saved img_shindan.png')

# ========== 画像2：8月作戦 ==========
fig=plt.figure(figsize=(12,9.5)); fig.patch.set_facecolor('white')
fig.text(0.5,0.965,'2026年 8月 楽天イベント作戦',ha='center',fontsize=25,fontweight='bold',color=NAVY)
fig.text(0.5,0.935,'イベント別の実測倍率で組む「勝ち筋」　参謀室 予想チーム',ha='center',fontsize=12.5,color=GRAY)

# 左：イベント別リフト
axL=fig.add_axes([0.17,0.50,0.30,0.36])
evn=['スーパーSALE','5と0のつく日','ワンダフルデー','お買い物マラソン']
lift=[2.40,2.06,1.68,1.64]; cols=[GRAY,GREEN,TEAL,NAVY]
b=axL.barh(range(len(evn)),lift,color=cols,height=0.62)
axL.set_yticks(range(len(evn))); axL.set_yticklabels(evn,fontsize=11.5)
axL.invert_yaxis(); axL.axvline(1,color='#B0B0B0',ls='--',lw=1)
for i,v in enumerate(lift): axL.text(v+0.04,i,f'×{v:.2f}',va='center',fontsize=12.5,fontweight='bold',color=INK)
axL.text(2.40,-0.55,'※8月は無し（次は9月）',fontsize=9.5,color=RED,ha='right')
axL.set_xlim(0,2.95); axL.set_title('③ イベント別 売上倍率（平常日=1.00）',fontsize=14,fontweight='bold',color=INK,loc='left',pad=14)
axL.spines[['top','right']].set_visible(False); axL.tick_params(labelsize=10)

# 右：8月予測の内訳
axR=fig.add_axes([0.60,0.50,0.34,0.36])
seg=[('平常日',13.32,GRAY),('マラソン',9.42,NAVY),('5と0のつく日',6.53,GREEN),('ワンダフル',1.08,TEAL)]
bottom=0
for name,val,c in seg:
    axR.bar(0,val,bottom=bottom,width=0.5,color=c)
    if val>2:
        axR.text(0,bottom+val/2,f'{name}\n¥{val:.1f}M',ha='center',va='center',fontsize=10.5,color='white')
    else:
        axR.annotate(f'{name} ¥{val:.1f}M',xy=(0.25,bottom+val/2),xytext=(0.55,bottom+val/2+0.3),
            fontsize=10,color=INK,va='center',arrowprops=dict(arrowstyle='-',color=GRAY,lw=0.8))
    bottom+=val
axR.set_ylim(0,34); axR.set_xlim(-0.6,1.2); axR.set_xticks([])
axR.set_title('④ 8月 月商予測 ¥30.3M（前年比+15%）',fontsize=14,fontweight='bold',color=INK,loc='left',pad=14)
axR.spines[['top','right','bottom']].set_visible(False); axR.set_ylabel('百万円',fontsize=11)

# 下：施策
fig.text(0.07,0.40,'8月の施策（優先順）',fontsize=15,fontweight='bold',color='white',
    bbox=dict(boxstyle='round,pad=0.4',fc=NAVY,ec='none'))
acts=[
 ('1','5と0のつく日に全力（8/5・10・15・20・25・30）','いま最も伸びている枠。2026年は日平均¥163万、7月は¥312万。広告予算を最優先で寄せる。'),
 ('2','お買い物マラソンで“買い回り”設計（推定8/4〜11）','クーポン＋ポイント倍率＋セット販売で1人あたり購入点数を上げる。5と0(8/5・10)と重なる日が最強。'),
 ('3','平常日も広告を切らさない','下落の正体は平常日の集客枯れ。薄くても広告を継続し、アクセスの底を作る（10月型の急落を防ぐ）。'),
 ('4','9月スーパーSALEの仕込みを8月後半から','SALEは倍率2.40かつ客単価も最高(¥28,943)。高単価商品・在庫・広告を前倒しで準備。'),
]
y=0.355
for n,t,d in acts:
    fig.text(0.085,y,n,fontsize=13,fontweight='bold',color='white',ha='center',
        bbox=dict(boxstyle='circle,pad=0.32',fc=GREEN,ec='none'))
    fig.text(0.125,y+0.012,t,fontsize=12.5,fontweight='bold',color=INK,va='center')
    fig.text(0.125,y-0.018,d,fontsize=10.8,color='#42505C',va='center')
    y-=0.072
fig.text(0.5,0.028,'数値はすべて楽天RMSの実データ（13か月）に基づく。マラソン日程は推定（非SALE月4〜11日）。正式日程で再計算可。',
    ha='center',fontsize=9.5,color=GRAY)
fig.savefig('img_sakusen.png',dpi=145,facecolor='white'); plt.close(fig)
print('saved img_sakusen.png')
