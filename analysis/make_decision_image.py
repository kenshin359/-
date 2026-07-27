import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager as fm
from matplotlib.patches import FancyArrow
fm.fontManager.addfont('/usr/share/fonts/truetype/fonts-japanese-gothic.ttf')
plt.rcParams['font.family']='IPAGothic'; plt.rcParams['axes.unicode_minus']=False
NAVY='#1F4E78'; RED='#C0392B'; GOLD='#E0A400'; GREEN='#27AE60'; TEAL='#2E9E9E'; PUR='#7D5BA6'; INK='#22303C'; SUB='#8A94A6'
fig=plt.figure(figsize=(13,9)); fig.patch.set_facecolor('white')
fig.text(0.5,0.955,'8月 決定作戦（社長決定・6本柱）',ha='center',fontsize=23,fontweight='bold',color=NAVY)
fig.text(0.5,0.917,'認知 → 流入 → 転換 → 客単価 → リピート の全段を埋める布陣　→　月商 ¥66.3M（目標65M達成）',ha='center',fontsize=12.5,color=SUB)
stages=[
 ('認知','①インフルエンサー広告を積極運用\n②テレビ出演を後ろ盾にメタで認知拡大',NAVY,'平日に仕込む（種まき）'),
 ('流入・刈り取り','③イベント日に刈り取り\n（かぶり日8/5・10・25に広告最厚）',GOLD,'かぶり日は平日の8倍返し'),
 ('転換率','④スーツケース コンテンツページ新設\n動画LP化で転換率 ×0.8 → ×0.9 へ回復',TEAL,'これだけで月商 +¥6.1M'),
 ('客単価','⑤セット購入で¥5,000引き\n（目標セット率5%＝約91組/月）',GREEN,'+¥2.3M。2個目コスト¥5,000<広告CPA'),
 ('リピート','⑥リピーター限定¥2,000オフ\n（限定表示・他の人には見えない）',PUR,'9月以降のLTV資産。値崩れ無しで再購入喚起'),
]
y=0.83
for i,(stage,body,c,note) in enumerate(stages):
    fig.text(0.055,y,stage,fontsize=13,fontweight='bold',color='white',va='top',
        bbox=dict(boxstyle='round,pad=0.4',fc=c,ec='none'))
    fig.text(0.19,y+0.004,body,fontsize=11.6,color=INK,va='top',linespacing=1.5,fontweight='bold')
    fig.text(0.66,y+0.004,note,fontsize=10.5,color=c,va='top',linespacing=1.4)
    if i<4: fig.text(0.075,y-0.075,'▼',fontsize=13,color='#B0B8C4')
    y-=0.117
# 下段: 数字の積み上げ
fig.text(0.055,0.235,'数字の積み上げ（8月・楽天）',fontsize=13.5,fontweight='bold',color='white',bbox=dict(boxstyle='round,pad=0.4',fc=RED,ec='none'))
steps=[('攻めプラン(転換率×0.8)','¥57.9M',INK),('＋④コンテンツページで×0.9回復','+¥6.1M → ¥64.0M',TEAL),
 ('＋⑤セット率5%','+¥2.3M → ¥66.3M',GREEN),('目標65Mに対し','+¥1.26M 上振れ達成',RED)]
x=0.06
for label,v,c in steps:
    fig.text(x,0.185,label,fontsize=10.3,color=SUB)
    fig.text(x,0.150,v,fontsize=14,fontweight='bold',color=c)
    x+=0.24
fig.text(0.5,0.075,'前提：スーツケース在庫（マットブラックS・かぶり日3日分）／アクセス単価SC¥10・FAN¥8／②の放映が決まれば当日に広告増額をぶつける',
    ha='center',fontsize=10,color=SUB)
fig.text(0.5,0.045,'⑥リピータークーポンは8月の数字にはほぼ乗らないが、9月スーパーSALE（倍率×2.4）での再購入土台になる',ha='center',fontsize=10,color=PUR)
fig.savefig('img_kettei.png',dpi=145,facecolor='white'); print('img_kettei')
