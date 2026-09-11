import sys,re,collections
sys.path.insert(0,'scripts')
from build import load_data,normalized_address
D=load_data()
rows=[r for r in D['campuses'] if r.get('districtInferenceMethod')=='exact-same-city-address-inheritance']
generic_exact={'大学城','开发区','经济开发区','经济技术开发区','高新区','高新技术产业开发区','工业园','工业园区','产业园','产业园区','职教园区','科教园区','新区'}
generic_suffix=('大学城','开发区','经济开发区','经济技术开发区','高新区','高新技术产业开发区','工业园','工业园区','产业园','产业园区','职教园区','科教园区','新区')
print('inherited',len(rows))
exact=[]; suffix=[]; no_locator=[]
for r in rows:
    k=normalized_address(r.get('address'),r.get('p'),r.get('c'),'')
    item=(r['id'],r.get('p'),r.get('c'),r.get('d'),k,r.get('address'),r.get('districtInheritedFrom'))
    if k in generic_exact: exact.append(item)
    if any(k.endswith(x) for x in generic_suffix) and not re.search(r'\d',k): suffix.append(item)
    if not re.search(r'\d',k) and not any(x in k for x in ('路','街','道','巷','弄','号','村','镇','乡','街道')): no_locator.append(item)
print('generic_exact',len(exact)); [print('EXACT',x) for x in exact]
print('generic_suffix_no_number',len(suffix)); [print('SUFFIX',x) for x in suffix[:30]]
print('no_locator',len(no_locator)); [print('NOLOC',x) for x in no_locator[:50]]