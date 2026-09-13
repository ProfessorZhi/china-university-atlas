"""One-shot V5.7 build patch: inject UX layer and normalize gzip header."""
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def replace(path,old,new):
    p=ROOT/path;text=p.read_text(encoding='utf-8')
    if old not in text: raise SystemExit(f'missing expected fragment in {path}: {old[:100]!r}')
    p.write_text(text.replace(old,new,1),encoding='utf-8')
    print('patched',path)

def main():
    p=ROOT/'scripts/build.py';text=p.read_text(encoding='utf-8')
    helper="""\ndef deterministic_gzip(payload):\n    raw=bytearray(gzip.compress(payload,compresslevel=9,mtime=0))\n    # Python 3.11/3.12 may expose zlib's platform OS byte when mtime=0.\n    # RFC 1952 permits 255 (unknown); normalizing it makes Windows/Linux builds byte-identical.\n    if len(raw)>9: raw[9]=255\n    return bytes(raw)\n"""
    marker='\ndef build():\n'
    if 'def deterministic_gzip(' not in text:
        if marker not in text: raise SystemExit('build() marker missing')
        text=text.replace(marker,helper+marker,1)
    old="facts_layer=(ROOT/'src/facts-layer.js').read_text(encoding='utf-8');marker='\\nboot();'"
    new="facts_layer=(ROOT/'src/facts-layer.js').read_text(encoding='utf-8');v57_ui=(ROOT/'src/v57-ui.js').read_text(encoding='utf-8');marker='\\nboot();'"
    if old not in text: raise SystemExit('facts layer injection point missing')
    text=text.replace(old,new,1)
    old="app=app.replace(marker,'\\n'+winner_core+'\\n'+city+'\\n'+status_layer+'\\n'+facts_layer+marker);"
    new="app=app.replace(marker,'\\n'+winner_core+'\\n'+city+'\\n'+status_layer+'\\n'+facts_layer+'\\n'+v57_ui+marker);"
    if old not in text: raise SystemExit('app layer assembly point missing')
    text=text.replace(old,new,1)
    old="base64.b64encode(gzip.compress(json_text(data).encode('utf-8'),compresslevel=9,mtime=0)).decode()"
    new="base64.b64encode(deterministic_gzip(json_text(data).encode('utf-8'))).decode()"
    if old not in text: raise SystemExit('schoolData gzip call missing')
    text=text.replace(old,new,1)
    p.write_text(text,encoding='utf-8');print('patched scripts/build.py')

if __name__=='__main__': main()
