"""Government-backed functional-zone -> legal district inference."""
import json


def load_zone_mappings(root):
    path=root/'data/zone-district-mappings.jsonl'
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line.strip()]


def matching_zone_mappings(record,mappings):
    """Return same-province/city mappings whose explicit alias occurs in the source address."""
    address=str(record.get('address') or '')
    if not address:
        return []
    p,c=record.get('p',''),record.get('c','')
    return [m for m in mappings
            if (m.get('p',''),m.get('c',''))==(p,c)
            and any(str(term) in address for term in m.get('matchTerms',[]) if str(term))]


def infer_zone_districts(campuses,mappings):
    """Fill d only when exactly one government mapping matches the source address."""
    inferred=0
    for record in campuses:
        if record.get('d'):
            continue
        hits=matching_zone_mappings(record,mappings)
        if len(hits)!=1:
            continue
        mapping=hits[0]
        record['d']=mapping['d']
        record['districtInferenceMethod']='government-zone-to-legal-district'
        record['districtInferenceEvidence']=mapping.get('evidence','')
        record['districtSourceKind']='zone-government'
        record['districtSourceUrl']=mapping.get('sourceUrl')
        record['districtVerified']=True
        record['districtZoneMappingId']=mapping['id']
        inferred+=1
    return inferred
