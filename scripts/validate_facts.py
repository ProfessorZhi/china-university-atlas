"""Validate normalized rankings, admissions, finance facts and ranking policy."""
import json,sys
from build import ROOT,load_data

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
        check(exact or band,'ranking has neither exact rank nor rank band '+str(r.get('id')))
        if exact:check(r['rank']>0,'non-positive rank '+str(r.get('id')))
        if band:check(0<r['rankLower']<=r['rankUpper'],'invalid rank band '+str(r.get('id')))
        if r.get('referenceRank') is not None:check(isinstance(r.get('referenceRank'),(int,float)) and r['referenceRank']>0,'invalid reference rank '+str(r.get('id')))
    for r in admissions:
        check(isinstance(r.get('year'),int) and 2000<=r['year']<=2100,'invalid admission year '+str(r.get('id')));check(bool(r.get('sourceProvince')),'missing admission source province '+str(r.get('id')));check(str(r.get('sourceUrl','')).startswith(('https://','http://')),'invalid admission source '+str(r.get('id')))
    for r in finance:
        check(isinstance(r.get('fiscalYear'),int) and 2000<=r['fiscalYear']<=2100,'invalid finance year '+str(r.get('id')));check(bool(r.get('statementType')),'missing finance statement type '+str(r.get('id')));check(str(r.get('sourceUrl','')).startswith(('https://','http://')),'invalid finance source '+str(r.get('id')))
    for u in universities:
        check(isinstance(u.get('mapPriority'),list) and len(u['mapPriority'])>=4,'missing derived map priority '+u['id'])
        if u.get('preferredRank'):check(bool(u['preferredRank'].get('label')),'preferred rank missing label '+u['id'])
    p=d.get('rankingPolicy',{});check(bool(p.get('policyVersion')),'ranking policy has no version');check(p.get('atlasComposite',{}).get('enabledForMapWinner') is False,'experimental composite must not silently drive map winner')
    result={'pass':not errors,'errors':errors,'schoolEntities':len(universities),'rankingFacts':len(rankings),'rankingFactSchools':d.get('stats',{}).get('rankingFactSchools'),'admissionFacts':len(admissions),'financeFacts':len(finance),'rankingSourceSeries':len(source_ids),'rankingPolicyVersion':p.get('policyVersion')}
    print(json.dumps(result,ensure_ascii=False,indent=2));return result
if __name__=='__main__':sys.exit(0 if validate()['pass'] else 1)
