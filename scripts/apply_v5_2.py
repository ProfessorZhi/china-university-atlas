"""Apply V5.2 location improvements and district-only evidence. Idempotent."""
from pathlib import Path
import csv, hashlib, json
ROOT=Path(__file__).resolve().parents[1]
DATE='2026-09-08'; VERSION='5.2.0'
def read_json(path): return json.loads(path.read_text(encoding='utf-8'))
def write_json(path,obj): path.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def jsonl(path): return [json.loads(x) for x in path.read_text(encoding='utf-8').splitlines() if x.strip()]
def write_jsonl(path,rows): path.write_text(''.join(json.dumps(x,ensure_ascii=False,separators=(',',':'))+'\n' for x in rows),encoding='utf-8')
def csvout(path,rows,keys=None):
    keys=keys or (list(dict.fromkeys(k for r in rows for k in r)) if rows else [])
    with path.open('w',encoding='utf-8-sig',newline='') as f:
        if not keys:return
        w=csv.DictWriter(f,fieldnames=keys,extrasaction='ignore');w.writeheader();w.writerows(rows)
meta=read_json(ROOT/'data/metadata.json'); regions=read_json(ROOT/'data/regions.json')
universities=jsonl(ROOT/'data/universities.jsonl'); campuses=jsonl(ROOT/'data/campuses.jsonl')
sources=read_json(ROOT/'data/sources.json'); by_name={u['u']:u for u in universities}; by_id={u['id']:u for u in universities}
# Remove prior generated V5.2 records before reapplying.
campuses=[r for r in campuses if not str(r['id']).startswith('V52_')]
additions=read_json(ROOT/'data/overrides/v5.2-authoritative-additions.json')
for a in additions:
    u=by_name[a['u']]
    if (a['p'],a['c'])!=(u['p'],u['c']) and a['u']!='新星职业技术学院':
        raise ValueError(f"registered city mismatch: {a['u']} {u['p']}/{u['c']} vs {a['p']}/{a['c']}")
    if a['d']:
        hit=[(code,n) for code,n in regions.items() if (n['p'],n['c'],n['d'])==(a['p'],a['c'],a['d'])]
        if len(hit)!=1: raise ValueError(f"district not unique: {a}")
    ident='V52_'+hashlib.sha1((u['id']+'|'+a['campus']+'|'+a['address']).encode()).hexdigest()[:14]
    row={**a,'id':ident,'uid':u['id'],'level':u['level'],'rank':u['rank'],'rankLabel':u['rankLabel'],'tags':u['tags'],
         'source':'学校/政府公开资料（V5.2核对）','retrievedAt':DATE,'coordinateStatus':'未提供经纬度；不绘制伪点位'}
    campuses.append(row)
# Build district-only evidence from existing profile county hints. This is not a campus record.
associations=[]
for h in meta.get('locationHints',[]):
    u=by_id.get(h['uid']); n=regions.get(str(h.get('countyId','')))
    if not u or not n or not n.get('d'): continue
    municipality=u['c']==u['p']
    if n['p']!=u['p'] or (not municipality and n['c']!=u['c']): continue
    associations.append({'id':f"A52_{u['id']}_{n['id']}",'uid':u['id'],'u':u['u'],'p':n['p'],'c':n['c'],'d':n['d'],
        'regionId':n['id'],'precision':'district','source':'教育在线院校档案县区字段','sourceKind':'profile-county',
        'sourceUrl':'https://www.gaokao.cn/school/'+str(h.get('profileId','')),'verified':False,'retrievedAt':DATE,
        'status':'仅作为县区归属候选；不代表具体校区地址、精确坐标或当前招生地点'})
# Prefer exact V5.2 campus districts over conflicting third-party county hints.
exact_district={by_name[a['u']]['id']:a['d'] for a in additions if a.get('d')}
associations=[r for r in associations if not (r['uid'] in exact_district and r['d']!=exact_district[r['uid']])]
# Authoritative district-only overrides can correct a wrong profile county without fabricating a campus address.
overrides=read_json(ROOT/'data/overrides/v5.2-authoritative-district-associations.json') if (ROOT/'data/overrides/v5.2-authoritative-district-associations.json').exists() else []
for a in overrides:
    u=by_name[a['u']]; hit=[(code,n) for code,n in regions.items() if (n['p'],n['c'],n['d'])==(a['p'],a['c'],a['d'])]
    if len(hit)!=1: raise ValueError(f"association district not unique: {a}")
    associations=[r for r in associations if r['uid']!=u['id']]
    associations.append({**a,'id':f"A52_AUTH_{u['id']}_{hit[0][0]}",'uid':u['id'],'regionId':hit[0][0],'precision':'district','retrievedAt':DATE,'source':'政府公开县区依据'})
associations=sorted({r['id']:r for r in associations}.values(),key=lambda r:(r['p'],r['c'],r['d'],r['u']))
ordinary=[u for u in universities if u['level']!='成人']; ordinary_ids={u['id'] for u in ordinary}
located={r['uid'] for r in campuses}; county_located={r['uid'] for r in campuses if r.get('d')}
assoc_ids={r['uid'] for r in associations}; assoc_regions={(r['p'],r['c'],r['d']) for r in associations}
missing=[{'uid':u['id'],'学校':u['u'],'省份':u['p'],'城市':u['c'],'层次':u['level'],'档案编号':u.get('profileId',''),'缺口':'具体校区及地址未匹配'} for u in ordinary if u['id'] not in located]
city_only=[{'uid':u['id'],'学校':u['u'],'省份':u['p'],'城市':u['c'],'层次':u['level'],'缺口':'只有市级地点，未映射县区轮廓'} for u in ordinary if u['id'] in located and u['id'] not in county_located]
st=meta['stats']; st.update(campusRecords=len(campuses),positionedCampuses=sum('lng' in r for r in campuses),
    officialCampusAssociations=sum(bool(r.get('verified')) for r in campuses),officialLocationRecords=sum(bool(r.get('verified')) for r in campuses),
    schoolsWithCampuses=len(located),districtsWithCampuses=len({(r['p'],r['c'],r['d']) for r in campuses if r.get('d')}),
    ordinarySchoolsWithLocations=sum(u['id'] in located for u in ordinary),ordinarySchoolsWithoutLocations=len(missing),
    ordinarySchoolsOnlyCityLocation=len(city_only),districtAssociationRecords=len(associations),districtAssociationSchools=len(assoc_ids),verifiedDistrictAssociationRecords=sum(bool(r.get('verified')) for r in associations),
    ordinarySchoolsWithDistrictEvidence=sum(u['id'] in county_located or u['id'] in assoc_ids for u in ordinary),
    districtsWithCandidates=len({(r['p'],r['c'],r['d']) for r in campuses if r.get('d')}|assoc_regions))
meta['missingSchools']=missing; meta['revision']={'version':VERSION,'date':DATE,'previousVersion':'5.1.0',
    'addedAuthoritativeLocationRecords':len(additions),'districtAssociationRecords':len(associations),
    'scope':'补充高置信学校/政府地址，并把县区归属证据与实际校区记录分层建模'}
meta['coverage']=[]
for p in meta['provinceCities']:
    us=[u for u in ordinary if u['p']==p]; rs=[r for r in campuses if r['p']==p]; aa=[r for r in associations if r['p']==p]
    meta['coverage'].append({'province':p,'schools':len(us),'locatedSchools':sum(u['id'] in located for u in us),
        'missingSchools':sum(u['id'] not in located for u in us),'campuses':len(rs),'districtAssociations':len(aa),
        'districts':len({(r['c'],r['d']) for r in rs if r.get('d')}|{(r['c'],r['d']) for r in aa}),
        'allDistricts':sum(n['p']==p and bool(n['d']) for n in regions.values()),'verifiedRecords':sum(bool(r.get('verified')) for r in rs)})
entry={'name':'V5.2地点与县区证据分层','url':'https://github.com/ProfessorZhi/china-university-atlas/blob/main/docs/v5.2.md',
       'note':'新增学校官网/政府公开地点与交叉核对地址；第三方县区字段保存为district association，政府县区资料可覆盖冲突字段。association不作为校园地址或坐标。'}
sources=[s for s in sources if not s.get('name','').startswith('V5.2')]+[entry]
write_jsonl(ROOT/'data/campuses.jsonl',campuses); write_jsonl(ROOT/'data/district-associations.jsonl',associations)
write_json(ROOT/'data/metadata.json',meta); write_json(ROOT/'data/sources.json',sources)
csvout(ROOT/'reports/missing-schools.csv',missing); csvout(ROOT/'reports/city-only-schools.csv',city_only); csvout(ROOT/'reports/district-associations.csv',associations)
csvout(ROOT/'reports/campuses.csv',campuses,['id','uid','u','p','c','d','campus','level','rank','rankLabel','tags','address','sourceName','status','source','sourceUrl','verified','lng','lat','sourceKind','evidence','dataUrl','retrievedAt','locationMethod','coordinateStatus','verifiedAt','addressAliases','notes']); csvout(ROOT/'reports/province-coverage.csv',meta['coverage'])
csvout(ROOT/'reports/v5.2-authoritative-additions.csv',[r for r in campuses if str(r['id']).startswith('V52_')])
write_json(ROOT/'reports/coverage.json',{'stats':st,'coverage':meta['coverage']}); write_json(ROOT/'reports/revision.json',meta['revision'])
(ROOT/'VERSION').write_text(VERSION+'\n',encoding='ascii')
print(json.dumps({'version':VERSION,'campuses':len(campuses),'associations':len(associations),'missing':len(missing),'cityOnly':len(city_only),
 'districtCandidates':st['districtsWithCandidates'],'verifiedLocations':st['officialLocationRecords']},ensure_ascii=False,indent=2))
