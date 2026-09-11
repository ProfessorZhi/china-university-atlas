"""Generate deterministic V5.3 derived reports from the same data model used by the offline HTML."""
import argparse,csv,io,json
from build import ROOT,load_data

UNIVERSITY_FIELDS=['id','u','p','c','d','regp','hostRaw','level','rankLabel','rank','tags','private','source','notes','profileId','officialWebsite','profileAddress','rankingEligible','entityStatus','statusLabel','statusEffectiveFrom','statusSourceUrl','statusEvidence','hostBoundaryStatus','hostOverrideSourceUrl','hostOverrideEvidence','hostOverrideNote','originalHost','preferredRank','latestRankings','admissionFactCount','latestAdmissionYear','financeFactCount','latestFinanceYear']
CAMPUS_FIELDS=['id','uid','u','p','c','d','campus','level','rank','rankLabel','tags','address','sourceName','status','source','sourceUrl','verified','lng','lat','sourceKind','evidence','dataUrl','retrievedAt','locationMethod','coordinateStatus','verifiedAt','addressAliases','notes','districtInferenceMethod','districtInferenceEvidence','districtSourceKind','districtSourceUrl','districtVerified','districtInheritedFrom','districtZoneMappingId']
ZONE_MAPPING_FIELDS=['id','p','c','d','matchTerms','sourceKind','sourceUrl','evidence','retrievedAt']
ASSOCIATION_FIELDS=['id','uid','u','p','c','d','regionId','precision','source','sourceKind','sourceUrl','verified','retrievedAt','status','evidence','note']
MISSING_FIELDS=['uid','学校','省份','城市','层次','档案编号','缺口']
CITY_ONLY_FIELDS=['uid','学校','省份','城市','层次','缺口']
CAMPUS_GAP_FIELDS=['uid','学校','省份','城市','层次','状态']
CAMPUS_LOCATION_GAP_FIELDS=['campus_id','uid','学校','省份','城市','校区','地址','来源类型','状态']
DISTRICT_ONLY_FIELDS=['uid','学校','省份','城市','层次','状态']
INACTIVE_FIELDS=['uid','学校','省份','城市','状态','说明','依据']
PENDING_HOST_FIELDS=['uid','学校','省份','主城市','边界状态','依据','说明']
MASTER_FIELDS=['高校代码','学校名称','省级地区','主体城市','办学层次','历史招生批次摘要','民办','985','211','双一流','当前状态','参与当前榜单','地图排序参考','软科最新','软科主榜参考','QS最新','THE最新','ARWU最新','校区记录数','县区证据数','可落最低法定边界','录取事实数','最新录取年份','财务事实数','最新财务年份','学校官网']
RANKING_FIELDS=['id','uid','universityName','rankingId','agency','rankingName','edition','rank','rankDisplay','rankLower','rankUpper','rankMidpoint','referenceRank','referenceRankOrRank','nationalRank','score','category','scope','sourceUrl','publishedAt','retrievedAt','verified','notes','displayLabel']
ADMISSION_FIELDS=['id','uid','universityName','year','sourceProvince','examScheme','subjectGroup','batch','program','minScore','minRank','controlLine','planCount','admittedCount','sourceUrl','sourceKind','retrievedAt','notes']
FINANCE_FIELDS=['id','uid','universityName','fiscalYear','statementType','currency','totalBudget','totalRevenue','totalExpenditure','governmentAppropriation','educationExpenditure','researchExpenditure','sourceUrl','sourceKind','retrievedAt','notes']

def json_bytes(obj):
    return (json.dumps(obj,ensure_ascii=False,indent=2)+'\n').encode('utf-8')

def csv_bytes(rows,fields):
    s=io.StringIO(newline='');w=csv.DictWriter(s,fieldnames=fields,extrasaction='ignore');w.writeheader();w.writerows(rows)
    return ('\ufeff'+s.getvalue()).encode('utf-8')

def revision_summary(d):
    st=d['stats']
    return {
        'version':d.get('revision',{}).get('version'),'date':d.get('revision',{}).get('date'),'previousVersion':'5.2.0',
        'scope':'V5.3 以学校主体归属、实际办学地点、最低法定行政边界证据和停招/并转状态分层；城市主榜仅本地主体高校参与；排名、录取与财务采用版本化事实层。',
        'activeOrdinarySchools':st.get('activeOrdinarySchools'),'resolvedInactiveOrdinarySchools':st.get('resolvedInactiveOrdinarySchools'),
        'activeMissingAnyLocationEvidence':st.get('ordinarySchoolsWithoutAnyLocationEvidence'),'activeCityOnlyLocation':st.get('ordinarySchoolsOnlyCityLocation'),
        'activeWithoutCampusRecords':st.get('ordinarySchoolsWithoutCampusRecords'),'districtEvidenceOnlySchools':st.get('ordinarySchoolsDistrictEvidenceOnly'),
        'pendingNewBoundarySchools':st.get('pendingNewBoundarySchools'),'campusRecords':st.get('campusRecords'),
        'campusRecordsWithLowestLegalBoundary':st.get('campusRecordsWithLowestLegalBoundary'),'campusRecordsOnlyCityLocation':st.get('campusRecordsOnlyCityLocation'),
        'districtAssociationRecords':st.get('districtAssociationRecords'),'rankingFactRecords':st.get('rankingFactRecords'),'rankingFactSchools':st.get('rankingFactSchools'),
        'admissionFactRecords':st.get('admissionFactRecords'),'financeFactRecords':st.get('financeFactRecords'),
        'zoneDistrictMappings':st.get('zoneDistrictMappings'),'zoneMappedCampusDistricts':st.get('zoneMappedCampusDistricts'),
        'cityAffiliateCities':len(d.get('cityAffiliates',{})),'cityAffiliateItems':sum(len(t.get(k,[])) for t in d.get('cityAffiliates',{}).values() for k in ('undergraduate','graduate')),
    }

def rank_text(u,rid):
    r=(u.get('latestRankings') or {}).get(rid)
    if not r:return ''
    label=str(r.get('rankDisplay') or r.get('rank') or '')
    return f"{r.get('edition','')} {label}".strip()

def admission_batch_summary(d,uid):
    rows=[r for r in d.get('admissionFacts',[]) if r.get('uid')==uid and r.get('batch')]
    if not rows:return ''
    pairs=[]
    for r in sorted(rows,key=lambda x:(x.get('year',0),x.get('sourceProvince','')),reverse=True):
        text=f"{r.get('year','')} {r.get('sourceProvince','')} {r.get('batch','')}".strip()
        if text not in pairs:pairs.append(text)
        if len(pairs)>=3:break
    return '；'.join(pairs)

def master_rows(d):
    campus_counts={};assoc_counts={};legal_ids=set()
    terminal={(r.get('省份'),r.get('城市或县级单位')) for r in d.get('terminalCityBoundaries',[])}
    pending={r.get('uid') for r in d.get('pendingBoundarySchools',[])}
    for r in d.get('campuses',[]):
        campus_counts[r['uid']]=campus_counts.get(r['uid'],0)+1
        if r.get('d') or (r.get('p'),r.get('c')) in terminal:legal_ids.add(r['uid'])
    for r in d.get('districtAssociations',[]):
        assoc_counts[r['uid']]=assoc_counts.get(r['uid'],0)+1
        if r.get('d'):legal_ids.add(r['uid'])
    legal_ids|=pending
    out=[]
    for u in d.get('universities',[]):
        tags=set(u.get('tags') or []);soft=(u.get('latestRankings') or {}).get('shanghairanking-bcur') or {};pref=u.get('preferredRank') or {}
        out.append({
            '高校代码':u.get('id'),'学校名称':u.get('u'),'省级地区':u.get('p'),'主体城市':u.get('c'),'办学层次':u.get('level'),'历史招生批次摘要':admission_batch_summary(d,u.get('id')),
            '民办':'是' if u.get('private') else '否','985':'是' if '985' in tags else '否','211':'是' if '211' in tags else '否','双一流':'是' if '双一流' in tags else '否',
            '当前状态':u.get('statusLabel') or ('现役候选' if u.get('rankingEligible',True) else u.get('entityStatus','非现役')),'参与当前榜单':'是' if u.get('rankingEligible',True) else '否','地图排序参考':pref.get('label',''),
            '软科最新':rank_text(u,'shanghairanking-bcur') or (pref.get('label','') if pref.get('rankingId')=='legacy-shanghairanking-bcur' else ''),'软科主榜参考':soft.get('referenceRank',''),
            'QS最新':rank_text(u,'qs-wur'),'THE最新':rank_text(u,'the-wur'),'ARWU最新':rank_text(u,'arwu'),'校区记录数':campus_counts.get(u.get('id'),0),'县区证据数':assoc_counts.get(u.get('id'),0),'可落最低法定边界':'是' if u.get('id') in legal_ids else '否',
            '录取事实数':u.get('admissionFactCount',0),'最新录取年份':u.get('latestAdmissionYear') or '','财务事实数':u.get('financeFactCount',0),'最新财务年份':u.get('latestFinanceYear') or '','学校官网':u.get('officialWebsite','')
        })
    return out

def expected_reports():
    d=load_data();st=d['stats']
    coverage={'stats':st,'coverage':d['coverage'],'gaps':{
        'activeMissingAnyLocationEvidence':len(d.get('missingSchools',[])),'activeCityOnlyLocation':len(d.get('cityOnlySchools',[])),
        'activeWithoutCampusRecords':len(d.get('campusRecordGaps',[])),'districtEvidenceOnlySchools':len(d.get('districtEvidenceOnlySchools',[])),
        'campusRecordsOnlyCityLocation':len(d.get('campusLocationGaps',[])),'pendingNewBoundarySchools':len(d.get('pendingBoundarySchools',[])),
        'resolvedInactiveOrdinarySchools':len(d.get('inactiveSchools',[])),
    }}
    return {
        ROOT/'reports/university-master.csv':csv_bytes(master_rows(d),MASTER_FIELDS),ROOT/'reports/universities.csv':csv_bytes(d['universities'],UNIVERSITY_FIELDS),ROOT/'reports/campuses.csv':csv_bytes(d['campuses'],CAMPUS_FIELDS),
        ROOT/'reports/rankings.csv':csv_bytes(d.get('rankingFacts',[]),RANKING_FIELDS),ROOT/'reports/admissions.csv':csv_bytes(d.get('admissionFacts',[]),ADMISSION_FIELDS),ROOT/'reports/finance.csv':csv_bytes(d.get('financeFacts',[]),FINANCE_FIELDS),
        ROOT/'reports/zone-district-mappings.csv':csv_bytes(d.get('zoneDistrictMappings',[]),ZONE_MAPPING_FIELDS),ROOT/'reports/district-associations.csv':csv_bytes(d.get('districtAssociations',[]),ASSOCIATION_FIELDS),ROOT/'reports/missing-schools.csv':csv_bytes(d.get('missingSchools',[]),MISSING_FIELDS),
        ROOT/'reports/city-only-schools.csv':csv_bytes(d.get('cityOnlySchools',[]),CITY_ONLY_FIELDS),ROOT/'reports/campus-record-gaps.csv':csv_bytes(d.get('campusRecordGaps',[]),CAMPUS_GAP_FIELDS),
        ROOT/'reports/campus-location-gaps.csv':csv_bytes(d.get('campusLocationGaps',[]),CAMPUS_LOCATION_GAP_FIELDS),
        ROOT/'reports/district-evidence-only-schools.csv':csv_bytes(d.get('districtEvidenceOnlySchools',[]),DISTRICT_ONLY_FIELDS),ROOT/'reports/inactive-schools.csv':csv_bytes(d.get('inactiveSchools',[]),INACTIVE_FIELDS),
        ROOT/'reports/pending-host-cities.csv':csv_bytes(d.get('pendingBoundarySchools',[]),PENDING_HOST_FIELDS),ROOT/'reports/province-coverage.csv':csv_bytes(d.get('coverage',[]),list(d['coverage'][0]) if d.get('coverage') else []),
        ROOT/'reports/coverage.json':json_bytes(coverage),ROOT/'reports/revision.json':json_bytes(revision_summary(d)),
    }

def sync(check=False):
    reports=expected_reports();mismatches=[]
    for path,content in reports.items():
        if check:
            if not path.exists() or path.read_bytes()!=content:mismatches.append(path.relative_to(ROOT).as_posix())
        else:
            path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(content)
    d=load_data();st=d['stats'];summary={'mode':'check' if check else 'write','reports':len(reports),'mismatches':mismatches,
        'schoolEntities':len(d.get('universities',[])),'activeOrdinarySchools':st.get('activeOrdinarySchools'),'inactiveOrdinarySchools':st.get('resolvedInactiveOrdinarySchools'),
        'activeMissingAnyLocationEvidence':st.get('ordinarySchoolsWithoutAnyLocationEvidence'),'activeCityOnlyLocation':st.get('ordinarySchoolsOnlyCityLocation'),
        'campusRecordsOnlyCityLocation':st.get('campusRecordsOnlyCityLocation'),'pendingNewBoundarySchools':st.get('pendingNewBoundarySchools'),
        'activeWithoutCampusRecords':st.get('ordinarySchoolsWithoutCampusRecords'),'districtEvidenceOnlySchools':st.get('ordinarySchoolsDistrictEvidenceOnly'),
        'rankingFactRecords':st.get('rankingFactRecords'),'admissionFactRecords':st.get('admissionFactRecords'),'financeFactRecords':st.get('financeFactRecords')}
    print(json.dumps(summary,ensure_ascii=False,indent=2))
    if check and mismatches:raise SystemExit('FAIL: derived reports are stale; run python scripts/generate_reports.py')

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--check',action='store_true');args=p.parse_args();sync(args.check)
if __name__=='__main__':main()




