"""Build a self-contained, source-tagged university atlas. Uses only local source snapshots."""
import csv, json, math, pathlib, tempfile, re, gzip, base64, hashlib, unicodedata, collections, sys, zipfile
P=pathlib.Path(__file__).parent
OUT=P.parent/'outputs_v4'
OUT.mkdir(parents=True,exist_ok=True)
G={f.stem:json.loads(f.read_bytes()) for f in sorted((P/'maps').glob('*.json'))}
D={'provinceCities':{},'provinceBest':{},'cityBest':{},'districts':{},'campuses':[],'universities':[],'sources':[]}
N={};district_geoms={};pname={};city_ids={}
def norm(s): return re.sub(r'\s+','',unicodedata.normalize('NFKC',str(s or '')))
def rings(f):
    g=f['geometry']; polys=[g['coordinates']] if g['type']=='Polygon' else g['coordinates'] if g['type']=='MultiPolygon' else []
    return [r for poly in polys for r in poly if len(r)>=4]
def box(rs):
    pts=[p for r in rs for p in r]
    return [min(p[0] for p in pts),min(p[1] for p in pts),max(p[0] for p in pts),max(p[1] for p in pts)] if pts else [0,0,0,0]
for f in G['100000']['features']:
    a=f['properties']; pn=a.get('name'); pid=str(a.get('adcode'))
    if not pn:continue
    pname[pid]=pn;N[pid]={'p':pn,'c':'','d':'','name':pn,'id':pid,'parent':'100000'};D['provinceCities'][pn]=[]
    for cf in G.get(pid,{}).get('features',[]):
        b=cf['properties']; cid=str(b['adcode']); cn=b['name']; municipal=pid in ['110000','120000','310000','500000','810000','820000']
        c=pn if municipal else cn
        if c not in D['provinceCities'][pn]:D['provinceCities'][pn].append(c)
        key=pn+'|'+c;D['districts'].setdefault(key,[])
        if b.get('level')=='district':
            D['districts'][key].append(cn);N[cid]={'p':pn,'c':c,'d':cn,'name':cn,'id':cid,'parent':pid};rs=rings(cf);district_geoms[cid]=(rs,box(rs));city_ids.setdefault((pn,c),pid)
        else:
            N[cid]={'p':pn,'c':c,'d':'','name':cn,'id':cid,'parent':pid};city_ids[(pn,c)]=cid
            for df in G.get(cid,{}).get('features',[]):
                q=df['properties'];did=str(q['adcode']);dn=q['name'];D['districts'][key].append(dn);N[did]={'p':pn,'c':c,'d':dn,'name':dn,'id':did,'parent':cid};rs=rings(df);district_geoms[did]=(rs,box(rs))
# Index only real source polygons; never make synthetic county rectangles.
place_idx=collections.defaultdict(list)
for n in N.values():place_idx[(n['p'],norm(n['name']))].append(n)
short_p={re.sub(r'壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区|省|市','',v):v for v in pname.values()}
city_alias={'恩施州':'恩施土家族苗族自治州','湘西州':'湘西土家族苗族自治州','黔南州':'黔南布依族苗族自治州','黔东南州':'黔东南苗族侗族自治州','黔西南州':'黔西南布依族苗族自治州','阿坝州':'阿坝藏族羌族自治州','甘孜州':'甘孜藏族自治州','凉山州':'凉山彝族自治州','伊犁州':'伊犁哈萨克自治州','昌吉州':'昌吉回族自治州','博州':'博尔塔拉蒙古自治州','巴州':'巴音郭楞蒙古自治州','克州':'克孜勒苏柯尔克孜自治州','临夏州':'临夏回族自治州','甘南州':'甘南藏族自治州'}
def resolve_place(p,c):
    c=city_alias.get(c,c);hit=place_idx.get((p,norm(c)),[])
    if hit:return sorted(hit,key=lambda x:bool(x['d']))[0]
    if c in ['北京市','天津市','上海市','重庆市']:
        return next((n for n in N.values() if n['name']==c and not n['c']),None)
    cross=[n for n in N.values() if n['name']==c and n['c'] and not n['d']]
    if len(cross)==1:return cross[0]
    stem=re.sub(r'自治州|地区|市$','',c)
    h=[n for n in N.values() if n['p']==p and n['c'] and not n['d'] and stem and n['name'].startswith(stem)]
    return h[0] if len(h)==1 else None
ranks=list(csv.DictReader((P/'rank.csv').read_text(encoding='utf-8-sig').splitlines()));R={norm(r['name_cn']):(i,r) for i,r in enumerate(ranks)}
registry=list(csv.DictReader((P/'moe.csv').read_text(encoding='utf-8-sig').splitlines()));adults=list(csv.DictReader((P/'adult.csv').read_text(encoding='utf-8-sig').splitlines()))
U={};name_idx={};unresolved=[]
for r in registry+adults:
    name=r['学校名称'];p=r['省级地区'];loc=r.get('所在地','');level=r.get('办学层次') or '成人';z=resolve_place(p,loc);rank=R.get(norm(name));i,rr=rank if rank else (999999,{})
    u={'id':r['学校标识码'],'u':name,'p':z['p'] if z else p,'c':(z['c'] or z['p']) if z else loc,'d':z['d'] if z else '', 'regp':p,'hostRaw':loc,'level':level,'rankLabel':rr.get('current_rank',''),'rank':i if rr.get('current_rank') else 999999,'tags':[t for k,t in [('is_985','985'),('is_211','211'),('is_double_first_class','双一流')] if rr.get(k)=='true'],'private':'民办' in r.get('备注',''),'source':'教育部2026名录（CSV镜像）','notes':r.get('备注','')}
    U[u['id']]=u;name_idx[norm(name)]=u
    if not z and level!='成人':unresolved.append([name,p,loc])
D['universities']=list(U.values())
def score(u): return (0 if u['level']=='本科' else 1 if u['level']=='专科' else 2,0 if '985' in u['tags'] else 1 if '211' in u['tags'] else 2 if '双一流' in u['tags'] else 3,u['rank'],u['private'],u['u'])
# Only explicitly supplied, source-backed name aliases are applied. Unmatched old names remain excluded.
aliases=json.loads((P/'name_aliases.json').read_text(encoding='utf-8')) if (P/'name_aliases.json').exists() else {}
for a,b in aliases.items():
    if norm(b) in name_idx:name_idx[norm(a)]=name_idx[norm(b)]
name_keys=sorted(name_idx,key=len,reverse=True)
by_city=collections.defaultdict(list)
for did,n in N.items():
    if n['d']:by_city[(n['p'],n['c'])].append(did)
def in_ring(x,y,r):
    inside=False
    for i in range(len(r)):
        x1,y1=r[i-1][:2];x2,y2=r[i][:2]
        if (y1>y)!=(y2>y) and x<(x2-x1)*(y-y1)/(y2-y1)+x1:inside=not inside
    return inside
def contains(x,y,rs,b):
    if not (b[0]<=x<=b[2] and b[1]<=y<=b[3]):return False
    return sum(in_ring(x,y,r) for r in rs)%2==1
# Baidu POI defaults to BD-09; translate to GCJ-02 for the AMap-derived DataV boundaries.
def bd_gcj(lon,lat):
    x,y=lon-.0065,lat-.006;z=math.hypot(x,y)-.00002*math.sin(y*math.pi*3000/180);t=math.atan2(y,x)-.000003*math.cos(x*math.pi*3000/180)
    return z*math.cos(t),z*math.sin(t)
exclude=re.compile('附属|附中|附小|医院|幼儿园|中学|小学|老年|老干部|培训|函授|继续教育|成人教育|远程教育|网络教育|研究院|研究生院|研究中心|招生|办事处|办公|宿舍|招待|宾馆|停车场|家属|体育馆|科技园|服务中心|产业园|在建|建设中|筹建|旧址|遗址|已撤销|拟建|培训中心|教学点|教学站|函授站')
raw=[]
for fn in ['poi.json','poi_schools.json']:
    if (P/fn).exists():raw.extend(json.loads((P/fn).read_bytes()))
rejected=collections.Counter();matched=[];seen=set()
for r in raw:
    nm=norm(r.get('name'));p=r.get('province','');c=r.get('city','');area=r.get('area','');u=None;key=''
    if exclude.search(nm):rejected['excluded_non_campus']+=1;continue
    if nm in name_idx:key=nm;u=name_idx[nm]
    else:
        for k in name_keys:
            if nm.startswith(k):
                suffix=nm[len(k):]
                if re.search('校区|分校|校园|校本部|本部|新校|旧校|东院|西院|北院|南院|大学城',suffix) and not re.search('学院|高中|小区|校门|餐厅|食堂|图书|书院|实验室',suffix):key=k;u=name_idx[k]
                break
    if not u:rejected['school_identity_unmatched']+=1;continue
    if p!=u['p'] and not re.search('校区|分校|校园',nm):rejected['ambiguous_cross_province']+=1;continue
    if p not in D['provinceCities']:rejected['outside_boundary_scope']+=1;continue
    loc=r.get('location',{});x,y=loc.get('lng'),loc.get('lat')
    if not isinstance(x,(int,float)) or not isinstance(y,(int,float)) or not 72<x<136 or not 3<y<55:rejected['no_valid_coordinates']+=1;continue
    x,y=bd_gcj(x,y);cn=city_alias.get(c,c)
    if p in ['北京市','天津市','上海市','重庆市']:cn=p
    if (p,cn) not in by_city:
        q=resolve_place(p,cn)
        if q:cn=q['c'] or q['p']
    ids=by_city.get((p,cn),[]);picked=None
    for did in ids:
        rs,b=district_geoms[did]
        if contains(x,y,rs,b):picked=N[did];break
    status='历史POI · 坐标匹配（办学状态未复核）'
    if not picked:
        hits=[N[i] for i in ids if N[i]['d']==area]
        if len(hits)==1:picked=hits[0];status='历史POI · 区县名称匹配（坐标待复核）';x=y=None
    if not picked:
        # Direct-admin cities without county geometry keep city-level records, not fabricated districts.
        if (p,cn) in city_ids and not ids:picked={'p':p,'c':cn,'d':''};status='历史POI · 市级位置（无县级轮廓）'
        else:rejected['district_unresolved']+=1;continue
    suffix=nm[len(key):].strip('()（） -·')
    campus=suffix or '办学地点（源未注明校区名）'
    dedup=(u['id'],picked['p'],picked['c'],picked['d'],round(x,4) if x is not None else campus,round(y,4) if y is not None else '')
    if dedup in seen:rejected['duplicate']+=1;continue
    seen.add(dedup)
    a={'id':'POI'+str(len(matched)+1),'uid':u['id'],'u':u['u'],'p':picked['p'],'c':picked['c'],'d':picked['d'],'campus':campus,'level':u['level'],'rank':u['rank'],'rankLabel':u['rankLabel'],'tags':u['tags'],'address':r.get('address',''),'sourceName':r.get('name',''),'status':status,'source':'Baidu POI公开快照 · pg7go','sourceUrl':'https://github.com/pg7go/The-Location-Data-of-Schools-in-China','verified':False}
    if x is not None:a.update(lng=round(x,6),lat=round(y,6))
    matched.append(a)
# Optional curated records: authoritative district/campus associations, no invented coordinates.
if (P/'curated.json').exists():
    for a in json.loads((P/'curated.json').read_text(encoding='utf-8')):
        u=name_idx.get(norm(a['u']))
        if not u:continue
        existing=[r for r in matched if r['uid']==u['id'] and r['p']==a['p'] and r['c']==a['c'] and r['d']==a['d'] and a['campus'].replace('校区','') in r['campus']]
        if existing:
            for r in existing:r.update(sourceUrl=a['sourceUrl'],source='学校官网校区资料',verified=True,status='官网核对校区/区县 · 坐标仍来自POI')
        else:matched.append(dict(a,id='OFFICIAL'+str(len(matched)),uid=u['id'],level=u['level'],rank=u['rank'],rankLabel=u['rankLabel'],tags=u['tags'],verified=True,status='官网核对校区/区县 · 未设置坐标',source='学校官网校区资料'))
D['campuses']=matched
for p in D['provinceCities']:
    us=sorted([u for u in U.values() if u['p']==p and u['level']!='成人'],key=score)
    if us:D['provinceBest'][p]=us[0]['u']
    for c in D['provinceCities'][p]:
        vs=sorted([u for u in us if u['c']==c],key=score)
        if vs:D['cityBest'][p+'|'+c]=vs[0]['u']
D['provinceBest'].update({'香港特别行政区':'香港大学','澳门特别行政区':'澳门大学','台湾省':'国立台湾大学'})
# Fixed immutable provenance for the sources retained in this snapshot.
D['sources']=[{'name':'教育部全国高等学校名单（2026-06-17）','url':'https://www.moe.gov.cn/jyb_xxgk/s5743/s5744/A03/202606/t20260618_1441074.html','note':'普通高校2952所、成人高校244所；本文件读取开源项目转录CSV并保留全部条目。'}, {'name':'名录与软科字段CSV镜像','url':'https://github.com/theo-the-menace/China-World-University-Index','note':'排名保留主榜/分类榜原标签；院校库顺序仅供候选排序，不声称为统一全国名次。'}, {'name':'全国学校/大学位置POI','url':'https://github.com/pg7go/The-Location-Data-of-Schools-in-China','note':'原采集时间未逐条注明；匹配至现行名录不代表校区仍在办学。过滤中小学、医院、培训、函授、研究院及未匹配实体。'}, {'name':'DataV.GeoAtlas','url':'https://datav.aliyun.com/portal/school/atlas/area_selector','note':'363份可获得的省市县边界已内嵌；采用源行政区划快照，不是2026实时测绘图。台湾仅省级轮廓；少数不设县区城市保留本级真实轮廓。'}]
D['sources'].append({'name':'更名关联依据（教育部批复）','url':'https://www.moe.gov.cn/srcsite/A03/s181/202603/t20260319_1431461.html','note':'湖州师范学院→湖州师范大学；绍兴文理学院→绍兴大学（1431459）；安徽科技学院→安徽科技工程大学（1431452）。北师香港浸会大学更名由该校2025-03-11通告确认：https://bnbu.edu.cn/info/1078/105619.htm。名称匹配不等于旧校区仍在使用。'})
# Geometry simplification keeps all polygon components; small islands are not intentionally deleted.
def rdp(points,eps):
    if len(points)<=4:return points
    keep={0,len(points)-1};stack=[(0,len(points)-1)];e2=eps*eps
    while stack:
        s,e=stack.pop();a,b=points[s],points[e];dx,dy=b[0]-a[0],b[1]-a[1];den=dx*dx+dy*dy;m=e2;k=-1
        for i in range(s+1,e):
            v=points[i];t=max(0,min(1,((v[0]-a[0])*dx+(v[1]-a[1])*dy)/den)) if den else 0;d=(v[0]-a[0]-t*dx)**2+(v[1]-a[1]-t*dy)**2
            if d>m:m=d;k=i
        if k>=0:keep.add(k);stack.extend([(s,k),(k,e)])
    out=[points[i] for i in sorted(keep)]
    return out if len(out)>=4 else points

def encode(r):
    out=[];x=y=0
    for lon,lat,*_ in r:
        xx,yy=round(lon*1000),round(lat*1000)
        for d in [xx-x,yy-y]:
            n=-d*2-1 if d<0 else d*2
            while n>=32:out.append(chr((32|(n&31))+63));n>>=5
            out.append(chr(n+63))
        x,y=xx,yy
    return ''.join(out)
compact={};points=0
for code,g in G.items():
    rows=[]
    for f in g['features']:
        a=f['properties'];rs=[rdp(r,.0012) for r in rings(f)];points+=sum(map(len,rs))
        rows.append([a.get('adcode',0),a.get('name',''),a.get('centroid') or a.get('center'),a.get('level',''),a.get('childrenNum',0),[encode(r) for r in rs]])
    compact[code]=rows
D['regions']=N
D['stats']={'ordinarySchools':len(registry),'bachelorSchools':sum(u['level']=='本科' for u in U.values()),'vocationalSchools':sum(u['level']=='专科' for u in U.values()),'adultSchools':len(adults),'schoolEntities':len(U),'campusRecords':len(matched),'positionedCampuses':sum('lng' in a for a in matched),'officialCampusAssociations':sum(a['verified'] for a in matched),'schoolsWithCampuses':len({a['uid'] for a in matched}),'districtsWithCampuses':len({(a['p'],a['c'],a['d']) for a in matched if a['d']}),'districtPolygons':len(district_geoms),'districtsWithCandidates':len({(a['p'],a['c'],a['d']) for a in matched if a['d']}|{(u['p'],u['c'],u['d']) for u in U.values() if u['d'] and u['level']!='成人'}),'cityLabels':len(D['cityBest']),'boundaryFiles':len(compact),'rawPOIRecords':len(raw),'rejectedPOI':dict(rejected),'unresolvedRegistryPlaces':unresolved,'pointsAfterSimplification':points}
D['coverage']=[]
for p in D['provinceCities']:
    us=[u for u in U.values() if u['p']==p and u['level']!='成人'];cs=[r for r in matched if r['p']==p]
    D['coverage'].append({'province':p,'schools':len(us),'campuses':len(cs),'districts':len({r['c']+'|'+r['d'] for r in cs if r['d']}),'allDistricts':sum(n['p']==p and bool(n['d']) for n in N.values())})
j=lambda x:json.dumps(x,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')
(P/'school_data.json').write_text(j(D),encoding='utf-8');(P/'geo_compact.json').write_text(j(compact),encoding='utf-8');(P/'stats.json').write_text(json.dumps(D['stats'],ensure_ascii=False,indent=2),encoding='utf-8')
manifest={'complete':True,'maps':len(compact),'preparedAt':'2026-09-08','source':'DataV.GeoAtlas + MOE 2026 registry / CSV mirror + historical Baidu POI','schoolDataComplete':'仅名录主体覆盖完整；校区并未全部逐条核验'}
template=(P/'ui_template.html').read_text(encoding='utf-8');html=template.replace('__SCHOOL_DATA__',j(D)).replace('__GEO_DATA__',base64.b64encode(gzip.compress(j(compact).encode('utf-8'),compresslevel=9)).decode()).replace('__MANIFEST__',j(manifest))
file=OUT/'全国高校地图_离线数据增强版.html';file.write_text(html,encoding='utf-8')
(OUT/'数据覆盖统计.json').write_text(json.dumps(D['stats'],ensure_ascii=False,indent=2),encoding='utf-8')
for kind,rows in [('学校主体名录',list(U.values())),('校区与办学地点',matched),('省级数据覆盖',D['coverage'])]:
    fields=list(dict.fromkeys(k for r in rows for k in r))
    with (OUT/(kind+'.csv')).open('w',encoding='utf-8-sig',newline='') as fh:
        w=csv.DictWriter(fh,fieldnames=fields);w.writeheader();w.writerows(rows)
(OUT/'来源说明.txt').write_text('\n\n'.join(s['name']+'\n'+s['url']+'\n'+s['note'] for s in D['sources']),encoding='utf-8')
zip_path=OUT/'全国高校地图_离线数据增强版.zip'
with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for f in OUT.iterdir():
        if f!=zip_path and f.is_file() and f.suffix in ['.html','.csv','.json','.txt']:z.write(f,f.name)
print('OUTPUT',file,flush=True);print('SIZE',file.stat().st_size,zip_path.stat().st_size,flush=True);print(json.dumps(D['stats'],ensure_ascii=False),flush=True)
