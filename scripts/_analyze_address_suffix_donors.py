import sys,re,collections
sys.path.insert(0,'scripts')
from build import load_data,normalized_address
D=load_data(); gids={x['campus_id'] for x in D['campusLocationGaps']}
markers=('大道','大街','公路','路','街','巷','胡同')
def strong(r):
    return bool(r.get('d')) and (bool(r.get('districtVerified')) or bool(r.get('verified')) or r.get('sourceKind') in {'official','government','corroborated'})
def norm(r,donor=False):
    return normalized_address(r.get('address'),r.get('p'),r.get('c'),r.get('d','') if donor else '')
def suffix(a,b):
    n=0
    for x,y in zip(reversed(a),reversed(b)):
        if x!=y:break
        n+=1
    return a[-n:] if n else ''
bycity=collections.defaultdict(list)
for r in D['campuses']:
    if strong(r):bycity[(r['p'],r['c'])].append(r)
candidates=[]
for r in D['campuses']:
    if r['id'] not in gids:continue
    hits=[]; a=norm(r,False)
    for donor in bycity[(r['p'],r['c'])]:
        s=suffix(a,norm(donor,True))
        if len(s)>=7 and any(m in s for m in markers) and re.search(r'\d',s):hits.append((donor,s))
    ds={d.get('d') for d,_ in hits}
    if hits and len(ds)==1:candidates.append((r,next(iter(ds)),hits))
print('gaps',len(gids),'candidates',len(candidates))
for r,d,hits in candidates:
    best=sorted(hits,key=lambda x:len(x[1]),reverse=True)[:3]
    print('\n',r['id'],'|',r['u'],'->',d,'|',r['address'])
    for donor,s in best:
        print(' suffix=',s,' donor=',donor['id'],donor.get('sourceKind'),donor.get('districtVerified'),donor.get('verified'),'|',donor['address'])
