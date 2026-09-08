import json, pathlib, tempfile, urllib.request, urllib.parse, concurrent.futures, re, time
P=pathlib.Path(tempfile.gettempdir())/'china_university_offline_v4'; (P/'maps').mkdir(exist_ok=True)
def get(url,path):
    if path.exists() and path.stat().st_size>50: return path.read_bytes()
    req=urllib.request.Request(urllib.parse.quote(url,safe=':/?=&%+'),headers={'User-Agent':'Mozilla/5.0'})
    for attempt in range(3):
        try:
            b=urllib.request.urlopen(req,timeout=25).read(); path.write_bytes(b); return b
        except Exception:
            if attempt==2: raise
            time.sleep(.5)
def geo(code):
    try: return code,json.loads(get('https://geo.datav.aliyun.com/areas_v3/bound/'+str(code)+'_full.json',P/'maps'/f'{code}.json'))
    except Exception as e: print('MAP_FAIL',code,str(e),flush=True); return code,None
n=json.loads((P/'national.json').read_bytes());(P/'maps'/'100000.json').write_text(json.dumps(n,ensure_ascii=False),encoding='utf-8')
pids=[f['properties']['adcode'] for f in n['features'] if f['properties'].get('name') and str(f['properties']['adcode'])!='710000']
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex: provinces=dict(ex.map(geo,pids))
cids=[f['properties']['adcode'] for g in provinces.values() if g for f in g['features'] if f['properties'].get('level')=='city' and f['properties'].get('childrenNum',0)>0]
with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex: cities=dict(ex.map(geo,cids))
print('MAPS',len(provinces),len(cities),len(list((P/'maps').glob('*.json'))),flush=True)
urls={'rank.csv':'https://raw.githubusercontent.com/theo-the-menace/China-World-University-Index/main/data/china/shanghairanking/软科全部高校.csv','poi.json':'https://raw.githubusercontent.com/pg7go/The-Location-Data-of-Schools-in-China/master/大学-8084.json','poi_readme.md':'https://raw.githubusercontent.com/pg7go/The-Location-Data-of-Schools-in-China/master/README.md','index_readme.md':'https://raw.githubusercontent.com/theo-the-menace/China-World-University-Index/main/data/README.md','moe_page.html':'https://www.moe.gov.cn/jyb_xxgk/s5743/s5744/A03/202606/t20260618_1441074.html'}
for name,url in urls.items():
    try: print('DATA',name,len(get(url,P/name)),flush=True)
    except Exception as e: print('DATA_FAIL',name,str(e),flush=True)
if (P/'moe_page.html').exists():
    text=(P/'moe_page.html').read_bytes().decode('utf-8','replace')
    links=re.findall(r'href=[\"\']([^\"\']+\.(?:xls|xlsx))[\"\']',text,re.I);print('MOE_LINKS',links,flush=True)
    for i,l in enumerate(links):
        try: print('MOE_FILE',i,len(get(urllib.parse.urljoin(urls['moe_page.html'],l),P/('moe_'+str(i)+'.'+l.rsplit('.',1)[1]))),flush=True)
        except Exception as e: print('MOE_FAIL',str(e),flush=True)
print('DONE',flush=True)
