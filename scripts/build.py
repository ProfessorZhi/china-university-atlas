"""Deterministic offline HTML build. Python 3.10+; no network or dependencies."""
from pathlib import Path
import argparse,base64,gzip,hashlib,json,sys,zipfile
ROOT=Path(__file__).resolve().parents[1]
def jsonl(path):
    if not path.exists():return []
    return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line.strip()]
def refresh_derived(data):
    universities=data['universities'];campuses=data['campuses'];associations=data.get('districtAssociations',[]);regions=data['regions'];st=data['stats']
    ordinary=[u for u in universities if u['level']!='成人'];ordinary_ids={u['id'] for u in ordinary};located={r['uid'] for r in campuses};county={r['uid'] for r in campuses if r.get('d')};assoc_ids={a['uid'] for a in associations}
    missing=[{'uid':u['id'],'学校':u['u'],'省份':u['p'],'城市':u['c'],'层次':u['level'],'档案编号':u.get('profileId',''),'缺口':'具体校区及地址未匹配'} for u in ordinary if u['id'] not in located]
    city_only=[{'uid':u['id'],'学校':u['u'],'省份':u['p'],'城市':u['c'],'层次':u['level'],'缺口':'只有市级地点，未映射县区轮廓'} for u in ordinary if u['id'] in located and u['id'] not in county]
    campus_regions={(r['p'],r['c'],r['d']) for r in campuses if r.get('d')};assoc_regions={(a['p'],a['c'],a['d']) for a in associations if a.get('d')}
    st.update(campusRecords=len(campuses),positionedCampuses=sum(isinstance(r.get('lng'),(int,float)) and isinstance(r.get('lat'),(int,float)) for r in campuses),schoolsWithCampuses=len(located),districtsWithCampuses=len(campus_regions),ordinarySchoolsWithLocations=sum(u['id'] in located for u in ordinary),ordinarySchoolsWithoutLocations=len(missing),ordinarySchoolsOnlyCityLocation=len(city_only),officialCampusAssociations=sum(bool(r.get('verified')) for r in campuses),officialLocationRecords=sum(bool(r.get('verified')) for r in campuses),corroboratedLocationRecords=sum(r.get('sourceKind')=='corroborated' for r in campuses),districtAssociationRecords=len(associations),districtAssociationSchools=len(assoc_ids),verifiedDistrictAssociationRecords=sum(bool(a.get('verified')) for a in associations),ordinarySchoolsWithDistrictEvidence=sum(u['id'] in county or u['id'] in assoc_ids for u in ordinary),districtsWithCandidates=len(campus_regions|assoc_regions))
    data['missingSchools']=missing;data['cityOnlySchools']=city_only
    coverage=[]
    for p in data.get('provinceCities',{}):
        us=[u for u in ordinary if u['p']==p];rs=[r for r in campuses if r['p']==p];aa=[a for a in associations if a['p']==p]
        coverage.append({'province':p,'schools':len(us),'locatedSchools':sum(u['id'] in located for u in us),'missingSchools':sum(u['id'] not in located for u in us),'campuses':len(rs),'districtAssociations':len(aa),'districts':len({(r['c'],r['d']) for r in rs if r.get('d')}|{(a['c'],a['d']) for a in aa if a.get('d')}),'allDistricts':sum(n['p']==p and bool(n['d']) for n in regions.values()),'verifiedRecords':sum(bool(r.get('verified')) for r in rs)})
    data['coverage']=coverage;data.setdefault('revision',{})['version']=(ROOT/'VERSION').read_text().strip();data['revision']['date']='2026-09-09';return data
def load_data():
    data=json.loads((ROOT/'data/metadata.json').read_text(encoding='utf-8'))
    data['universities']=jsonl(ROOT/'data/universities.jsonl');data['campuses']=jsonl(ROOT/'data/campuses.jsonl')+jsonl(ROOT/'data/campus-additions.jsonl')
    data['districtAssociations']=jsonl(ROOT/'data/district-associations.jsonl');data['cityAffiliates']=json.loads((ROOT/'data/city-affiliates.json').read_text(encoding='utf-8'))
    for key in ['regions','sources']:data[key]=json.loads((ROOT/'data'/f'{key}.json').read_text(encoding='utf-8'))
    return refresh_derived(data)

def build():
    data=load_data();version=(ROOT/'VERSION').read_text().strip();json_text=lambda value:json.dumps(value,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')
    geometry=(ROOT/'data/boundaries.compact.json.gz').read_bytes();maps=json.loads(gzip.decompress(geometry));manifest={'complete':True,'maps':len(maps),'version':version,'preparedAt':'2026-09-09','source':'See data/sources.json','schoolDataComplete':'学校主体已嵌入；市级只按本地主体高校竞争，异地办学分本科/研究生两层悬浮展示。'}
    app=(ROOT/'src/app.js').read_text(encoding='utf-8');city=(ROOT/'src/city-layer.js').read_text(encoding='utf-8');marker='\nboot();'
    if app.count(marker)!=1:raise ValueError('Expected one boot marker in src/app.js')
    app=app.replace(marker,'\n'+city+marker);styles=(ROOT/'src/styles.css').read_text(encoding='utf-8')+'\n'+(ROOT/'src/city-layer.css').read_text(encoding='utf-8')
    values={'__STYLES__':styles,'__APP__':app,'__SCHOOL_DATA__':json_text(data),'__GEO_DATA__':base64.b64encode(geometry).decode(),'__MANIFEST__':json_text(manifest)};html=(ROOT/'src/index.template.html').read_text(encoding='utf-8')
    for marker,value in values.items():
        if html.count(marker)!=1:raise ValueError('Expected exactly one template marker: '+marker)
        html=html.replace(marker,value)
    return html.encode('utf-8')
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--check',action='store_true');parser.add_argument('--zip',action='store_true');args=parser.parse_args();output=ROOT/'dist/china-university-atlas.html';content=build()
    if args.check:
        if not output.exists() or output.read_bytes()!=content:raise SystemExit('FAIL: dist differs from reproducible build; run python scripts/build.py')
        print('PASS: committed HTML matches deterministic build');return
    output.parent.mkdir(exist_ok=True);output.write_bytes(content);checksum=hashlib.sha256(content).hexdigest()+'  '+output.name+'\n';(ROOT/'dist/SHA256SUMS.txt').write_text(checksum,encoding='ascii');print('BUILT',output.name,len(content),'bytes',hashlib.sha256(content).hexdigest())
    if args.zip:
        folder=ROOT/'release-assets';folder.mkdir(exist_ok=True);version=(ROOT/'VERSION').read_text().strip();target=folder/f'china-university-atlas-v{version}.zip';selected=[output,ROOT/'dist/SHA256SUMS.txt',ROOT/'README.md',ROOT/'NOTICE.md',ROOT/'VERSION'];selected += [f for p in ['data','reports','docs','src','scripts','tests'] for f in (ROOT/p).rglob('*') if f.is_file() and '__pycache__' not in f.parts and f.suffix not in ['.pyc']]
        with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
            for path in sorted(set(selected)):
                name=path.name if path.parent==ROOT/'dist' else path.relative_to(ROOT).as_posix();item=zipfile.ZipInfo(name,(2026,9,9,0,0,0));item.compress_type=zipfile.ZIP_DEFLATED;item.external_attr=0o644<<16;archive.writestr(item,path.read_bytes(),compresslevel=9)
        sums=checksum+hashlib.sha256(target.read_bytes()).hexdigest()+'  '+target.name+'\n';(folder/'SHA256SUMS.txt').write_text(sums,encoding='ascii');print('PACKED',target.name,target.stat().st_size,'bytes')
if __name__=='__main__':main()
