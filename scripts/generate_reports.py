"""Generate deterministic V5.3 derived reports from the same data model used by the offline HTML."""
import argparse,csv,io,json
from build import ROOT,load_data

UNIVERSITY_FIELDS=['id','u','p','c','d','regp','hostRaw','level','rankLabel','rank','tags','private','source','notes','profileId','officialWebsite','profileAddress','rankingEligible','entityStatus','statusLabel','statusEffectiveFrom','statusSourceUrl','statusEvidence','hostBoundaryStatus','hostOverrideSourceUrl','hostOverrideEvidence','hostOverrideNote','originalHost']
CAMPUS_FIELDS=['id','uid','u','p','c','d','campus','level','rank','rankLabel','tags','address','sourceName','status','source','sourceUrl','verified','lng','lat','sourceKind','evidence','dataUrl','retrievedAt','locationMethod','coordinateStatus','verifiedAt','addressAliases','notes']
ASSOCIATION_FIELDS=['id','uid','u','p','c','d','regionId','precision','source','sourceKind','sourceUrl','verified','retrievedAt','status','evidence','note']
MISSING_FIELDS=['uid','学校','省份','城市','层次','档案编号','缺口']
CITY_ONLY_FIELDS=['uid','学校','省份','城市','层次','缺口']
CAMPUS_GAP_FIELDS=['uid','学校','省份','城市','层次','状态']
DISTRICT_ONLY_FIELDS=['uid','学校','省份','城市','层次','状态']
INACTIVE_FIELDS=['uid','学校','省份','城市','状态','说明','依据']
PENDING_HOST_FIELDS=['uid','学校','省份','主城市','边界状态','依据','说明']

def json_bytes(obj):
    return (json.dumps(obj,ensure_ascii=False,indent=2)+'\n').encode('utf-8')

def csv_bytes(rows,fields):
    s=io.StringIO(newline='');w=csv.DictWriter(s,fieldnames=fields,extrasaction='ignore');w.writeheader();w.writerows(rows)
    return ('\ufeff'+s.getvalue()).encode('utf-8')

def revision_summary(d):
    st=d['stats']
    return {
        'version':d.get('revision',{}).get('version'),'date':d.get('revision',{}).get('date'),'previousVersion':'5.2.0',
        'scope':'V5.3 以学校主体归属、实际办学地点、县区证据和停招/并转状态分层；城市主榜仅本地主体高校参与，异地本科与研究生办学分层展示。',
        'activeOrdinarySchools':st.get('activeOrdinarySchools'),'resolvedInactiveOrdinarySchools':st.get('resolvedInactiveOrdinarySchools'),
        'activeMissingAnyLocationEvidence':st.get('ordinarySchoolsWithoutAnyLocationEvidence'),'activeCityOnlyLocation':st.get('ordinarySchoolsOnlyCityLocation'),
        'activeWithoutCampusRecords':st.get('ordinarySchoolsWithoutCampusRecords'),'districtEvidenceOnlySchools':st.get('ordinarySchoolsDistrictEvidenceOnly'),
        'pendingNewHostCitySchools':st.get('pendingNewHostCitySchools'),'campusRecords':st.get('campusRecords'),'districtAssociationRecords':st.get('districtAssociationRecords'),
        'cityAffiliateCities':len(d.get('cityAffiliates',{})),'cityAffiliateItems':sum(len(t.get(k,[])) for t in d.get('cityAffiliates',{}).values() for k in ('undergraduate','graduate')),
    }

def expected_reports():
    d=load_data();st=d['stats']
    coverage={'stats':st,'coverage':d['coverage'],'gaps':{
        'activeMissingAnyLocationEvidence':len(d.get('missingSchools',[])),'activeCityOnlyLocation':len(d.get('cityOnlySchools',[])),
        'activeWithoutCampusRecords':len(d.get('campusRecordGaps',[])),'districtEvidenceOnlySchools':len(d.get('districtEvidenceOnlySchools',[])),
        'resolvedInactiveOrdinarySchools':len(d.get('inactiveSchools',[])),'pendingNewHostCitySchools':len(d.get('pendingHostCities',[])),
    }}
    return {
        ROOT/'reports/universities.csv':csv_bytes(d['universities'],UNIVERSITY_FIELDS),ROOT/'reports/campuses.csv':csv_bytes(d['campuses'],CAMPUS_FIELDS),
        ROOT/'reports/district-associations.csv':csv_bytes(d.get('districtAssociations',[]),ASSOCIATION_FIELDS),ROOT/'reports/missing-schools.csv':csv_bytes(d.get('missingSchools',[]),MISSING_FIELDS),
        ROOT/'reports/city-only-schools.csv':csv_bytes(d.get('cityOnlySchools',[]),CITY_ONLY_FIELDS),ROOT/'reports/campus-record-gaps.csv':csv_bytes(d.get('campusRecordGaps',[]),CAMPUS_GAP_FIELDS),
        ROOT/'reports/district-evidence-only-schools.csv':csv_bytes(d.get('districtEvidenceOnlySchools',[]),DISTRICT_ONLY_FIELDS),ROOT/'reports/inactive-schools.csv':csv_bytes(d.get('inactiveSchools',[]),INACTIVE_FIELDS),
        ROOT/'reports/pending-host-cities.csv':csv_bytes(d.get('pendingHostCities',[]),PENDING_HOST_FIELDS),ROOT/'reports/province-coverage.csv':csv_bytes(d.get('coverage',[]),list(d['coverage'][0]) if d.get('coverage') else []),
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
        'activeOrdinarySchools':st.get('activeOrdinarySchools'),'inactiveOrdinarySchools':st.get('resolvedInactiveOrdinarySchools'),
        'activeMissingAnyLocationEvidence':st.get('ordinarySchoolsWithoutAnyLocationEvidence'),'activeCityOnlyLocation':st.get('ordinarySchoolsOnlyCityLocation'),
        'activeWithoutCampusRecords':st.get('ordinarySchoolsWithoutCampusRecords'),'districtEvidenceOnlySchools':st.get('ordinarySchoolsDistrictEvidenceOnly')}
    print(json.dumps(summary,ensure_ascii=False,indent=2))
    if check and mismatches:raise SystemExit('FAIL: derived reports are stale; run python scripts/generate_reports.py')

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--check',action='store_true');args=p.parse_args();sync(args.check)
if __name__=='__main__':main()
