from pathlib import Path
import json
p=Path('data/zone-district-mappings.jsonl')
rows=[json.loads(x) for x in p.read_text(encoding='utf-8').splitlines() if x.strip()]
for r in rows:
    if r.get('id')=='ZONE-AH-HEFEI-ETDZ':
        r['sourceUrl']='https://www.sixian.gov.cn/zwgk/qmtjjczwgkbzhgfhzt/zcwj/152810961.html'
        r['evidence']='安徽省征地区片综合地价政策公开表在蜀山区范围中明确列出合肥经济技术开发区的芙蓉、海恒、锦绣、莲花、临湖社区及高刘街道；因此经开区现有高校地址可回落到法定蜀山区。'
p.write_text('\n'.join(json.dumps(r,ensure_ascii=False,separators=(',',':')) for r in rows)+'\n',encoding='utf-8')
print('updated',sum(r.get('id')=='ZONE-AH-HEFEI-ETDZ' for r in rows))