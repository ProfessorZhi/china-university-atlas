"""Validate the committed data, sources, offline contract and publication hygiene."""
from pathlib import Path
import gzip,json,re,sys
from urllib.parse import urlparse
from build import ROOT,load_data,build,normalized_address
from derived_v53 import terminal_city_boundaries

# A district may not rest on a commercial map pin.  Two red lines say so:
# determining a district from a map POI is forbidden outright, and a Level-3
# `corroborated` district requires a government or official corroborating
# source — a map vendor's geocoder is neither.  Enforced here so the rule is a
# machine gate rather than a convention a future batch can quietly drop.
# Substring match on the host: an entry must cover the vendor's subdomains
# (map.360.cn catches m.map.360.cn) without catching a government host.
MAP_SOURCE_HOSTS=('amap.com','gaode.com','map.baidu.com','map.qq.com','map.360.cn','maps.google','city8.com','mapbar.com','openstreetmap.org')

def map_source_host(url):
    """Return the forbidden map host in `url`, or '' if the URL is admissible."""
    host=urlparse(str(url or '')).netloc.lower()
    return next((m for m in MAP_SOURCE_HOSTS if m in host),'')

def validate():
    d=load_data();u=d['universities'];c=d['campuses'];a=d.get('districtAssociations',[]);aff=d.get('cityAffiliates',{});host=d.get('entityLocationOverrides',{});st=d['stats'];errors=[]
    check=lambda ok,msg:errors.append(msg) if not ok else None
    ids={r['id'] for r in u};names={r['u']:r for r in u};campus_by_id={r['id']:r for r in c};check(len(ids)==len(u),'duplicate university ids');check(len(campus_by_id)==len(c),'duplicate campus ids')
    inactive=[r for r in u if r['level']!='成人' and r.get('rankingEligible') is False]
    for r in inactive:
        check(bool(r.get('entityStatus') and r.get('statusLabel') and r.get('statusEvidence')),'incomplete inactive status '+r['id'])
        check(str(r.get('statusSourceUrl','')).startswith(('https://','http://')),'invalid inactive source '+r['id'])
    regions={(n['p'],n['c'],n['d']) for n in d['regions'].values()};cities={(n['p'],n['c']) for n in d['regions'].values() if n['c'] and not n['d']};positioned=0
    terminal=terminal_city_boundaries(d['regions'])
    for key in [('河南省','济源市'),('广东省','东莞市'),('海南省','儋州市'),('甘肃省','嘉峪关市'),('新疆维吾尔自治区','石河子市')]:check(key in terminal,'terminal legal boundary regression '+('|'.join(key)))
    for row in d.get('cityOnlySchools',[]):check((row.get('省份'),row.get('城市')) not in terminal,'terminal legal boundary wrongly reported city-only '+str(row.get('uid')))
    check(st.get('terminalCityBoundaries')==len(terminal),'wrong terminal city boundary count')
    pending_hosts=0
    for uid,h in host.items():
        check(uid in ids,'orphan host override '+uid);p=h.get('p','');city=h.get('c','');url=str(h.get('sourceUrl',''));evidence=h.get('evidence','');status=h.get('boundaryStatus')
        check(bool(p and city and evidence),'incomplete host override '+uid);check(url.startswith(('https://','http://')),'invalid host override source '+uid)
        if (p,city) not in cities:
            pending_hosts+=1;check(status=='pending-new-region','unmapped host city without pending-new-region '+uid+' '+p+'|'+city)
        else:check(status in [None,'','mapped'],'mapped host city incorrectly marked '+uid)
    check(st.get('pendingNewHostCitySchools')==pending_hosts,'wrong pending host city count')
    direct_inferred=0;inherited_inferred=0
    for r in c:
        check(r['uid'] in ids,'orphan campus '+r['id']);check(r.get('sourceKind') in ['official','government','corroborated','profile','historical'],'missing provenance '+r['id'])
        check(str(r.get('sourceUrl','')).startswith(('https://','http://')),'invalid source URL '+r['id'])
        if r.get('d'):
            check((r['p'],r['c'],r['d']) in regions,'unmapped county '+r['id'])
            bad=map_source_host(r.get('districtSourceUrl'))
            check(not bad,'district rests on commercial map source '+r['id']+' via '+bad)
        method=r.get('districtInferenceMethod')
        if method=='exact-legal-name-in-address':
            direct_inferred+=1
            check(bool(r.get('d')) and str(r.get('d')) in str(r.get('address') or ''),'address-derived district not present verbatim '+r['id'])
            check(r.get('districtSourceKind')=='address-exact','wrong address-derived district source kind '+r['id'])
        elif method=='exact-same-city-address-inheritance':
            inherited_inferred+=1
            check(r.get('districtSourceKind')=='address-inherited','wrong inherited district source kind '+r['id'])
            donors=r.get('districtInheritedFrom') or []
            check(bool(donors),'missing inherited district donors '+r['id'])
            matched=[]
            for donor_id in donors:
                donor=campus_by_id.get(donor_id)
                check(donor is not None,'unknown inherited district donor '+r['id']+' <- '+str(donor_id))
                if donor is None:continue
                same_city=(donor.get('p'),donor.get('c'))==(r.get('p'),r.get('c'))
                same_address=normalized_address(donor.get('address'),donor.get('p'),donor.get('c'))==normalized_address(r.get('address'),r.get('p'),r.get('c'))
                same_d=bool(donor.get('d')) and donor.get('d')==r.get('d')
                check(same_city and same_address and same_d,'invalid inherited district donor '+r['id']+' <- '+str(donor_id))
                if same_city and same_address and same_d:matched.append(donor_id)
            check(bool(matched),'no valid inherited district donor '+r['id'])
        elif method:
            check(False,'unknown district inference method '+r['id'])
        if 'lng' in r or 'lat' in r:
            positioned+=1;check(isinstance(r.get('lng'),(int,float)) and isinstance(r.get('lat'),(int,float)) and 72<r['lng']<136 and 3<r['lat']<55,'invalid coordinates '+r['id'])
    check(st.get('addressInferredCampusDistricts')==direct_inferred,'wrong direct address inferred campus district count')
    check(st.get('exactAddressInheritedCampusDistricts')==inherited_inferred,'wrong exact-address inherited campus district count')
    aids=set()
    for r in a:
        check(r['id'] not in aids,'duplicate association '+r['id']);aids.add(r['id']);check(r['uid'] in ids,'orphan association '+r['id'])
        check(r.get('sourceKind') in ['profile-county','government-district'],'invalid association provenance '+r['id']);check(str(r.get('sourceUrl','')).startswith(('https://','http://')),'invalid association source '+r['id'])
        check((r['p'],r['c'],r['d']) in regions,'unmapped association '+r['id']);check(not any(k in r for k in ['lng','lat','address']),'association must not claim campus precision '+r['id'])
    affiliate_items=0
    for city_key,tiers in aff.items():
        parts=city_key.split('|');check(len(parts)==2,'invalid city affiliate key '+city_key)
        if len(parts)!=2:continue
        p,city=parts;check((p,city) in cities,'unmapped city affiliate '+city_key);seen=set()
        for tier in ['undergraduate','graduate']:
            rows=tiers.get(tier,[]);check(isinstance(rows,list),'invalid affiliate tier '+city_key+' '+tier)
            if not isinstance(rows,list):continue
            for item in rows:
                affiliate_items+=1;name=item.get('name','');parent=item.get('parent','');url=str(item.get('sourceUrl',''));evidence=item.get('evidence','')
                check(bool(name and parent and evidence),'incomplete city affiliate '+city_key+' '+name);check(url.startswith(('https://','http://')),'invalid affiliate source '+city_key+' '+name)
                check(name not in seen,'duplicate city affiliate '+city_key+' '+name);seen.add(name);check(parent in names,'unknown affiliate parent '+city_key+' '+parent)
                if parent in names:check((names[parent]['p'],names[parent]['c'])!=(p,city),'local university wrongly placed in affiliate tier '+city_key+' '+parent)
    check(st.get('districtAssociationRecords')==len(a),'wrong district association count')
    check(st.get('resolvedInactiveOrdinarySchools')==len(inactive),'wrong inactive school count')
    check(st['schoolEntities']==len(u),'wrong entity count');check(st['campusRecords']==len(c),'wrong campus count');check(st['positionedCampuses']==positioned,'wrong point count')
    check(st['officialLocationRecords']==sum(bool(r.get('verified')) for r in c),'wrong official count');check(st['ordinarySchools']==sum(r['level']!='成人' for r in u),'wrong ordinary school count');check(st['ordinarySchoolsWithoutLocations']==len(d['missingSchools']),'wrong missing school count')
    geometry=json.loads(gzip.decompress((ROOT/'data/boundaries.compact.json.gz').read_bytes()));check(len(geometry)==st['boundaryFiles'],'wrong boundary file count')
    html=build().decode();check("connect-src 'none'" in html,'network not disabled by CSP');check('本科校区 / 分校' in html and '研究生院 / 研究院' in html,'city tier UI not embedded');check('rankingEligible!==false' in html,'inactive entity filter not embedded');check(not re.search(r'<(?:script|link)\b[^>]*(?:src|href)\s*=\s*["\']https?://',html,re.I),'external runtime dependency')
    forbidden=re.compile(r'gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|[A-Za-z]:[\\\\/]+Users[\\\\/]+[^\\\\/\s]+|/home/(?:hwz|vince)(?:/|\b)',re.I)
    scanned=0
    for f in ROOT.rglob('*'):
        if not f.is_file() or any(x in f.parts for x in ['.git','__pycache__','release-assets','.work']):continue
        check(not any(x.startswith('test_profile') for x in f.parts),'browser profile tracked');check(f.suffix!='.url','local-device shortcut tracked')
        if f.suffix in ['.gz','.png','.zip']:continue
        text=f.read_text(encoding='utf-8-sig',errors='replace');scanned+=1
        if f.name!='validate.py':check(not forbidden.search(text),'private path or credential pattern in '+str(f.relative_to(ROOT)))
    live_missing=[{'uid':r.get('uid'),'school':r.get('学校'),'province':r.get('省份'),'city':r.get('城市'),'level':r.get('层次')} for r in d.get('missingSchools',[])]
    result={'pass':not errors,'errors':errors,'universities':len(u),'campuses':len(c),'districtAssociations':len(a),'cityAffiliateCities':len(aff),'cityAffiliateItems':affiliate_items,'activeOrdinarySchools':st.get('activeOrdinarySchools'),'inactiveOrdinarySchools':len(inactive),'activeMissingLocations':st.get('ordinarySchoolsWithoutLocations'),'activeMissingSchools':live_missing,'activeCityOnlyLocations':st.get('ordinarySchoolsOnlyCityLocation'),'campusLocationGaps':st.get('campusRecordsOnlyCityLocation'),'addressInferredCampusDistricts':direct_inferred,'exactAddressInheritedCampusDistricts':inherited_inferred,'pendingNewHostCitySchools':pending_hosts,'boundaryFiles':len(geometry),'scannedTextFiles':scanned,'noNetworkBuild':True}
    print(json.dumps(result,ensure_ascii=False,indent=2));return result
if __name__=='__main__':sys.exit(0 if validate()['pass'] else 1)
