import csv, glob, statistics as st
from datetime import date

FILES = {
 '2025-07':'/root/.claude/uploads/c7179f16-7eb7-52e8-aa4a-c082e5dbce5f/3afd2be9-20250701_20250731___________1.csv',
 '2025-08':'/root/.claude/uploads/c7179f16-7eb7-52e8-aa4a-c082e5dbce5f/7ab8ddfc-20250801_20250831__________.csv',
 '2025-09':'/root/.claude/uploads/c7179f16-7eb7-52e8-aa4a-c082e5dbce5f/1b94ea77-20250901_20250930__________.csv',
 '2025-10':'/root/.claude/uploads/c7179f16-7eb7-52e8-aa4a-c082e5dbce5f/d4586317-20251001_20251031__________.csv',
 '2025-11':'/root/.claude/uploads/c7179f16-7eb7-52e8-aa4a-c082e5dbce5f/732a3c50-20251101_20251130__________.csv',
}
def num(s):
    s=(s or '').replace(',','').strip()
    try: return float(s)
    except: return 0.0

days=[]
for ym,path in FILES.items():
    with open(path,encoding='utf-8') as f:
        rows=list(csv.reader(f))
    # header is row index 3 (0-based)
    for r in rows[4:]:
        if len(r)<8: continue
        if r[2]!='すべて': continue
        d=r[0].strip().strip('"')
        try:
            y,m,dd=[int(x) for x in d.split('/')]
        except: continue
        days.append({'date':date(y,m,dd),'ym':f'{y}-{m:02d}','dow':r[1],
                     'sales':num(r[3]),'orders':num(r[4]),'access':num(r[5]),
                     'cvr':num(r[6]),'aov':num(r[7])})
days.sort(key=lambda x:x['date'])
yen=lambda x:'¥'+format(round(x),',')

print('==== 月次サマリー（楽天・全デバイス）====')
print(f'{"月":8}{"月商":>14}{"日数":>5}{"日平均":>12}{"件数":>7}{"平均客単価":>11}{"平均転換率":>10}{"総アクセス":>12}')
months={}
for d in days: months.setdefault(d['ym'],[]).append(d)
for ym in sorted(months):
    ds=months[ym]; tot=sum(x['sales'] for x in ds); orders=sum(x['orders'] for x in ds)
    acc=sum(x['access'] for x in ds); aov=tot/orders if orders else 0
    cvr=st.mean([x['cvr'] for x in ds])
    print(f'{ym:8}{yen(tot):>14}{len(ds):>5}{yen(tot/len(ds)):>12}{int(orders):>7}{yen(aov):>11}{cvr:>9.2f}%{int(acc):>12,}')

grand=sum(x['sales'] for x in days)
print(f'\n5か月合計 {yen(grand)} / 月平均 {yen(grand/5)}')

# 曜日別
print('\n==== 曜日別 日平均売上 ====')
dows={}
for d in days: dows.setdefault(d['dow'],[]).append(d['sales'])
order=['月','火','水','木','金','土','日']
for w in order:
    if w in dows: print(f'  {w}曜  {yen(st.mean(dows[w])):>12}  [{len(dows[w])}日]')

# イベント判定（楽天カレンダー簡易）
def classify(dt):
    day=dt.day; mo=dt.month; t=[]
    if day%5==0: t.append('5と0のつく日')
    if day==1: t.append('ワンダフルデー')
    if mo in (3,6,9,12) and 4<=day<=11: t.append('スーパーSALE')
    return t
ev=[d for d in days if classify(d['date'])]
nm=[d for d in days if not classify(d['date'])]
print('\n==== イベント日 vs 平常日（日平均売上）====')
print(f'  平常日     {yen(st.mean([x["sales"] for x in nm])):>12}  [{len(nm)}日]')
print(f'  イベント日  {yen(st.mean([x["sales"] for x in ev])):>12}  [{len(ev)}日]')
print(f'  → リフト {st.mean([x["sales"] for x in ev])/st.mean([x["sales"] for x in nm]):.2f}倍')

# 種別別リフト
print('\n==== 種別別リフト（平常日=1.00）====')
base=st.mean([x['sales'] for x in nm])
for typ in ['スーパーSALE','5と0のつく日','ワンダフルデー']:
    sel=[x['sales'] for x in days if typ in classify(x['date'])]
    if sel: print(f'  {typ:14} 日平均 {yen(st.mean(sel)):>12}  ×{st.mean(sel)/base:.2f}  [{len(sel)}日]')

# TOP10日
print('\n==== 売上TOP10日 ====')
for d in sorted(days,key=lambda x:-x['sales'])[:10]:
    print(f'  {d["date"]}({d["dow"]}) {yen(d["sales"]):>12}  件数{int(d["orders"]):>3} 客単価{yen(d["aov"]):>9} 転換{d["cvr"]}% ｱｸｾｽ{int(d["access"]):,} {"/".join(classify(d["date"])) or "平常"}')

import json
with open('rakuten_clean.json','w') as f:
    json.dump([{**d,'date':d['date'].isoformat()} for d in days],f,ensure_ascii=False)
print(f'\nclean data: {len(days)}日分を rakuten_clean.json に保存')
