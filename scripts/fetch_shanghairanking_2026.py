"""Fetch normalized 2026 ShanghaiRanking facts from the publisher's public API.

This is a manual ingestion tool, never called by the offline build. The list inventory,
the scale field of each list family and the incomparability rules live in
``data/ranking-comparability.json``; this script only turns the publisher's rows into
versioned facts and refuses to guess identity.

Identity is exact-matched on the registry name. Pre-rename ranking names may map only
through the audited Ministry alias file. Mergers, internal colleges and fuzzy name
matches are never guessed, and a row whose registry level disagrees with the list's
level is reported as unmatched instead of being written.

A row with no numeric value in the list family's scale field is stored as a band fact
(``rankBand``) so downstream code can keep it out of precise comparisons instead of
turning "500+" into a position it never had.
"""
from __future__ import annotations
import argparse,json,re,urllib.parse,urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
YEAR=2026
RETRIEVED='2026-09-13'
API='https://www.shanghairanking.cn/api/pub/v1/{kind}'
PAGE='https://www.shanghairanking.cn/rankings/{kind}/2026{type_id}'
UA='Mozilla/5.0 (compatible; ChinaUniversityAtlas/5.6; +https://github.com/ProfessorZhi/china-university-atlas)'


def jsonl(path):
    if not path.exists(): return []
    return [json.loads(x) for x in path.read_text(encoding='utf-8').splitlines() if x.strip()]


def jsonfile(path,default):
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else default


def api_kind(group_name):
    """The group name is ``shanghairanking-<api>-<...>``; the api segment is the endpoint."""
    parts=group_name.split('-')
    return parts[1]


def list_source_url(kind,type_id,list_key):
    if kind=='bcur' and list_key=='bcur-main':
        return 'https://www.shanghairanking.cn/rankings/bcur/2026'
    return PAGE.format(kind=kind,type_id=type_id)


def load_inventory():
    doc=jsonfile(ROOT/'data/ranking-comparability.json',None)
    if not doc: raise SystemExit('data/ranking-comparability.json is required')
    lists=[]
    for group in doc.get('groups',[]):
        kind=api_kind(group['group'])
        for entry in group.get('lists',[]):
            lists.append({'group':group,'kind':kind,'listKey':entry['listKey'],'listTypeId':entry['listTypeId'],
                          'listName':entry.get('listName',''),'sourceUrl':list_source_url(kind,entry['listTypeId'],entry['listKey'])})
    return doc,lists


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


def is_number(value):
    return str(value or '').strip().isdigit()


def scale_value(row,fields,has_overall):
    """The comparable value of one row inside its list family.

    When a list carries ``rankOverall`` for any row, that field *is* the family
    scale and ``ranking`` is only the in-category position (verified on 14/21/22/
    745/623, where the two disagree).  Such a row with a non-numeric
    ``rankOverall`` is band-only and must not fall back to its category number.

    A list with no ``rankOverall`` at all (民办主榜 15、民办高职 633、职业本科
    749/750) publishes only ``ranking``, and that number is the family scale.

    ``scaleField`` names the column the family scale lives in, so it is returned
    even when this particular row is banded (``500+`` / ``100+``): the scale still
    exists, this school just sits inside its open interval.  Only ``value`` is None
    in that case.
    """
    if has_overall:
        raw=row.get('rankOverall')
        return (int(str(raw).strip()),'rankOverall') if is_number(raw) else (None,'rankOverall')
    for field in fields:
        raw=row.get(field)
        if is_number(raw): return int(str(raw).strip()),field
    return None,(fields[0] if fields else None)


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--output',default='data/rankings-shanghairanking-2026.jsonl')
    args=ap.parse_args()
    _policy,lists=load_inventory()
    universities=jsonl(ROOT/'data/universities.jsonl')
    by_name={};by_id={u['id']:u for u in universities}
    for u in universities: by_name.setdefault(u.get('u'),[]).append(u)
    alias_doc=jsonfile(ROOT/'data/ranking-name-aliases-2026.json',{'aliases':[]})
    aliases={a['rankingName']:a for a in alias_doc.get('aliases',[])}
    out=[];unmatched=[];level_mismatch=[];alias_used=[];band_rows=[];listing_rows=[];seen=set()
    for spec in lists:
        group=spec['group'];fields=group.get('scale',[]);listing_only=bool(group.get('listingOnly'))
        list_rows=fetch(spec['kind'],spec['listTypeId'],spec['sourceUrl'])
        has_overall=any(is_number(x.get('rankOverall')) for x in list_rows)
        for x in list_rows:
            ranking_name=x.get('univNameCn');matches=by_name.get(ranking_name,[]);alias=None
            if len(matches)!=1: matches=[]
            if not matches:
                alias=aliases.get(ranking_name)
                u=by_id.get(alias.get('uid')) if alias else None
                if u and u.get('u')==alias.get('currentName'): matches=[u]
                else: alias=None
            if len(matches)!=1:
                unmatched.append({'name':ranking_name,'group':group['group'],'listKey':spec['listKey'],
                                  'ranking':x.get('ranking'),'rankOverall':x.get('rankOverall'),'source':spec['sourceUrl']})
                continue
            u=matches[0]
            if u.get('level')!=group.get('level'):
                level_mismatch.append({'name':ranking_name,'uid':u['id'],'registryLevel':u.get('level'),
                                       'listLevel':group.get('level'),'listKey':spec['listKey']})
                continue
            key=(u['id'],group['group'],str(YEAR))
            if key in seen: continue
            seen.add(key)
            display=str(x.get('ranking') or '').strip();overall=str(x.get('rankOverall') or '').strip()
            value,value_field=scale_value(x,fields,has_overall)
            band=value is None and not listing_only
            row={
                'id':f"RANK_SR_{YEAR}_{group['group'].replace('shanghairanking-','').replace('-','_').upper()}_{u['id']}",
                'uid':u['id'],'universityName':u['u'],'rankingId':group['group'],'agency':'ShanghaiRanking',
                'rankingName':spec['listName'] or group.get('label',''),
                'edition':str(YEAR),'listKey':spec['listKey'],'listTypeId':spec['listTypeId'],
                'comparisonGroup':group['group'],'scaleField':value_field or '',
                'rank':trailing_int(display),'rankDisplay':display,
                'referenceRank':int(overall) if is_number(overall) else None,'referenceRankDisplay':overall,
                'comparableRank':value,'rankBand':band,'rankBandLabel':group.get('bandLabel','') if band else '',
                'listingOnly':listing_only,
                'scope':'China-mainland','category':(x.get('univCategory') or ''),
                'rankingListClass':('listing' if listing_only else ('main' if spec['listKey'].endswith('-main') else 'category')),
                'sourceUrl':spec['sourceUrl'],'sourceKind':'official','retrievedAt':RETRIEVED,'verified':True,
                'notes':'软科官方公开 API。榜单清单与标尺见 data/ranking-comparability.json；不同 comparisonGroup 的名次不互相比较。'
            }
            if isinstance(x.get('score'),(int,float)): row['score']=x['score']
            # ``univTags`` in BCVCR is 双高/示范性高职院校/骨干高职院校 - a vocational tier label,
            # not the 985/211/双一流 prestige list, so it is kept apart from prestige matching.
            if isinstance(x.get('univTags'),list) and x['univTags']: row['rankingTags']=x['univTags']
            # ``isVocational`` is *not* copied: measured over all 13 BCVCR lists it is constantly
            # true for the 专科 lists and false for the 职业本科 lists, so it means "is 高职专科
            # level", not "is a vocational school", and reading it literally would mislead.
            if alias:
                row['nameAliasSourceUrl']=alias.get('sourceUrl');row['nameAliasEvidence']=alias.get('evidence')
                row['rankingSourceName']=ranking_name
                alias_used.append({'rankingName':ranking_name,'currentName':u['u'],'uid':u['id'],'sourceUrl':alias.get('sourceUrl')})
            if band: band_rows.append({'uid':u['id'],'name':u['u'],'listKey':spec['listKey'],'ranking':display,'band':row['rankBandLabel']})
            if listing_only: listing_rows.append({'uid':u['id'],'name':u['u'],'listKey':spec['listKey']})
            out.append(row)
    out.sort(key=lambda r:(r['comparisonGroup'],r['comparableRank'] if r['comparableRank'] is not None else 10**9,r['universityName']))
    target=ROOT/args.output
    target.write_text('\n'.join(json.dumps(r,ensure_ascii=False,separators=(',',':')) for r in out)+'\n',encoding='utf-8')
    summary={'output':target.relative_to(ROOT).as_posix(),'facts':len(out),
             'byGroup':{g:sum(1 for r in out if r['comparisonGroup']==g) for g in sorted({r['comparisonGroup'] for r in out})},
             'bandFacts':len(band_rows),'listingFacts':len(listing_rows),
             'aliasesUsed':alias_used,'unmatched':unmatched,'levelMismatch':level_mismatch,
             'skippedBandExamples':band_rows[:10]}
    print(json.dumps(summary,ensure_ascii=False,indent=2))


if __name__=='__main__': main()
