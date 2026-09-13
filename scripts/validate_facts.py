"""Validate normalized rankings, admissions, finance facts and ranking policy."""
import json,re,sys
from urllib.parse import urlparse
from build import ROOT,load_data

# A rename may only be carried over with a Ministry of Education / provincial government /
# education department / school-official announcement behind it, and only when the school
# identifier survives the rename. A merger into a new legal entity and an internal college of a
# university are both excluded by name in ``explicitlyNotMapped``: the old ranking belongs to the
# old entity, not to whatever absorbed it.
DOC_NUMBER=re.compile(r'〔(\d{4})〕\s*\d+\s*号')
def validate_aliases(universities):
    path=ROOT/'data/ranking-name-aliases-2026.json'
    if not path.exists():return ['missing data/ranking-name-aliases-2026.json']
    doc=json.loads(path.read_text(encoding='utf-8'));errors=[]
    by_id={u['id']:u for u in universities}
    aliases=doc.get('aliases',[]);blocked=doc.get('explicitlyNotMapped',[])
    if not (aliases or blocked):errors.append('alias registry is empty')
    seen={}
    for a in aliases:
        name=a.get('rankingName','')
        for field in ('rankingName','currentName','uid','sourceUrl','evidence'):
            if not a.get(field):errors.append(f'alias {name!r} missing {field}')
        if name in seen:errors.append(f'duplicate alias for ranking name {name!r}')
        seen[name]=a
        u=by_id.get(a.get('uid'))
        if not u:errors.append(f'alias {name!r} points at unknown uid {a.get("uid")}')
        elif u['u']!=a.get('currentName'):errors.append(f'alias {name!r} says currentName {a.get("currentName")!r} but uid {a.get("uid")} is {u["u"]!r}')
        host=urlparse(a.get('sourceUrl','')).hostname or ''
        if not (host=='www.moe.gov.cn' or host.endswith('.gov.cn') or host.endswith('.edu.cn')):
            errors.append(f'alias {name!r} cites a non-official source host {host!r}')
        m=DOC_NUMBER.search(a.get('evidence',''))
        year=re.search(r'/t(\d{4})',a.get('sourceUrl',''))
        if not m:errors.append(f'alias {name!r} evidence carries no document number (文号)')
        elif year and m.group(1)!=year.group(1):errors.append(f'alias {name!r} document year {m.group(1)} disagrees with its source URL {year.group(1)}')
    for b in blocked:
        name=b.get('rankingName','')
        if not name or not b.get('reason'):errors.append('explicitlyNotMapped entry without name/reason')
        if name in seen:errors.append(f'{name!r} is both aliased and explicitly not mapped')
        host=urlparse(b.get('sourceUrl','')).hostname or ''
        if not (host=='www.moe.gov.cn' or host.endswith('.gov.cn') or host.endswith('.edu.cn')):
            errors.append(f'excluded {name!r} cites a non-official source host {host!r}')
    return errors

def validate():
    d=load_data();errors=[];check=lambda ok,msg:errors.append(msg) if not ok else None
    universities=d.get('universities',[]);uids={u['id'] for u in universities};source_ids={s.get('rankingId') for s in d.get('rankingSources',[])}
    rankings=d.get('rankingFacts',[]);admissions=d.get('admissionFacts',[]);finance=d.get('financeFacts',[])
    check(len(universities)==3196,'expected 3196 mainland registry entities')
    check(not d.get('factResolutionIssues'),'unresolved fact-to-university matches: '+json.dumps(d.get('factResolutionIssues',[]),ensure_ascii=False))
    for kind,rows in [('ranking',rankings),('admission',admissions),('finance',finance)]:
        ids=[r.get('id') for r in rows];check(all(ids),f'{kind} fact missing id');check(len(ids)==len(set(ids)),f'duplicate {kind} fact ids')
        for r in rows:check(r.get('uid') in uids,f'orphan {kind} fact '+str(r.get('id')))
    for r in rankings:
        rid=r.get('rankingId');check(rid in source_ids,'unknown rankingId '+str(rid));check(bool(r.get('agency') and r.get('rankingName') and r.get('edition')),'incomplete ranking '+str(r.get('id')))
        check(str(r.get('sourceUrl','')).startswith(('https://','http://')),'invalid ranking source '+str(r.get('id')))
        exact=isinstance(r.get('rank'),(int,float));band=isinstance(r.get('rankLower'),(int,float)) and isinstance(r.get('rankUpper'),(int,float))
        open_band=bool(r.get('rankBand')) and bool(r.get('rankBandLabel'));listing=bool(r.get('listingOnly'))
        check(exact or band or open_band or listing,'ranking has neither exact rank nor rank band '+str(r.get('id')))
        if exact:check(r['rank']>0,'non-positive rank '+str(r.get('id')))
        if band:check(0<r['rankLower']<=r['rankUpper'],'invalid rank band '+str(r.get('id')))
        if r.get('referenceRank') is not None:check(isinstance(r.get('referenceRank'),(int,float)) and r['referenceRank']>0,'invalid reference rank '+str(r.get('id')))
        # ``comparableRank`` is the only value the map may compare, and only against a fact on
        # the same comparison group. An open band ("500+") and a listing-only row must never
        # carry one, or a band would silently turn back into a position.
        check(bool(r.get('comparisonGroup')),'ranking fact without comparison group '+str(r.get('id')))
        comparable=r.get('comparableRank')
        if listing:check(comparable is None,'listing-only row must carry no comparable rank '+str(r.get('id')))
        elif comparable is not None:
            check(isinstance(comparable,int) and comparable>0,'invalid comparable rank '+str(r.get('id')))
            check(not r.get('rankBand'),'band fact must not also carry a comparable rank '+str(r.get('id')))
        else:check(bool(r.get('rankBand')),'non-comparable ranking must be marked as a band '+str(r.get('id')))
    # A school must not appear twice on the same list and edition. The hand-built rows in
    # data/rankings.jsonl were superseded by the official snapshot and removed for exactly this
    # reason: two live facts for one school on one list would make _latest() choose by accident.
    seen_fact={}
    for r in rankings:
        key=(r.get('uid'),r.get('comparisonGroup'),r.get('listTypeId'),str(r.get('edition')))
        if key in seen_fact:errors.append(f'duplicate ranking fact for {key}: {seen_fact[key]} and {r.get("id")}')
        seen_fact[key]=r.get('id')
    for r in admissions:
        check(isinstance(r.get('year'),int) and 2000<=r['year']<=2100,'invalid admission year '+str(r.get('id')));check(bool(r.get('sourceProvince')),'missing admission source province '+str(r.get('id')));check(str(r.get('sourceUrl','')).startswith(('https://','http://')),'invalid admission source '+str(r.get('id')))
    for r in finance:
        check(isinstance(r.get('fiscalYear'),int) and 2000<=r['fiscalYear']<=2100,'invalid finance year '+str(r.get('id')));check(bool(r.get('statementType')),'missing finance statement type '+str(r.get('id')));check(str(r.get('sourceUrl','')).startswith(('https://','http://')),'invalid finance source '+str(r.get('id')))
    for u in universities:
        check(isinstance(u.get('mapPriority'),list) and len(u['mapPriority'])>=4,'missing derived map priority '+u['id'])
        if u.get('preferredRank'):
            check(bool(u['preferredRank'].get('label')),'preferred rank missing label '+u['id'])
            check(bool(u['preferredRank'].get('comparisonGroup')),'preferred rank missing comparison group '+u['id'])
            # legacy entries are a display order and a backfill hint; they must not claim a scale.
            # An official preferred rank must declare the column its scale lives in and then be
            # exactly one of two things: a number inside that scale, or an open band with a label.
            # A band is a real answer ("the school is on the list, inside 500+"), so it is kept -
            # but it carries no value, and a banded entry may never also look numeric.
            if not u['preferredRank'].get('legacy'):
                pr=u['preferredRank']
                check(bool(pr.get('scaleField')),'preferred rank missing scale field '+u['id'])
                banded=bool(pr.get('band'))
                check(banded or pr.get('sortValue') is not None,'preferred rank carries neither a value nor a band '+u['id'])
                check(not banded or pr.get('sortValue') is None,'banded preferred rank carries a value '+u['id'])
                check(not banded or bool(pr.get('bandLabel')),'banded preferred rank missing its open-interval label '+u['id'])
    p=d.get('rankingPolicy',{});check(bool(p.get('policyVersion')),'ranking policy has no version');check(p.get('atlasComposite',{}).get('enabledForMapWinner') is False,'experimental composite must not silently drive map winner')
    errors.extend(validate_aliases(universities))
    result={'pass':not errors,'errors':errors,'schoolEntities':len(universities),'rankingFacts':len(rankings),'rankingFactSchools':d.get('stats',{}).get('rankingFactSchools'),'admissionFacts':len(admissions),'financeFacts':len(finance),'rankingSourceSeries':len(source_ids),'rankingPolicyVersion':p.get('policyVersion'),'renameAliases':len(json.loads((ROOT/'data/ranking-name-aliases-2026.json').read_text(encoding='utf-8')).get('aliases',[]))}
    print(json.dumps(result,ensure_ascii=False,indent=2));return result
if __name__=='__main__':sys.exit(0 if validate()['pass'] else 1)
