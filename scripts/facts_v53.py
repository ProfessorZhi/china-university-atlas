"""Attach versioned institution facts and derive data-driven ranking summaries."""
from collections import defaultdict
import json,math,re

LEGACY_SOFT_EDITION='2026'

def _json(path,default):
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else default

def _jsonl(path):
    if not path.exists():return []
    return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line.strip()]

def _edition_key(value):
    s=str(value or '')
    nums=[int(x) for x in re.findall(r'\d+',s)]
    return tuple(nums) if nums else (0,)

def _rank_midpoint(r):
    if isinstance(r.get('rank'),(int,float)):return float(r['rank'])
    lo=r.get('rankLower');hi=r.get('rankUpper')
    if isinstance(lo,(int,float)) and isinstance(hi,(int,float)):return (float(lo)+float(hi))/2
    return None

def _rank_label(r):
    edition=str(r.get('edition',''));rid=r.get('rankingId','');disp=str(r.get('rankDisplay') or r.get('rank') or '')
    if rid=='shanghairanking-bcur':
        ref=r.get('referenceRank');cat=r.get('category','')
        if ref and cat and cat not in ['综合','主榜']:return f'{edition}软科{cat} {disp} · 主榜参考 {ref}'
        return f'{edition}软科 {disp}'.strip()
    if rid=='shanghairanking-bcvcr':return f'{edition}软科高职 {disp}'.strip()
    if rid=='qs-wur':return f'QS {edition} {disp}'.strip()
    if rid=='the-wur':return f'THE {edition} {disp}'.strip()
    if rid=='arwu':return f'ARWU {edition} {disp}'.strip()
    return f"{r.get('agency','')} {edition} {disp}".strip()

def _latest(rows):
    return max(rows,key=lambda r:(_edition_key(r.get('edition')),str(r.get('publishedAt','')),str(r.get('retrievedAt','')))) if rows else None

def attach_facts(data,root):
    sources=_json(root/'data/ranking-sources.json',{'sources':[]});policy=_json(root/'data/ranking-policy.json',{})
    ranking_rows=_jsonl(root/'data/rankings.jsonl');admission_rows=_jsonl(root/'data/admissions.jsonl');finance_rows=_jsonl(root/'data/finance.jsonl')
    by_id={u['id']:u for u in data['universities']};by_name=defaultdict(list)
    for u in data['universities']:by_name[u['u']].append(u)
    unresolved=[]
    def resolve(row,kind):
        uid=row.get('uid')
        if uid in by_id:return uid
        name=row.get('universityName') or row.get('u')
        matches=by_name.get(name,[])
        if len(matches)==1:return matches[0]['id']
        unresolved.append({'kind':kind,'id':row.get('id'),'uid':uid,'universityName':name,'matches':len(matches)})
        return None
    normalized_rankings=[]
    for raw in ranking_rows:
        row=dict(raw);uid=resolve(row,'ranking')
        if not uid:continue
        row['uid']=uid;row['rankMidpoint']=_rank_midpoint(row);row['referenceRankOrRank']=row.get('referenceRank') if isinstance(row.get('referenceRank'),(int,float)) else row.get('rankMidpoint');row['displayLabel']=_rank_label(row);normalized_rankings.append(row)
    normalized_admissions=[]
    for raw in admission_rows:
        row=dict(raw);uid=resolve(row,'admission')
        if uid:row['uid']=uid;normalized_admissions.append(row)
    normalized_finance=[]
    for raw in finance_rows:
        row=dict(raw);uid=resolve(row,'finance')
        if uid:row['uid']=uid;normalized_finance.append(row)
    ranks_by_uid=defaultdict(list);adm_by_uid=defaultdict(list);fin_by_uid=defaultdict(list)
    for r in normalized_rankings:ranks_by_uid[r['uid']].append(r)
    for r in normalized_admissions:adm_by_uid[r['uid']].append(r)
    for r in normalized_finance:fin_by_uid[r['uid']].append(r)
    level_order={v:i for i,v in enumerate(policy.get('mapWinner',{}).get('levelOrder',['本科','专科','成人']))}
    prestige_order=policy.get('mapWinner',{}).get('prestigeTagOrder',['985','211','双一流'])
    for u in data['universities']:
        grouped=defaultdict(list)
        for r in ranks_by_uid.get(u['id'],[]):grouped[r['rankingId']].append(r)
        latest={rid:_latest(rows) for rid,rows in grouped.items()}
        u['latestRankings']=latest
        soft=latest.get('shanghairanking-bcur');voc=latest.get('shanghairanking-bcvcr')
        preferred=voc if u.get('level')=='专科' and voc else soft
        if preferred:
            sort_value=preferred.get('referenceRankOrRank')
            u['preferredRank']={'rankingId':preferred['rankingId'],'edition':preferred.get('edition'),'sortValue':sort_value,'label':preferred.get('displayLabel'),'sourceUrl':preferred.get('sourceUrl')}
        elif u.get('rankLabel'):
            label=str(u.get('rankLabel',''));kind='主榜' if label.isdigit() else '分类标签'
            u['preferredRank']={'rankingId':'legacy-shanghairanking-bcur','edition':LEGACY_SOFT_EDITION,'sortValue':float(u['rank']) if isinstance(u.get('rank'),(int,float)) else 999999,'label':f'{LEGACY_SOFT_EDITION}软科{kind} {label}','sourceUrl':'https://www.shanghairanking.cn/rankings/bcur/2026','legacy':True}
        else:u['preferredRank']=None
        tags=set(u.get('tags') or []);prestige=len(prestige_order)
        for i,t in enumerate(prestige_order):
            if t in tags:prestige=i;break
        rv=u.get('preferredRank',{}).get('sortValue') if u.get('preferredRank') else None
        rv=float(rv) if isinstance(rv,(int,float)) and math.isfinite(float(rv)) else 999999.0
        u['mapPriority']=[level_order.get(u.get('level'),len(level_order)),prestige,rv,1 if u.get('private') else 0]
        ars=adm_by_uid.get(u['id'],[]);frs=fin_by_uid.get(u['id'],[])
        u['admissionFactCount']=len(ars);u['latestAdmissionYear']=max([r.get('year',0) for r in ars] or [None])
        u['financeFactCount']=len(frs);u['latestFinanceYear']=max([r.get('fiscalYear',0) for r in frs] or [None])
    data['rankingFacts']=normalized_rankings;data['admissionFacts']=normalized_admissions;data['financeFacts']=normalized_finance;data['rankingSources']=sources.get('sources',[]);data['rankingPolicy']=policy;data['factResolutionIssues']=unresolved
    data.setdefault('stats',{}).update(rankingFactRecords=len(normalized_rankings),rankingFactSchools=len(ranks_by_uid),admissionFactRecords=len(normalized_admissions),admissionFactSchools=len(adm_by_uid),financeFactRecords=len(normalized_finance),financeFactSchools=len(fin_by_uid),factResolutionIssues=len(unresolved))
    return data
