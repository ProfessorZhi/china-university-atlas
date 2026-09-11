from pathlib import Path
import json
p=Path('data/zone-district-mappings.jsonl')
rows=[json.loads(x) for x in p.read_text(encoding='utf-8').splitlines() if x.strip()]
for r in rows:
    if r.get('id')=='ZONE-JX-YINGTAN-XINJIANG':
        r['sourceUrl']='https://www.hukou.gov.cn/nyncj/fdzdgknr/ssjd/202204/P020220418663809680358.pdf'
        r['evidence']='江西省政府系统公开的全省资金分配表按法定县区统计时明确写“月湖区”备注“含鹰潭高新区、信江新区”，可用于将信江新区功能区地址回落到法定月湖区。'
p.write_text('\n'.join(json.dumps(r,ensure_ascii=False,separators=(',',':')) for r in rows)+'\n',encoding='utf-8')
print('updated',sum(r.get('id')=='ZONE-JX-YINGTAN-XINJIANG' for r in rows))