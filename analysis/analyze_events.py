import csv, json, datetime as dt, statistics as st
from collections import defaultdict

U='/root/.claude/uploads/c7179f16-7eb7-52e8-aa4a-c082e5dbce5f/'
FILES=['3afd2be9-20250701_20250731___________1.csv','7ab8ddfc-20250801_20250831__________.csv',
'1b94ea77-20250901_20250930__________.csv','d4586317-20251001_20251031__________.csv',
'732a3c50-20251101_20251130__________.csv','46cda8f3-20251201_20251231__________.csv',
'd6dd6224-20260101_20260131__________.csv','c4f89e74-20260201_20260228__________.csv',
'1b02b24e-20260301_20260331__________.csv','ca49cb3d-20260401_20260430__________.csv',
'e9996815-20260501_20260531__________.csv','6d73e68e-20260601_20260630__________.csv',
'28a0e864-20260701_20260727__________.csv']
def num(s):
    s=(s or '').replace(',','').strip()
    try: return float(s)
    except: return 0.0
days=[]
for fn in FILES:
    with open(U+fn,encoding='utf-8') as f: rows=list(csv.reader(f))
    for r in rows[4:]:
        if len(r)<8 or r[2]!='すべて': continue
        d=r[0].strip().strip('"')
        try: y,m,dd=[int(x) for x in d.split('/')]
        except: continue
        sales=num(r[3])
        if sales<=0 and num(r[5])<=0: continue  # 空行(未確定日)を除外
        days.append({'date':dt.date(y,m,dd),'dow':r[1],'sales':sales,'orders':num(r[4]),
                     'access':num(r[5]),'cvr':num(r[6]),'aov':num(r[7])})
days.sort(key=lambda x:x['date'])
print(f'総日数: {len(days)}日  期間: {days[0]["date"]} 〜 {days[-1]["date"]}')

# イベント分類（楽天カレンダー・非重複の優先順位）
def classify(x):
    m=x.month; d=x.day
    if m in (3,6,9,12) and 4<=d<=11: return 'スーパーSALE'
    if m not in (3,6,9,12) and 4<=d<=11: return 'お買い物マラソン(推定)'
    if d in (15,20,25,30): return '5と0のつく日'
    if d==1: return 'ワンダフルデー'
    return '平常日'
for x in days: x['ev']=classify(x['date'])

base=st.mean([x['sales'] for x in days if x['ev']=='平常日'])
print(f'\n平常日ベースライン: ¥{round(base):,}/日\n')
print('==== イベント別 売上統計（平常日=1.00）====')
print(f'{"イベント":20}{"日数":>5}{"日平均売上":>14}{"リフト":>8}{"平均客単価":>11}{"平均転換率":>10}{"平均アクセス":>11}')
order=['平常日','ワンダフルデー','お買い物マラソン(推定)','5と0のつく日','スーパーSALE']
g=defaultdict(list)
for x in days: g[x['ev']].append(x)
stats={}
for ev in order:
    xs=g[ev]
    avg=st.mean([x['sales'] for x in xs]); lift=avg/base
    aov=st.mean([x['aov'] for x in xs if x['aov']>0]); cvr=st.mean([x['cvr'] for x in xs])
    acc=st.mean([x['access'] for x in xs])
    stats[ev]={'n':len(xs),'avg':avg,'lift':lift}
    print(f'{ev:20}{len(xs):>5}{("¥"+format(round(avg),",")):>14}{("×"+f"{lift:.2f}"):>8}{("¥"+format(round(aov),",")):>11}{cvr:>9.2f}%{("¥"+format(round(acc),",")):>11}')

# 月商推移
print('\n==== 月商推移（13か月）====')
mon=defaultdict(float); mond=defaultdict(int)
for x in days: mon[f'{x.date.year}-{x.date.month:02d}' if False else x["date"].strftime("%Y-%m")]+=x['sales']; mond[x["date"].strftime("%Y-%m")]+=1
for ym in sorted(mon): print(f'  {ym}  ¥{round(mon[ym]):>12,}  [{mond[ym]}日]')

# イベント売上の全体寄与
print('\n==== イベント売上の全体構成比 ====')
tot=sum(x['sales'] for x in days)
evsum=defaultdict(float)
for x in days: evsum[x['ev']]+=x['sales']
for ev in order:
    print(f'  {ev:20} ¥{round(evsum[ev]):>12,}  ({evsum[ev]/tot*100:>4.1f}%)')
print(f'  {"合計":20} ¥{round(tot):>12,}')
ev_only=tot-evsum['平常日']
print(f'\n  イベント日合計 ¥{round(ev_only):,} = 全体の {ev_only/tot*100:.1f}%（イベント日は全{len(days)}日中 {sum(1 for x in days if x["ev"]!="平常日")}日 = {sum(1 for x in days if x["ev"]!="平常日")/len(days)*100:.0f}%）')

# TOP15日
print('\n==== 売上TOP15日 ====')
for x in sorted(days,key=lambda k:-k['sales'])[:15]:
    print(f'  {x["date"]}({x["dow"]}) ¥{round(x["sales"]):>10,}  {x["ev"]}  (客単価¥{round(x["aov"]):,}/転換{x["cvr"]}%/ｱｸｾｽ{round(x["access"]):,})')

json.dump([{**x,'date':x['date'].isoformat()} for x in days],open('rakuten_all.json','w'),ensure_ascii=False)
print(f'\n統合データ {len(days)}日を rakuten_all.json に保存')
