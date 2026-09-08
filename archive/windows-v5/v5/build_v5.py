from pathlib import Path
import json,gzip,base64,hashlib,shutil
P=Path(__file__).parent;BASE=P.with_name('china_university_offline_v4');OUT=P.parent/'outputs_v5';OUT.mkdir(exist_ok=True)
D=json.loads((P/'school_data_v5.json').read_text(encoding='utf-8'));st=D['stats'];template=(P/'ui_template.html').read_text(encoding='utf-8')
replacements={
'全国高校地图 · 完全离线 · 数据增强':'全国高校地图 · V5校区补充 · 完全离线',
'真实行政区轮廓 · 省 → 市 → 县区 · 最佳大学参考名单':'V5 校区补充 · 真实轮廓 · 省 → 市 → 县区 · 完全离线',
'普通高校主体已补入；历史POI位置均标待复核。未匹配不等于当地无高校。':'来源分为官网校区依据、本轮第三方档案与历史POI。未匹配不等于当地无高校；记录数不等同独立校园数。',
'点击行政区查看下一级；大学名单沿用上一版参考数据。':'点击行政区查看下一级；学校排名与校区来源分别标注。',
'位置资料大部分来自历史POI，不是2026全部校区的官方核验名单。':'位置资料已补入本轮第三方院校地址档案；不是全国现用校区的完整官方核验名单。',
'已用教育部学校主体名录过滤身份，并剔除中小学、培训、医院等非校区对象；旧名、更名、搬迁及具体招生层次仍可能存在遗漏。成人高校默认关闭。':'已按学校当前名称与既有名录匹配；学校官网核对记录单独标注。规划、研究生教学单位及区县不明确的地址列入待核清单，不造坐标，不将旧名自动合并。各年招生层次、迁址与办学状态仍须核验。成人高校默认关闭。'
}
for old,new in replacements.items():
    if old not in template:print('REPLACEMENT_NOT_PRESENT',old[:25])
    template=template.replace(old,new)
template=template.replace('</style>','.quality.profile{background:#eaf1ff;color:#38668a}.datafacts b{font-size:22px}#coverageDialog{max-width:790px}</style>')
assert template.count('\nboot();')==1
template=template.replace('\nboot();','\n'+(P/'v5_ui.js').read_text(encoding='utf-8')+'\nboot();')
J=lambda o:json.dumps(o,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')
geo=(BASE/'geo_compact.json').read_bytes(); encoded=base64.b64encode(gzip.compress(geo,compresslevel=9)).decode()
manifest={'complete':True,'maps':363,'version':'5.0','preparedAt':'2026-09-08','source':'DataV boundary snapshot; MOE entity list mirror; Education Online profiles; historical POI; university campus sources','schoolDataComplete':'主体现有名录完整嵌入，现用校区和招生层次尚未全国完整核验'}
html=template.replace('__SCHOOL_DATA__',J(D)).replace('__GEO_DATA__',encoded).replace('__MANIFEST__',J(manifest))
f=OUT/'全国高校地图_v5_离线校区补充版.html';f.write_text(html,encoding='utf-8')
for name in ['official_additions.json','profile_fetch_audit.json']:
    shutil.copy2(P/name,OUT/name)
(OUT/'来源说明.txt').write_text('\n\n'.join(s['name']+'\n'+s['url']+'\n'+s['note'] for s in D['sources']),encoding='utf-8')
(OUT/'校区记录更正与隔离.json').write_text(json.dumps({'merged':D.get('supersededRecords',[]),'quarantined':D.get('quarantinedRecords',[])},ensure_ascii=False,indent=2),encoding='utf-8')
readme=f'''全国高校地图 V5 校区补充版\n\n双击 全国高校地图_v5_离线校区补充版.html 即可打开。所有运行资源已经内嵌；可直接断网打开，不需要服务器、账户、密钥或首次下载。\n\n本轮结果\n普通高校主体：{st['ordinarySchools']}所（未重复计算其校区）\n有至少一条办学地点关联的普通高校：{st['ordinarySchoolsWithLocations']}所\n仍无具体地址关联的普通高校：{st['ordinarySchoolsWithoutLocations']}所\n只有市级地点关联、尚未对应县区轮廓的普通高校：{st['ordinarySchoolsOnlyCityLocation']}所\n校区/办学地点记录：{st['campusRecords']}条，不等同于独立校园数量\n有地点记录的县区：{st['districtsWithCampuses']}个\n官网校区关联记录：{st['officialLocationRecords']}条，不代表精确坐标或每年招生情况已核验\n本轮第三方地址档案记录：{st['profileLocationRecords']}条\n历史地点记录：{st['historicalLocationRecords']}条\n\n数据范围\n本科优先，专科补位；学校去重、校园保留。同一大学可以跨县区/跨市出现。\n点击“覆盖统计”可以导出缺口；“仅看官网核对”开关只筛选有官网依据的校区记录。\n第三方档案按学校现名精确匹配，不使用旧名模糊并校。无地址、规划校区、研究生院和区县不确定项进入待核清单。\n学校整体排名和本科分类不能推定每个校区当年的招生层次、招生分数或教学质量。\n港澳台学校名录和台湾市县边界本轮没有系统补全。少数特殊城市没有本源县区细分轮廓；不绘制假框替代地图。\n\n同目录附学校名录、校区地点、缺失学校、城市级地点、待人工核对地址、原始地址字段快照、来源与断网测试报告。\n原V4文件未覆盖。\n'''
(OUT/'开始使用与版本说明.txt').write_text(readme,encoding='utf-8')
sha=hashlib.sha256(f.read_bytes()).hexdigest();(OUT/'文件校验_SHA256.txt').write_text(sha+'  '+f.name+'\n',encoding='utf-8')
s=(P/'test_atlas.cjs').read_text(encoding='utf-8').splitlines()
s[0]="import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawn} from 'node:child_process';import {pathToFileURL,fileURLToPath} from 'node:url';const __dirname=path.dirname(fileURLToPath(import.meta.url));"
s='\n'.join(s).replace("require('os').homedir()","os.homedir()").replace("'全国高校离线地图'","'全国高校离线地图_v5_校区补充'").replace('全国高校地图_离线数据增强版.html','全国高校地图_v5_离线校区补充版.html')
s=s.replace("['330100','341800','440300']","['330100','341800','440300','320500','230100','110112']")
s=s.replace("const shots=[", "await evaluate(\"__atlas.showCoverage();document.getElementById('coverageDialog').close();\");\n const check=await evaluate(\"({official:__atlas.D.campuses.filter(r=>r.verified).length,profile:__atlas.D.campuses.filter(r=>r.sourceKind==='profile').length,missing:__atlas.D.missingSchools.length,allCampusUIDsValid:__atlas.D.campuses.every(r=>__atlas.D.universities.some(u=>u.id===r.uid))})\"); console.log('V5_CHECK',JSON.stringify(check));\n const shots=[")
(P/'test_v5.mjs').write_text(s,encoding='utf-8')
print(json.dumps({'html':str(f),'bytes':f.stat().st_size,'sha256':sha,'stats':st},ensure_ascii=False),flush=True)
