from pathlib import Path
p=Path('scripts/build.py')
s=p.read_text(encoding='utf-8')
start=s.index('def normalized_address(')
end=s.index('\ndef inherit_exact_address_districts',start)
new='''def normalized_address(value,province='',city='',district=''):\n    """Conservative same-city key with an optional leading legal-district prefix removed."""\n    text=str(value or '').strip()\n    if not text:\n        return ''\n    for label in (str(province or '').strip(),str(city or '').strip()):\n        if label:\n            text=text.replace(label,'')\n    text=re.sub(r'[\\s,，。；;()（）\\-—_/]+','',text)\n    special={'广西壮族自治区':'广西','内蒙古自治区':'内蒙古','新疆维吾尔自治区':'新疆','宁夏回族自治区':'宁夏','西藏自治区':'西藏'}\n    for label in (str(province or '').strip(),str(city or '').strip()):\n        alias=special.get(label,'') or (label[:-1] if len(label)>2 and label.endswith(('省','市')) else '')\n        if alias and text.startswith(alias):\n            text=text[len(alias):]\n    d=str(district or '').strip()\n    if d and text.startswith(d):\n        text=text[len(d):]\n    return text\n\ndef specific_inherited_address_key(value):\n    """Reject zone-only labels; inheritance needs a road, street/town/village cue, or number."""\n    text=str(value or '')\n    return bool(text) and (bool(re.search(r'\\d',text)) or any(x in text for x in ('路','街','道','巷','弄','号','村','镇','乡')))\n'''
s=s[:start]+new+s[end:]
s=s.replace("        if not d or not key[2]:\n            continue\n", "        if not d or not specific_inherited_address_key(key[2]):\n            continue\n",1)
s=s.replace("        if not key[2]:\n            continue\n        districts=donors.get(key,set())", "        if not specific_inherited_address_key(key[2]):\n            continue\n        districts=donors.get(key,set())",1)
p.write_text(s,encoding='utf-8')
print('patched safe inheritance')