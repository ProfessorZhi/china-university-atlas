"""Attach versioned institution facts and derive data-driven ranking summaries."""
from collections import defaultdict
import json,math,re

LEGACY_RANKING_ID='legacy-shanghairanking-bcur'
LEGACY_SOFT_EDITION='2026'

# Which comparison group a school's map ranking comes from. A school only ever appears in
# one of these in practice; the order only resolves a defensive tie.
RANKING_GROUP_ORDER=[
    'shanghairanking-bcur',
    'shanghairanking-bcur-private',
    'shanghairanking-bcvcr-public-vocational',
    'shanghairanking-bcvcr-private-vocational',
    'shanghairanking-bcvcr-public-vocational-undergraduate',
    'shanghairanking-bcvcr-private-vocational-undergraduate',
    'shanghairanking-bcur-art-list',
    'qs-wur','the-wur','the-asia','arwu',
]

# A world-ranking series is comparable inside itself and against nothing else. Each of these
# carries its own scale, so a row only has to declare the series it came from to be usable;
# it is never compared with 软科 or with another agency's numbers.
SELF_COMPARABLE_SERIES={'qs-wur','the-wur','the-asia','arwu'}

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
    if rid.startswith('shanghairanking-bcur'):
        ref=r.get('referenceRank');cat=r.get('category','');family=str(r.get('referenceRankDisplay') or '')
        if r.get('listingOnly'):return f'{edition}软科艺术类高校名单（无名次）'
        if rid=='shanghairanking-bcur-private':return f'{edition}软科民办 {disp}'.strip()
        # ``category`` on a 主榜 row is the school's subject (理工/综合/...), not a sub-list, so it
        # must not be printed as one: "软科理工 271 · 主榜参考 271" reads as a 理工 list position
        # while it is the 主榜 position twice over. Only the category-split lists carry a real
        # per-category position. The banded branch below has always had this guard.
        if ref and cat and cat not in ['综合','主榜'] and r.get('listKey')!='bcur-main':return f'{edition}软科{cat} {disp} · 主榜参考 {ref}'
        # A banded category row has no ``referenceRank`` number, but it is still on the 主榜 scale:
        # ``disp`` is the category token ("56+") and the 主榜参考 column carries the open interval
        # the school really sits on ("500+"). Printing only the category token would read as a
        # 主榜 position and drop the family scale entirely.
        if r.get('rankBand') and cat not in ['','综合','主榜'] and family and r.get('listKey')!='bcur-main':
            return f'{edition}软科{cat} {disp} · 主榜参考 {family}'
        return f'{edition}软科 {disp}'.strip()
    if rid.startswith('shanghairanking-bcvcr'):
        ref=r.get('referenceRank');cat=r.get('category','');family=str(r.get('referenceRankDisplay') or r.get('rankBandLabel') or '')
        if r.get('listingOnly'):return f'{edition}软科高职名单（无名次）'
        if rid=='shanghairanking-bcvcr-public-vocational':
            if ref:return f'{edition}软科高职专科总榜 {ref}'
            # 623 publishes ``ranking`` as the *category* position and ``rankOverall`` as the 总榜
            # position, so a banded row's 总榜 token is the reference column, never ``disp``.
            if r.get('rankBand') and cat:return f'{edition}软科高职{cat} {disp} · 高职专科总榜 {family}'
            return f'{edition}软科高职专科总榜 {disp}'
        if rid=='shanghairanking-bcvcr-private-vocational':return f'{edition}软科民办高职专科 {disp}'.strip()
        if rid=='shanghairanking-bcvcr-public-vocational-undergraduate':return f'{edition}软科职业本科大学 {disp}'.strip()
        if rid=='shanghairanking-bcvcr-private-vocational-undergraduate':return f'{edition}软科民办职业本科大学 {disp}'.strip()
        return (f'{edition}软科高职{cat} {disp} · 全国参考 {ref}' if ref else f'{edition}软科高职{cat} {disp}').strip()
    if rid=='qs-wur':return f'QS {edition} {disp}'.strip()
    if rid=='the-wur':return f'THE {edition} {disp}'.strip()
    if rid=='the-asia':return f'THE亚洲 {edition} {disp}'.strip()
    if rid=='arwu':return f'ARWU {edition} {disp}'.strip()
    if rid==LEGACY_RANKING_ID:return f'{edition}软科 {disp} · 旧总榜快照'.strip()
    return f"{r.get('agency','')} {edition} {disp}".strip()

def _latest(rows):
    return max(rows,key=lambda r:(_edition_key(r.get('edition')),str(r.get('publishedAt','')),str(r.get('retrievedAt','')))) if rows else None

def _group_order(rid):
    try:return RANKING_GROUP_ORDER.index(rid)
    except ValueError:return len(RANKING_GROUP_ORDER)

def _preferred(grouped):
    """Pick the fact that carries the most comparable information, not merely any fact.

    A listing-only row (艺术类名单, 无名次) is display-only and can never be the preferred fact.
    An official row in the open 500+ / 100+ band is *not* dropped: the school is on the list and
    its scale exists, it merely has no exact position, so it is carried as a band (``sortValue``
    None, ``band`` True) that winner-core refuses to order against a number. Dropping it instead
    would push a school with official 2026 data back onto the pre-ingestion snapshot.
    """
    candidates=[_latest(rows) for rows in grouped.values()]
    candidates=[r for r in candidates if r]
    if not candidates:return None
    def key(r):
        numeric=0 if (not r.get('listingOnly') and r.get('comparableRank') is not None) else 1
        band=0 if (not r.get('listingOnly') and r.get('rankBand')) else 1
        return (numeric,band,_group_order(r.get('rankingId','')))
    best=min(candidates,key=key)
    if best.get('listingOnly'):return None
    if best.get('comparableRank') is None and not best.get('rankBand'):return None
    group=best.get('comparisonGroup') or best.get('rankingId')
    return {
        'rankingId':group,'comparisonGroup':group,'edition':best.get('edition'),
        'listKey':best.get('listKey',''),'listTypeId':best.get('listTypeId'),
        'listName':best.get('rankingName',''),'category':best.get('category',''),
        'scaleField':best.get('scaleField',''),
        'sortValue':best.get('comparableRank'),'band':bool(best.get('rankBand')),
        'bandLabel':best.get('rankBandLabel',''),'label':best.get('displayLabel'),
        # the publisher's own two tokens: the in-list position and the family-scale reference
        'rankDisplay':best.get('rankDisplay',''),'referenceRank':best.get('referenceRank'),
        'referenceRankDisplay':best.get('referenceRankDisplay',''),
        'retrievedAt':best.get('retrievedAt',''),'sourceUrl':best.get('sourceUrl'),'legacy':False
    }

def _legacy_ranking(u):
    """The pre-ingestion snapshot, kept only when no official list covers the school.

    ``universities.rank`` is the 0-based position of the old mixed 总榜 page and is never a
    published rank, so it is not used at all.  ``rankLabel`` is reused only when it is a plain
    number; labels like ``500+`` / ``医12+`` are open intervals or category tokens and become a
    band, not a value.
    """
    label=str(u.get('rankLabel') or '').strip()
    if not label:return None
    common={'rankingId':LEGACY_RANKING_ID,'comparisonGroup':LEGACY_RANKING_ID,'edition':LEGACY_SOFT_EDITION,
            'listKey':'legacy-total-snapshot','listTypeId':10,'listName':'中国大学排名（总榜）· 迁移前快照',
            'category':'','scaleField':'','rankDisplay':label,'referenceRank':None,'referenceRankDisplay':'',
            'retrievedAt':'','sourceUrl':'https://www.shanghairanking.cn/rankings/bcur/202610','legacy':True}
    if label.isdigit():
        # Only a plain number is reused, and only as a display order: the pre-ingestion
        # ``universities.rank`` was the 0-based index of the old mixed 总榜 page, not a rank.
        return {**common,'sortValue':int(label),'band':False,'bandLabel':'',
                'label':f'{LEGACY_SOFT_EDITION}软科 {label} · 旧总榜快照'}
    return {**common,'sortValue':None,'band':True,'bandLabel':label,
            'label':f'{LEGACY_SOFT_EDITION}软科 {label} · 旧总榜快照'}

def attach_facts(data,root):
    sources=_json(root/'data/ranking-sources.json',{'sources':[]});policy=_json(root/'data/ranking-policy.json',{})
    ranking_rows=[]
    for path in sorted((root/'data').glob('rankings*.jsonl')):ranking_rows.extend(_jsonl(path))
    admission_rows=_jsonl(root/'data/admissions.jsonl');finance_rows=_jsonl(root/'data/finance.jsonl')
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
        row['uid']=uid;row['rankMidpoint']=_rank_midpoint(row)
        if row.get('comparisonGroup') is None and row.get('rankingId') in SELF_COMPARABLE_SERIES:
            row['comparisonGroup']=row['rankingId']
            if row.get('comparableRank') is None and isinstance(row.get('rank'),(int,float)):
                row['comparableRank']=int(row['rank']);row.setdefault('scaleField','rank')
        row['referenceRankOrRank']=row.get('comparableRank') if isinstance(row.get('comparableRank'),(int,float)) else (row.get('referenceRank') if isinstance(row.get('referenceRank'),(int,float)) else row.get('rankMidpoint'))
        row['displayLabel']=_rank_label(row);normalized_rankings.append(row)
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
        preferred=_preferred(grouped)
        if not preferred:preferred=_legacy_ranking(u)
        u['preferredRank']=preferred
        tags=set(u.get('tags') or []);prestige=len(prestige_order)
        for i,t in enumerate(prestige_order):
            if t in tags:prestige=i;break
        # ``mapPriority`` is the deterministic *display* order of a candidate list (the page, the
        # report and the audit all read it); it is never a quality judgement. Its third element is
        # a tier, so the order matches the rule the winner itself is decided by: an official exact
        # position first, then an open band, then a school still on the pre-ingestion 总榜 snapshot.
        # The legacy entry's number is deliberately *not* used here - it is the 0-based index of the
        # old mixed 总榜 page, so letting it order schools would put it ahead of official evidence.
        exact=bool(preferred) and not preferred.get('legacy') and isinstance(preferred.get('sortValue'),(int,float)) and math.isfinite(float(preferred['sortValue']))
        banded=bool(preferred) and not preferred.get('legacy') and not exact
        rv=float(preferred['sortValue']) if exact else 999999.0
        tier=0 if exact else (1 if banded else 2)
        u['mapPriority']=[level_order.get(u.get('level'),len(level_order)),prestige,tier,rv,1 if u.get('private') else 0]
        ars=adm_by_uid.get(u['id'],[]);frs=fin_by_uid.get(u['id'],[])
        u['admissionFactCount']=len(ars);u['latestAdmissionYear']=max([r.get('year',0) for r in ars] or [None])
        u['financeFactCount']=len(frs);u['latestFinanceYear']=max([r.get('fiscalYear',0) for r in frs] or [None])
    data['rankingFacts']=normalized_rankings;data['admissionFacts']=normalized_admissions;data['financeFacts']=normalized_finance;data['rankingSources']=sources.get('sources',[]);data['rankingPolicy']=policy;data['factResolutionIssues']=unresolved
    data.setdefault('stats',{}).update(rankingFactRecords=len(normalized_rankings),rankingFactSchools=len(ranks_by_uid),admissionFactRecords=len(normalized_admissions),admissionFactSchools=len(adm_by_uid),financeFactRecords=len(normalized_finance),financeFactSchools=len(fin_by_uid),factResolutionIssues=len(unresolved))
    return data
