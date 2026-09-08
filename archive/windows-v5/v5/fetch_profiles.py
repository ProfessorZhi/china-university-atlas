from pathlib import Path
import json,urllib.request,concurrent.futures,time,unicodedata,hashlib
P=Path(__file__).parent; O=P/'profiles'; O.mkdir(exist_ok=True)
D=json.loads((P/'school_data.json').read_text(encoding='utf-8'))
norm=lambda s:unicodedata.normalize('NFKC',str(s)).replace(' ','')
U={norm(u['u']):u for u in D['universities'] if u['level']!='成人'}
N=json.loads((P/'eol_names.json').read_bytes())['data']; jobs=[]; seen=set()
for r in N:
    if norm(r['name']) in U and r['school_id'] not in seen:
        jobs.append((r['school_id'],U[norm(r['name'])]['id'])); seen.add(r['school_id'])
(P/'profile_matching.json').write_text(json.dumps(jobs,ensure_ascii=False),encoding='utf-8')
def get(job):
    sid,uid=job; f=O/(sid+'.json')
    if f.exists():return sid,True,'cached'
    url='https://static-data.gaokao.cn/www/2.0/school/'+sid+'/info.json'
    for attempt in range(2):
        try:
            time.sleep(.12)
            req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})
            with urllib.request.urlopen(req,timeout=15) as res:b=res.read()
            o=json.loads(b)
            if o.get('code')!='0000' or not o.get('data',{}).get('name'):raise ValueError('invalid response')
            f.write_bytes(b);return sid,True,len(b)
        except Exception as e:
            if attempt: return sid,False,str(e)
            time.sleep(1.5)
print('PROFILE_JOBS',len(jobs),'REGISTRY',len(U),flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex: result=list(ex.map(get,jobs))
(P/'profile_fetch_audit.json').write_text(json.dumps({'retrieved':'2026-09-08','jobs':len(jobs),'success':sum(r[1] for r in result),'failures':[r for r in result if not r[1]],'matching':'Exact NFKC school name; no inferred mergers'},ensure_ascii=False,indent=2),encoding='utf-8')
print('PROFILE_DONE',len(result),'OK',sum(r[1] for r in result),'FAIL',[r for r in result if not r[1]][:15],flush=True)
