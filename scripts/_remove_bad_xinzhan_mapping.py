from pathlib import Path
import json
p=Path('data/zone-district-mappings.jsonl')
rows=[json.loads(x) for x in p.read_text(encoding='utf-8').splitlines() if x.strip()]
before=len(rows)
rows=[r for r in rows if r.get('id')!='ZONE-AH-HEFEI-XINZHAN-YAOHAI']
p.write_text('\n'.join(json.dumps(r,ensure_ascii=False,separators=(',',':')) for r in rows)+'\n',encoding='utf-8')
print('removed',before-len(rows))