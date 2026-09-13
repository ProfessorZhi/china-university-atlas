"""Fetch normalized 2026 ShanghaiRanking facts from the publisher's public API.

This is a manual ingestion tool, never called by the offline build.  It exact-matches
current registry names only; renamed/unmatched institutions are reported and never guessed.
"""
from __future__ import annotations
import argparse,json,re,urllib.parse,urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
YEAR=2026
RETRIEVED='2026-09-13'
API='https://www.shanghairanking.cn/api/pub/v1/{kind}'
UA='Mozilla/5.0 (compatible; ChinaUniversityAtlas/5.6; +https://github.com/ProfessorZhi/china-university-atlas)'
SPECS=[
    ('bcur',10,'本科','shanghairanking-bcur','软科中国大学排名','https://www.shanghairanking.cn/rankings/bcur/202610'),
    ('bcur',14,'本科','shanghairanking-bcur','软科中国大学排名','https://www.shanghairanking.cn/rankings/bcur/202614'),
    ('bcvcr',623,'专科','shanghairanking-bcvcr','软科中国高职院校排名','https://www.shanghairanking.cn/rankings/bcvcr/2026623'),
]

def jsonl(path):
    if not path.exists(): return []
    return [json.loads(x) for x in path.read_text(encoding='utf-8').splitlines() if x.strip()]

def fetch(kind,type_id,source_url):
    q=urllib.parse.urlencode({'year':YEAR,f'{kind}_type':type_id})
    req=urllib.request.Request(API.format(kind=kind)+'?'+q,headers={'User-Agent':UA,'Referer':source_url})
    with urllib.request.urlopen(req,timeout=60) as r:
        obj=json.loads(r.read().decode('utf-8'))
    if obj.get('code')!=200: raise RuntimeError(obj)
    return obj.get('data',{}).get('rankings',[])

def trailing_int(value):
    m=re.search(r'(\d+)$',str(value or ''))
    return int(m.group(1)) if m else None

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--output',default='data/rankings-shanghairanking-2026.jsonl')
    args=ap.parse_args()
    universities=jsonl(ROOT/'data/universities.jsonl')
    by_name={}
    for u in universities: by_name.setdefault(u.get('u'),[]).append(u)
    existing=jsonl(ROOT/'data/rankings.jsonl')
    existing_keys={(r.get('uid'),r.get('rankingId'),str(r.get('edition'))) for r in existing if r.get('uid')}
    out=[];unmatched=[];skipped_band=[];seen=set()
    for kind,type_id,level,rid,rname,source_url in SPECS:
        for x in fetch(kind,type_id,source_url):
            name=x.get('univNameCn');matches=by_name.get(name,[])
            if len(matches)!=1 or matches[0].get('level')!=level:
                if str(x.get('rankOverall') or '').isdigit(): unmatched.append({'name':name,'level':level,'ranking':x.get('ranking'),'reference':x.get('rankOverall'),'source':source_url})
                continue
            u=matches[0];key=(u['id'],rid,str(YEAR))
            if key in existing_keys or key in seen: continue
            display=str(x.get('ranking') or '').strip();ref=str(x.get('rankOverall') or '').strip()
            rank=trailing_int(display)
            if not ref.isdigit() or rank is None:
                skipped_band.append({'uid':u['id'],'name':name,'ranking':display,'reference':ref,'source':source_url})
                continue
            refnum=int(ref);is_main=display.isdigit() and int(display)==refnum
            row={
                'id':f"RANK_SR_{'BCUR' if rid=='shanghairanking-bcur' else 'BCVCR'}_{YEAR}_{u['id']}",
                'uid':u['id'],'universityName':u['u'],'rankingId':rid,'agency':'ShanghaiRanking',
                'rankingName':rname,'edition':str(YEAR),'rank':rank,'rankDisplay':display,
                'referenceRank':refnum,'scope':'China-mainland','category':'主榜' if rid=='shanghairanking-bcur' and is_main else (x.get('univCategory') or ''),
                'sourceUrl':source_url,'sourceKind':'official','retrievedAt':RETRIEVED,'verified':True,
                'notes':'软科官方公开 API；rankDisplay 保留榜单显示名次，referenceRank 使用官方 rankOverall/主榜参考位次；分类榜名次不冒充全国主榜名次。'
            }
            if isinstance(x.get('score'),(int,float)): row['score']=x['score']
            out.append(row);seen.add(key)
    out.sort(key=lambda r:(r['rankingId'],r['referenceRank'],r['universityName']))
    target=ROOT/args.output;target.write_text('\n'.join(json.dumps(r,ensure_ascii=False,separators=(',',':')) for r in out)+'\n',encoding='utf-8')
    summary={'output':target.relative_to(ROOT).as_posix(),'facts':len(out),'unmatchedNumericReference':unmatched,'skippedNonNumericReference':len(skipped_band),'skippedExamples':skipped_band[:20]}
    print(json.dumps(summary,ensure_ascii=False,indent=2))

if __name__=='__main__': main()
