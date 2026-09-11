import sys,re
from collections import defaultdict,Counter
sys.path.insert(0,'scripts')
from build import load_data
D=load_data(); cs=D['campuses']; gaps=[r for r in cs if not r.get('d')]
road_re=re.compile(r'([\u4e00-\u9fa5A-Za-z0-9·（）()\-]{2,24}?(?:大道|大街|路|街|道))(?:[东南西北中一二三四五六七八九十甲乙丙段支]*[0-9０-９]*号?)?')
by=defaultdict(lambda:{'g':[],'k':[]})
for r in cs:
    addr=str(r.get('address') or '')
    for road in set(m.group(1) for m in road_re.finditer(addr)):
        key=(r.get('p'),r.get('c'),road)
        by[key]['k' if r.get('d') else 'g'].append(r)
rows=[]
for key,v in by.items():
    if len(v['g'])<2 or not v['k']: continue
    ds=Counter(r.get('d') for r in v['k'])
    if len(ds)==1:
        rows.append((len(v['g']),len(v['k']),key,next(iter(ds)),v['g'][0]['address']))
for n,k,key,d,ex in sorted(rows,reverse=True)[:80]:
    print(f'{n:2} gaps / {k:2} known | {key[0]} {key[1]} | {key[2]} -> {d} | {ex}')
