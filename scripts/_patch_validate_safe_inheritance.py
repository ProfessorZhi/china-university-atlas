from pathlib import Path
p=Path('scripts/validate.py')
s=p.read_text(encoding='utf-8')
s=s.replace('from build import ROOT,load_data,build,normalized_address','from build import ROOT,load_data,build,normalized_address,specific_inherited_address_key')
needle="            check(r.get('districtSourceKind')=='address-inherited','wrong inherited district source kind '+r['id'])\n"
repl=needle+"            check(specific_inherited_address_key(normalized_address(r.get('address'),r.get('p'),r.get('c'),'')),'non-specific inherited address key '+r['id'])\n"
if needle not in s: raise SystemExit('needle not found')
s=s.replace(needle,repl,1)
p.write_text(s,encoding='utf-8')
print('patched validator inheritance specificity')