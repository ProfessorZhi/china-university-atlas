"""Validate the committed data, sources, offline contract and publication hygiene."""
from pathlib import Path
import gzip,json,re,hashlib,sys
from build import ROOT,load_data,build

def validate():
    d=load_data();u=d['universities'];c=d['campuses'];st=d['stats'];errors=[]
    check=lambda ok,msg:errors.append(msg) if not ok else None
    ids={r['id'] for r in u};check(len(ids)==len(u),'duplicate university ids');check(len({r['id'] for r in c})==len(c),'duplicate campus ids')
    regions={(n['p'],n['c'],n['d']) for n in d['regions'].values()};positioned=0
    for r in c:
        check(r['uid'] in ids,'orphan campus '+r['id']);check(r.get('sourceKind') in ['official','profile','historical'],'missing provenance '+r['id'])
        check(str(r.get('sourceUrl','')).startswith(('https://','http://')),'invalid source URL '+r['id'])
        if r.get('d'):check((r['p'],r['c'],r['d']) in regions,'unmapped county '+r['id'])
        if 'lng' in r or 'lat' in r:
            positioned+=1;check(isinstance(r.get('lng'),(int,float)) and isinstance(r.get('lat'),(int,float)) and 72<r['lng']<136 and 3<r['lat']<55,'invalid coordinates '+r['id'])
    check(st['schoolEntities']==len(u),'wrong entity count');check(st['campusRecords']==len(c),'wrong campus count');check(st['positionedCampuses']==positioned,'wrong point count')
    check(st['officialLocationRecords']==sum(bool(r.get('verified')) for r in c),'wrong official count')
    check(st['ordinarySchools']==sum(r['level']!='成人' for r in u),'wrong ordinary school count')
    check(st['ordinarySchoolsWithoutLocations']==len(d['missingSchools']),'wrong missing school count')
    geometry=json.loads(gzip.decompress((ROOT/'data/boundaries.compact.json.gz').read_bytes()));check(len(geometry)==st['boundaryFiles'],'wrong boundary file count')
    html=build().decode();check("connect-src 'none'" in html,'network not disabled by CSP');check(not re.search(r'<(?:script|link)\b[^>]*(?:src|href)\s*=\s*[\"\']https?://',html,re.I),'external runtime dependency')
    forbidden=re.compile(r'gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|[A-Za-z]:[\\\\/]+Users[\\\\/]+[^\\\\/\s]+|/home/(?:hwz|vince)(?:/|\b)',re.I)
    scanned=0
    for f in ROOT.rglob('*'):
        if not f.is_file() or any(x in f.parts for x in ['.git','__pycache__','release-assets','.work']):continue
        check(not any(x.startswith('test_profile') for x in f.parts),'browser profile tracked');check(f.suffix!='.url','local-device shortcut tracked')
        if f.suffix in ['.gz','.png','.zip']:continue
        text=f.read_text(encoding='utf-8-sig',errors='replace');scanned+=1
        if f.name!='validate.py':check(not forbidden.search(text),'private path or credential pattern in '+str(f.relative_to(ROOT)))
    result={'pass':not errors,'errors':errors,'universities':len(u),'campuses':len(c),'boundaryFiles':len(geometry),'scannedTextFiles':scanned,'noNetworkBuild':True}
    print(json.dumps(result,ensure_ascii=False,indent=2));return result
if __name__=='__main__':sys.exit(0 if validate()['pass'] else 1)
