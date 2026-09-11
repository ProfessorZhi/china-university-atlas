import sys,re,collections
sys.path.insert(0,'scripts')
from build import load_data
D=load_data(); gids={x['campus_id'] for x in D['campusLocationGaps']}

def variants(label):
    s=str(label or '').strip(); out=[s] if s else []
    special={'广西壮族自治区':'广西','内蒙古自治区':'内蒙古','新疆维吾尔自治区':'新疆','宁夏回族自治区':'宁夏','西藏自治区':'西藏'}
    if s in special: out.append(special[s])
    elif len(s)>2 and s[-1:] in '省市区县': out.append(s[:-1])
    return list(dict.fromkeys(x for x in out if x))

def norm(row,include_d=True):
    text=str(row.get('address') or '').strip()
    labels=variants(row.get('p'))+variants(row.get('c'))
    if include_d: labels+=variants(row.get('d'))
    for label in sorted(labels,key=len,reverse=True): text=text.replace(label,'')
    return re.sub(r'[\s,，。；;()（）\-—_/]+','',text)

donors=collections.defaultdict(set); donor_ids=collections.defaultdict(list)
for row in D['campuses']:
    if not row.get('d') or not norm(row): continue
    key=(row['p'],row['c'],norm(row)); donors[key].add(row['d']); donor_ids[(key,row['d'])].append(row['id'])
candidates=[]; ambiguous=[]
for row in D['campuses']:
    if row['id'] not in gids: continue
    key=(row['p'],row['c'],norm(row,False)); districts=donors.get(key,set())
    if len(districts)==1:
        district=next(iter(districts)); candidates.append((row,district,donor_ids[(key,district)]))
    elif len(districts)>1: ambiguous.append((row,districts))
print('gaps',len(gids),'extraCandidates',len(candidates),'ambiguous',len(ambiguous))
print('provinces',collections.Counter(r['p'] for r,_,_ in candidates).most_common(20))
for row,district,ids in candidates[:100]:
    print(row['id'],'|',row['u'],'|',row['p'],row['c'],'->',district,'|',row['address'],'| donors',ids[:4])
