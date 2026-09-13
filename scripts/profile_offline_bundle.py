"""Deterministic size profile and regression budget for the standalone offline HTML bundle."""
from pathlib import Path
import base64,gzip,json
from build import ROOT,load_data

OUT=ROOT/'reports/offline-bundle-profile.json'
MAX_HTML_BYTES=5_000_000

def b(value):
    return len(value.encode('utf-8') if isinstance(value,str) else value)

def compact_json(value):
    return json.dumps(value,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')

def main():
    data=load_data();geometry=(ROOT/'data/boundaries.compact.json.gz').read_bytes()
    app_parts=['app.js','winner-core.js','city-layer.js','status-layer.js','facts-layer.js','v57-ui.js']
    css_parts=['styles.css','city-layer.css']
    school=compact_json(data);school_gzip=gzip.compress(school.encode('utf-8'),compresslevel=9,mtime=0);school_embedded=base64.b64encode(school_gzip)
    profile={
      'version':(ROOT/'VERSION').read_text().strip(),
      'maxHtmlBytes':MAX_HTML_BYTES,
      'schoolDataBytes':b(school),
      'schoolDataGzipBytes':len(school_gzip),
      'schoolDataEmbeddedBytes':len(school_embedded),
      'geoGzipBytes':len(geometry),
      'geoBase64Bytes':b(base64.b64encode(geometry)),
      'javascriptBytes':sum((ROOT/'src'/n).stat().st_size for n in app_parts),
      'cssBytes':sum((ROOT/'src'/n).stat().st_size for n in css_parts),
      'templateBytes':(ROOT/'src/index.template.html').stat().st_size,
      'schoolEntities':len(data.get('universities',[])),
      'campusRecords':len(data.get('campuses',[])),
      'rankingFacts':len(data.get('rankingFacts',[])),
    }
    html=ROOT/'dist/china-university-atlas.html'
    if html.exists(): profile['htmlBytes']=html.stat().st_size
    profile['knownPayloadBytes']=profile['schoolDataEmbeddedBytes']+profile['geoBase64Bytes']+profile['javascriptBytes']+profile['cssBytes']
    if profile.get('htmlBytes'):
        profile['otherHtmlBytes']=profile['htmlBytes']-profile['knownPayloadBytes']
        profile['withinBudget']=profile['htmlBytes']<=MAX_HTML_BYTES
    OUT.write_text(json.dumps(profile,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(profile,ensure_ascii=False,indent=2))
    if profile.get('htmlBytes',0)>MAX_HTML_BYTES:
        raise SystemExit(f"FAIL: standalone HTML {profile['htmlBytes']} bytes exceeds {MAX_HTML_BYTES}-byte V5.7 budget")

if __name__=='__main__': main()
