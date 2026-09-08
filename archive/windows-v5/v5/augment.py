"""Extend V4 with exact-identity school profiles and independently sourced campus confirmations."""
from pathlib import Path
import json,re,unicodedata,collections,hashlib,datetime,gzip,base64,csv,zipfile,shutil
P=Path(__file__).parent; BASE=P.with_name('china_university_offline_v4')
OUT=P.parent/'outputs_v5'; OUT.mkdir(exist_ok=True)
D=json.loads((BASE/'school_data.json').read_text(encoding='utf-8')); baseline=dict(D['stats'])
U={u['id']:u for u in D['universities']}; N=D['regions']; C=D['campuses']; DATE='2026-09-08'
norm=lambda s:re.sub(r'\s+','',unicodedata.normalize('NFKC',str(s or '')))
name_index={norm(u['u']):u for u in U.values()}
provs=list(D['provinceCities']); city_nodes=[n for n in N.values() if n['c'] and not n['d']]
district_nodes=[n for n in N.values() if n['d']]
by_city=collections.defaultdict(list)
for n in district_nodes:by_city[(n['p'],n['c'])].append(n)
cityNames=sorted({n['c'] for n in N.values() if n['c']},key=lambda c:(-len(c),c))
munis=['北京市','天津市','上海市','重庆市','香港特别行政区','澳门特别行政区']
for r in C:r['sourceKind']='official' if r.get('verified') else 'historical'
review=[]; hints=[]; added=[]; changed=[]; snapshots=[]; rejected=collections.Counter()
all_by_uid=collections.defaultdict(list)
for r in C:all_by_uid[r['uid']].append(r)
def addrkey(addr,p='',c='',d=''):
    a=norm(addr)
    for v in [p,c,d]:
        if v:a=a.replace(v,'')
    return re.sub(r'[()（）:：,，、;；。\-—\s]','',a)
def campuskey(s):
    return re.sub(r'校本部|办学地点.*|校区|校园|本部|[()（）\s]','',norm(s))
def generic(s):return s in ['办学地点','办学地点（源未注明校区名）','本部','校本部','主校区','分校区','学校地址','']
def locate(text,u,profile,allow_code):
    p=u['p']; city=u['c']; method=''
    explicit_p=[a for a in provs if a in text]
    if len(explicit_p)==1:p=explicit_p[0]
    explicit_c=sorted([a for a in cityNames if a in text],key=lambda c:(text.index(c),-len(c),c))
    if explicit_c:
        cn=explicit_c[0]; options=[n for n in N.values() if n['c']==cn]
        ps={n['p'] for n in options}
        if len(ps)==1:p=next(iter(ps));city=cn
        elif p in ps:city=cn
    if p in munis:city=p
    choices=by_city.get((p,city),[])
    exact=[n for n in choices if n['d'] in text]
    if exact:
        longest=max(len(n['d']) for n in exact);exact=[n for n in exact if len(n['d'])==longest]
        if len(exact)==1:return exact[0],'地址明确列出县区'
    if not explicit_c:
        exact=[n for n in district_nodes if n['p']==p and len(n['d'])>=3 and n['d'] in text]
        if exact:
            longest=max(len(n['d']) for n in exact);exact=[n for n in exact if len(n['d'])==longest]
            if len(exact)==1:return exact[0],'地址县区在省内唯一匹配'
    if allow_code:
        n=N.get(str(profile.get('county_id','')))
        if n and n['p']==p and (not explicit_c or n['c']==city):return n,'第三方档案县区代码（非官网核验）'
    if (p,city) in by_city or city in D['provinceCities'].get(p,[]):return {'p':p,'c':city,'d':''},'仅定位至城市，县区待核'
    return None,'地区无法映射当前边界快照'

def add_record(new):
    pool=[r for r in all_by_uid[new['uid']] if (r['p'],r['c'],r['d'])==(new['p'],new['c'],new['d'])]
    ak=addrkey(new['address'],new['p'],new['c'],new['d']); ck=campuskey(new['campus'])
    hits=[]
    for r in pool:
        old=addrkey(r.get('address',''),r['p'],r['c'],r['d'])
        same_address=len(ak)>=5 and ak==old
        same_name=ck and len(ck)>=2 and not generic(new['campus']) and ck==campuskey(r['campus'])
        if same_address or (new.get('verified') and same_name):hits.append(r)
    if hits:
        target=sorted(hits,key=lambda r:not r.get('verified'))[0]
        evidence={'source':new['source'],'url':new['sourceUrl'],'address':new['address'],'campus':new['campus'],'retrieved':DATE}
        target.setdefault('evidence',[]).append(evidence)
        if not target.get('verified') or new.get('verified'):
            prior=addrkey(target.get('address',''),target['p'],target['c'],target['d'])
            if new.get('verified') and prior!=ak:
                target.pop('lng',None);target.pop('lat',None)
            preserved={k:target[k] for k in ['id','lng','lat','evidence'] if k in target}
            target.update(new);target.update(preserved)
            if target.get('lng') is not None:target['coordinateStatus']='历史POI坐标；非本轮测绘核验'
        changed.append(target['id']);return target
    C.append(new);all_by_uid[new['uid']].append(new);added.append(new['id']);return new

jobs=json.loads((P/'profile_matching.json').read_text(encoding='utf-8'))
for sid,uid in jobs:
    f=P/'profiles'/(sid+'.json')
    if not f.exists():rejected['download_missing']+=1;continue
    raw=f.read_bytes();v=json.loads(raw)['data'];u=U[uid]
    if norm(v.get('name'))!=norm(u['u']):
        rejected['name_changed_after_selection']+=1;review.append({'school':u['u'],'reason':'档案名称已变化，未自动合并','rawName':v.get('name'),'profileId':sid});continue
    address=re.sub('<[^>]*>',' ',str(v.get('address',''))).strip()
    snapshots.append({k:v.get(k) for k in ['school_id','name','province_name','city_name','town_name','county_id','address','school_site','zs_code']}|{'sha256':hashlib.sha256(raw).hexdigest(),'retrieved':DATE})
    u.update(profileId=sid,officialWebsite=v.get('school_site',''),profileAddress=address)
    if not address:
        rejected['profile_address_empty']+=1;hints.append({'uid':uid,'school':u['u'],'profileId':sid,'countyId':v.get('county_id'),'county':v.get('town_name'),'reason':'只有档案县区字段，未伪造校区记录'});continue
    parts=[x.strip() for x in re.split(r'[,，;；\r\n]+|、(?=[^、]{0,18}校[区园][:：])',address) if x.strip()]
    for index,part in enumerate(parts):
        if re.search(r'筹建|拟建|在建|建设中|拟迁|培训中心|函授站|附属医院|研究院|研究生院',part):
            review.append({'school':u['u'],'address':part,'profileId':sid,'reason':'规划/非普通校园/研究生教学单位，需单独核验后再纳入'});continue
        m=re.match(r'^(.{1,32}?)(?:：|:)(.+)$',part)
        cp,addr=(m.group(1).strip(),m.group(2).strip()) if m else ('办学地点（档案未命名）',part)
        if cp in ['学校地址','地址']:cp='办学地点（档案未命名）'
        if len(addr)<5:continue
        loc,method=locate(addr,u,v,len(parts)==1)
        if not loc:
            review.append({'school':u['u'],'address':part,'profileId':sid,'reason':method});continue
        bare=addr
        for p in [loc['p'],loc['c'],loc['d']]:
            if p:bare=bare.replace(p,'')
        if len(norm(bare))<3:
            hints.append({'uid':uid,'school':u['u'],'profileId':sid,'countyId':v.get('county_id'),'county':loc['d'],'reason':'地址过于笼统，未作为实际校园'});continue
        if not loc['d']:review.append({'school':u['u'],'address':part,'profileId':sid,'reason':method})
        ident='PROFILE'+sid+'_'+str(index)
        row={'id':ident,'uid':uid,'u':u['u'],'p':loc['p'],'c':loc['c'],'d':loc['d'],'campus':cp,'address':addr,'level':u['level'],'rank':u['rank'],'rankLabel':u['rankLabel'],'tags':u['tags'],'sourceName':v['name'],'source':'教育在线院校档案','sourceKind':'profile','sourceUrl':'https://www.gaokao.cn/school/'+sid,'dataUrl':'https://static-data.gaokao.cn/www/2.0/school/'+sid+'/info.json','verified':False,'retrievedAt':DATE,'locationMethod':method,'status':'本轮读取第三方档案 · '+method+' · 办学状态仍需官网复核'}
        add_record(row)

for a in json.loads((P/'official_additions.json').read_text(encoding='utf-8')) if (P/'official_additions.json').exists() else []:
    u=name_index.get(norm(a['u']))
    if not u:review.append({'school':a['u'],'reason':'官网增补学校名未匹配主体'});continue
    record=dict(a,id='OFF5_'+hashlib.sha1((u['id']+'|'+a['campus']+'|'+a['address']).encode()).hexdigest()[:12],uid=u['id'],level=u['level'],rank=u['rank'],rankLabel=u['rankLabel'],tags=u['tags'],source='学校官网 / 官方招生资料',sourceKind='official',verified=True,verifiedAt=DATE,status='官网核对校区名称和地址 · 未核验精确坐标')
    add_record(record)
# Resolve duplicate records only when an official campus association identifies the same campus.
superseded=[]; quarantine=[]; remove_ids=set()
rename={'国际校区(海宁':'海宁国际','国际校区（海宁）':'海宁国际','象山中心':'象山','广州东':'广州东'}
def canonical_campus(r):
    k=campuskey(r['campus']).replace('（','').replace('）','').replace('(','').replace(')','')
    if r['u']=='浙江大学' and '海宁' in k and '国际' in k:return '海宁国际'
    if r['u']=='中国美术学院' and k=='象山中心':return '象山'
    return k
for official in [r for r in C if r.get('verified')]:
    ck=canonical_campus(official)
    if not ck or generic(official['campus']):continue
    for r in C:
        if r is official or r.get('verified') or r['id'] in remove_ids:continue
        if r['uid']!=official['uid'] or r['c']!=official['c'] or canonical_campus(r)!=ck:continue
        # An explicit, different nonempty district remains a conflict rather than a forced merge.
        if r['d'] and official['d'] and r['d']!=official['d']:continue
        official.setdefault('evidence',[]).append({'source':r['source'],'url':r['sourceUrl'],'address':r['address'],'campus':r['campus'],'recordId':r['id'],'note':'同校同名校区合并；官网地址和区县优先，旧坐标未迁移'})
        superseded.append({'id':r['id'],'school':r['u'],'campus':r['campus'],'retainedId':official['id'],'reason':'官网关联去重或校区区县补全'});remove_ids.add(r['id'])
for r in C:
    if r['u']=='浙江大学' and r['campus']=='宁波校区' and r['sourceKind']=='profile':
        quarantine.append(r|{'reason':'第三方列为宁波校区，但2026学校官网列举的七校区不含此项；不据此改变宁波最佳大学','verificationSource':'https://zjui.intl.zju.edu.cn/join-info/3342'});remove_ids.add(r['id'])
C[:]=[r for r in C if r['id'] not in remove_ids]
D['supersededRecords']=superseded;D['quarantinedRecords']=quarantine
review.extend({'school':r['u'],'address':r['address'],'reason':r['reason'],'sourceUrl':r['sourceUrl'],'verificationSource':r['verificationSource']} for r in quarantine)

ordinary=[u for u in U.values() if u['level']!='成人']
located={r['uid'] for r in C}; county_located={r['uid'] for r in C if r['d']}
missing=[{'uid':u['id'],'学校':u['u'],'省份':u['p'],'城市':u['c'],'层次':u['level'],'档案编号':u.get('profileId',''),'缺口':'具体校区及地址未匹配'} for u in ordinary if u['id'] not in located]
missing_county=[{'uid':u['id'],'学校':u['u'],'省份':u['p'],'城市':u['c'],'层次':u['level'],'缺口':'只有市级地点，未映射县区轮廓'} for u in ordinary if u['id'] in located and u['id'] not in county_located]
D['locationHints']=hints;D['missingSchools']=missing;D['unresolvedCampusAddresses']=review
D['sources'].append({'name':'教育在线院校档案（2026-09-08读取）','url':'https://www.gaokao.cn/school','note':'按学校现名精确匹配2896份公开档案，再拆分其地址字段。属于第三方位置候选，不作为官方办学状态核验；没有地址或区县冲突的项进入缺失/待核清单。每条记录保留来源网址、档案ID和位置匹配方式；不继承该来源的排名。'})
D['sources'].append({'name':'本轮学校官网校区核对','url':'https://www.sysu.edu.cn/xxg/zdxq.htm','note':'各条官网记录有各自sourceUrl/核对日期。官网校区与地址核对不代表已核验各年招生专业或精确经纬度；缺坐标时不绘制伪点。'})
st=D['stats']; st.update(campusRecords=len(C),positionedCampuses=sum('lng' in r for r in C),officialCampusAssociations=sum(bool(r.get('verified')) for r in C),schoolsWithCampuses=len(located),districtsWithCampuses=len({(r['p'],r['c'],r['d']) for r in C if r['d']}),ordinarySchoolsWithLocations=sum(u['id'] in located for u in ordinary),ordinarySchoolsWithoutLocations=len(missing),ordinarySchoolsOnlyCityLocation=len(missing_county),profileRecordsFetched=2896,profileLocationRecords=sum(r['sourceKind']=='profile' for r in C),historicalLocationRecords=sum(r['sourceKind']=='historical' for r in C),officialLocationRecords=sum(r['sourceKind']=='official' for r in C),profileLocationHints=len(hints),addressesToReview=len(review))
st['districtsWithCandidates']=st['districtsWithCampuses'];st['profileRejections']=dict(rejected)
D['coverage']=[]
for p in provs:
    us=[u for u in ordinary if u['p']==p];rs=[r for r in C if r['p']==p]
    D['coverage'].append({'province':p,'schools':len(us),'campuses':len(rs),'districts':len({(r['c'],r['d']) for r in rs if r['d']}),'allDistricts':sum(n['p']==p and bool(n['d']) for n in N.values()),'locatedSchools':sum(u['id'] in located for u in us),'missingSchools':sum(u['id'] not in located for u in us),'officialRecords':sum(bool(r.get('verified')) for r in rs)})
D['revision']={'version':'5.0','date':DATE,'baseline':baseline,'newRecordIds':[i for i in added if i in {r['id'] for r in C}],'updatedRecordIds':sorted(set(changed)&{r['id'] for r in C}),'scope':'全国大陆普通高校地址批量补充；多校区官网重点核对；港澳台名录本轮尚未系统补全'}
def dump(path,obj):path.write_text(json.dumps(obj,ensure_ascii=False,indent=2),encoding='utf-8')
def csvout(name,rows):
    if not rows:return
    keys=list(dict.fromkeys(k for r in rows for k in r))
    with (OUT/(name+'.csv')).open('w',encoding='utf-8-sig',newline='') as f:
        w=csv.DictWriter(f,fieldnames=keys);w.writeheader();w.writerows({k:json.dumps(v,ensure_ascii=False) if isinstance(v,(dict,list)) else v for k,v in r.items()} for r in rows)
J=lambda o:json.dumps(o,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')
(P/'school_data_v5.json').write_text(J(D),encoding='utf-8')
dump(OUT/'数据覆盖统计.json',st);dump(OUT/'版本增补记录.json',D['revision']);dump(OUT/'院校地址档案快照.json',snapshots)
for name,rows in [('校区与办学地点',C),('学校主体名录',list(U.values())),('仍缺具体地址的普通高校',missing),('仅定位至城市的普通高校',missing_county),('待人工核对地址',review),('省级数据覆盖',D['coverage'])]:csvout(name,rows)
print('AUGMENTED',json.dumps(st,ensure_ascii=False),flush=True)
print('MISSING_SAMPLE',json.dumps(missing[:40],ensure_ascii=False),flush=True)
