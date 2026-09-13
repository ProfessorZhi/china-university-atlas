"""One-shot source migration for V5.7 compressed standalone payload.

Executed by the existing manual write-capable workflow on v57-frontend-offline.
It edits sources only; normal CI remains read-only/offline.
"""
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[1]

def replace(path,old,new):
    p=ROOT/path;text=p.read_text(encoding='utf-8')
    if old not in text: raise SystemExit(f'missing expected source fragment in {path}: {old[:80]!r}')
    p.write_text(text.replace(old,new,1),encoding='utf-8')
    print('patched',path)

def main():
    replace('scripts/build.py',
      "'__SCHOOL_DATA__':json_text(data)",
      "'__SCHOOL_DATA__':base64.b64encode(gzip.compress(json_text(data).encode('utf-8'),compresslevel=9,mtime=0)).decode()")
    replace('src/index.template.html',
      '<script id="schoolData" type="application/json">__SCHOOL_DATA__</script>',
      '<script id="schoolData" type="application/json" data-encoding="gzip">__SCHOOL_DATA__</script>')
    replace('src/app.js',
      "const D=JSON.parse(document.getElementById('schoolData').textContent), manifest=JSON.parse(document.getElementById('manifest').textContent);",
      "let D=null;const manifest=JSON.parse(document.getElementById('manifest').textContent);")
    replace('src/app.js',
      "const $=id=>document.getElementById(id),NS='http://www.w3.org/2000/svg',palette=",
      "const $=id=>document.getElementById(id);async function readEmbeddedJson(id){const el=$(id),raw=el.textContent.trim();if(el.dataset.encoding!=='gzip')return JSON.parse(raw);if(typeof DecompressionStream==='undefined')throw Error('当前浏览器不支持离线压缩数据解码，请使用最新版 Chrome / Edge / Firefox / Safari');const bytes=Uint8Array.from(atob(raw),c=>c.charCodeAt(0));const text=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();return JSON.parse(text);}const NS='http://www.w3.org/2000/svg',palette=")
    old="async function boot(){try{const b=Uint8Array.from(atob($('geoData').textContent.trim()),c=>c.charCodeAt(0));CACHE=JSON.parse(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).text());buildIndexes();"
    new="async function boot(){try{D=await readEmbeddedJson('schoolData');CACHE=await readEmbeddedJson('geoData');buildIndexes();"
    replace('src/app.js',old,new)

    p=ROOT/'scripts/generate_best_university_coverage.mjs';text=p.read_text(encoding='utf-8')
    if "import zlib from 'node:zlib';" not in text:
        text=text.replace("import path from 'node:path';", "import path from 'node:path';\nimport zlib from 'node:zlib';",1)
    pattern=re.compile(r"function readSchoolData\(\) \{.*?\n\}\n",re.S)
    repl="""function readSchoolData() {\n  const html = fs.readFileSync(DIST, 'utf8');\n  const m = html.match(/<script([^>]*\\bid=[\"']schoolData[\"'][^>]*)>([\\s\\S]*?)<\\/script>/i);\n  if (!m) throw new Error('schoolData payload not found in dist/china-university-atlas.html');\n  const attrs = m[1], raw = m[2].trim();\n  if (/data-encoding=[\"']gzip[\"']/i.test(attrs)) return JSON.parse(zlib.gunzipSync(Buffer.from(raw, 'base64')).toString('utf8'));\n  return JSON.parse(raw);\n}\n"""
    text2,n=pattern.subn(lambda _m: repl,text,count=1)
    if n!=1: raise SystemExit('could not replace readSchoolData()')
    p.write_text(text2,encoding='utf-8');print('patched',p.relative_to(ROOT))

    p=ROOT/'scripts/profile_offline_bundle.py';text=p.read_text(encoding='utf-8')
    old="school=compact_json(data)\n    profile={"
    new="school=compact_json(data);school_gzip=gzip.compress(school.encode('utf-8'),compresslevel=9,mtime=0);school_embedded=base64.b64encode(school_gzip)\n    profile={"
    if old not in text: raise SystemExit('profile source fragment missing')
    text=text.replace(old,new,1)
    text=text.replace("'schoolDataGzipBytes':len(gzip.compress(school.encode('utf-8'),compresslevel=9)),", "'schoolDataGzipBytes':len(school_gzip),\n      'schoolDataEmbeddedBytes':len(school_embedded),",1)
    text=text.replace("profile['schoolDataBytes']+profile['geoBase64Bytes']", "profile['schoolDataEmbeddedBytes']+profile['geoBase64Bytes']",1)
    p.write_text(text,encoding='utf-8');print('patched',p.relative_to(ROOT))

if __name__=='__main__': main()
