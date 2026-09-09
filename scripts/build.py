"""Deterministic offline HTML build. Python 3.10+; no network or dependencies."""
from pathlib import Path
import argparse,base64,gzip,hashlib,json,sys,zipfile
from derived_v53 import refresh_derived as refresh_derived_v53
from facts_v53 import attach_facts
ROOT=Path(__file__).resolve().parents[1]
def jsonl(path):
    if not path.exists():return []
    return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line.strip()]
def load_data():
    data=json.loads((ROOT/'data/metadata.json').read_text(encoding='utf-8'));universities=jsonl(ROOT/'data/universities.jsonl')
    status_path=ROOT/'data/entity-status-overrides.json';status=json.loads(status_path.read_text(encoding='utf-8')) if status_path.exists() else {}
    host_path=ROOT/'data/entity-location-overrides.json';host=json.loads(host_path.read_text(encoding='utf-8')) if host_path.exists() else {}
    for u in universities:
        h=host.get(u['id'])
        if h:
            u['originalHost']={'p':u.get('p',''),'c':u.get('c',''),'d':u.get('d','')};u['p']=h.get('p',u.get('p',''));u['c']=h.get('c',u.get('c',''));u['d']=h.get('d',u.get('d',''));u['hostBoundaryStatus']=h.get('boundaryStatus');u['hostOverrideSourceUrl']=h.get('sourceUrl');u['hostOverrideEvidence']=h.get('evidence');u['hostOverrideNote']=h.get('note')
        s=status.get(u['id'])
        if s:u.update(entityStatus=s.get('status'),rankingEligible=s.get('rankingEligible',True),statusEffectiveFrom=s.get('effectiveFrom'),statusLabel=s.get('label'),statusSourceUrl=s.get('sourceUrl'),statusEvidence=s.get('evidence'))
        else:u.setdefault('rankingEligible',True)
    additions=[]
    for path in sorted((ROOT/'data').glob('campus-additions*.jsonl')):additions.extend(jsonl(path))
    association_additions=[]
    for path in sorted((ROOT/'data').glob('district-association-additions*.jsonl')):association_additions.extend(jsonl(path))
    associations=jsonl(ROOT/'data/district-associations.jsonl')+association_additions;ao_path=ROOT/'data/district-association-overrides.json';ao=json.loads(ao_path.read_text(encoding='utf-8')) if ao_path.exists() else {}
    for record in associations:
        override=ao.get(record['id'])
        if override:record.update(override)
    data['universities']=universities;data['campuses']=jsonl(ROOT/'data/campuses.jsonl')+additions;data['districtAssociations']=associations;data['districtAssociationOverrides']=ao;data['cityAffiliates']=json.loads((ROOT/'data/city-affiliates.json').read_text(encoding='utf-8'));data['entityLocationOverrides']=host
    for key in ['regions','sources']:data[key]=json.loads((ROOT/'data'/f'{key}.json').read_text(encoding='utf-8'))
    data=refresh_derived_v53(data,(ROOT/'VERSION').read_text().strip())
    return attach_facts(data,ROOT)

def build():
    data=load_data();version=(ROOT/'VERSION').read_text().strip();json_text=lambda value:json.dumps(value,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c');geometry=(ROOT/'data/boundaries.compact.json.gz').read_bytes();maps=json.loads(gzip.decompress(geometry));manifest={'complete':True,'maps':len(maps),'version':version,'preparedAt':'2026-09-09','source':'See data/sources.json','schoolDataComplete':'学校主体已嵌入；无地点、县区证据、精确校区和已停招/并转状态分层统计；排名、录取与财务采用版本化事实层；市级只按本地主体高校竞争；新设行政单元在边界升级前明确标记。'}
    app=(ROOT/'src/app.js').read_text(encoding='utf-8');city=(ROOT/'src/city-layer.js').read_text(encoding='utf-8');status_layer=(ROOT/'src/status-layer.js').read_text(encoding='utf-8');facts_layer=(ROOT/'src/facts-layer.js').read_text(encoding='utf-8');marker='\nboot();'
    if app.count(marker)!=1:raise ValueError('Expected one boot marker in src/app.js')
    app=app.replace(marker,'\n'+city+'\n'+status_layer+'\n'+facts_layer+marker);styles=(ROOT/'src/styles.css').read_text(encoding='utf-8')+'\n'+(ROOT/'src/city-layer.css').read_text(encoding='utf-8');values={'__STYLES__':styles,'__APP__':app,'__SCHOOL_DATA__':json_text(data),'__GEO_DATA__':base64.b64encode(geometry).decode(),'__MANIFEST__':json_text(manifest)};html=(ROOT/'src/index.template.html').read_text(encoding='utf-8')
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
