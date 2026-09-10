"""Reject ambiguous campus override merges before derived data is generated."""
from pathlib import Path
import json,sys

ROOT=Path(__file__).resolve().parents[1]

def strict_object(items):
    obj={}
    for key,value in items:
        if key in obj:
            raise ValueError('duplicate JSON key: '+key)
        obj[key]=value
    return obj

def validate():
    paths=[ROOT/'data/campus-overrides.json']+sorted((ROOT/'data').glob('campus-overrides-*.json'))
    errors=[];owners={};keys=0;files=0
    for path in paths:
        if not path.exists():continue
        files+=1
        try:
            data=json.loads(path.read_text(encoding='utf-8'),object_pairs_hook=strict_object)
        except Exception as exc:
            errors.append(f'{path.relative_to(ROOT)}: {exc}')
            continue
        if not isinstance(data,dict):
            errors.append(f'{path.relative_to(ROOT)}: top level must be an object')
            continue
        for key in data:
            keys+=1
            prior=owners.get(key)
            if prior:
                errors.append(f'duplicate campus override key {key}: {prior} and {path.relative_to(ROOT)}')
            else:
                owners[key]=path.relative_to(ROOT)
    result={'pass':not errors,'files':files,'keys':keys,'errors':errors}
    print(json.dumps(result,ensure_ascii=False,indent=2))
    return result

if __name__=='__main__':sys.exit(0 if validate()['pass'] else 1)
