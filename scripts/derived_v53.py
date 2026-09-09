"""Derived V5.3 coverage model: campus, district evidence, inactive status are distinct states."""

def refresh_derived(data, version, date='2026-09-09'):
    universities=data['universities'];campuses=data['campuses'];associations=data.get('districtAssociations',[]);regions=data['regions'];st=data['stats']
    ordinary=[u for u in universities if u['level']!='成人']
    active=[u for u in ordinary if u.get('rankingEligible',True)]
    inactive=[u for u in ordinary if not u.get('rankingEligible',True)]
    campus_ids={r['uid'] for r in campuses};county_ids={r['uid'] for r in campuses if r.get('d')};assoc_ids={a['uid'] for a in associations};evidence_ids=campus_ids|assoc_ids
    unresolved=[{'uid':u['id'],'学校':u['u'],'省份':u['p'],'城市':u['c'],'层次':u['level'],'档案编号':u.get('profileId',''),'缺口':'现役候选且尚无校区/办学地点记录，也无县区归属证据'} for u in active if u['id'] not in evidence_ids]
    campus_gaps=[{'uid':u['id'],'学校':u['u'],'省份':u['p'],'城市':u['c'],'层次':u['level'],'状态':'已有县区证据，精确校区/门牌仍待补' if u['id'] in assoc_ids else '尚无校区/办学地点记录'} for u in active if u['id'] not in campus_ids]
    district_only=[{'uid':u['id'],'学校':u['u'],'省份':u['p'],'城市':u['c'],'层次':u['level'],'状态':'县区证据已收录；不冒充校区门牌或坐标'} for u in active if u['id'] in assoc_ids and u['id'] not in campus_ids]
    city_only=[{'uid':u['id'],'学校':u['u'],'省份':u['p'],'城市':u['c'],'层次':u['level'],'缺口':'已有办学地点，但当前记录未映射到法定县区轮廓'} for u in active if u['id'] in campus_ids and u['id'] not in county_ids]
    campus_regions={(r['p'],r['c'],r['d']) for r in campuses if r.get('d')};assoc_regions={(a['p'],a['c'],a['d']) for a in associations if a.get('d')};pending_hosts=[u for u in active if u.get('hostBoundaryStatus')=='pending-new-region']
    st.update(
        campusRecords=len(campuses),positionedCampuses=sum(isinstance(r.get('lng'),(int,float)) and isinstance(r.get('lat'),(int,float)) for r in campuses),schoolsWithCampuses=len(campus_ids),districtsWithCampuses=len(campus_regions),
        ordinarySchoolsWithLocations=sum(u['id'] in evidence_ids for u in active),ordinarySchoolsWithAnyLocationEvidence=sum(u['id'] in evidence_ids for u in active),ordinarySchoolsWithCampusRecords=sum(u['id'] in campus_ids for u in active),
        ordinarySchoolsWithoutLocations=len(unresolved),ordinarySchoolsWithoutAnyLocationEvidence=len(unresolved),ordinarySchoolsWithoutCampusRecords=len(campus_gaps),ordinarySchoolsDistrictEvidenceOnly=len(district_only),ordinarySchoolsOnlyCityLocation=len(city_only),
        resolvedInactiveOrdinarySchools=len(inactive),activeOrdinarySchools=len(active),pendingNewHostCitySchools=len(pending_hosts),officialCampusAssociations=sum(bool(r.get('verified')) for r in campuses),officialLocationRecords=sum(bool(r.get('verified')) for r in campuses),corroboratedLocationRecords=sum(r.get('sourceKind')=='corroborated' for r in campuses),
        districtAssociationRecords=len(associations),districtAssociationSchools=len(assoc_ids),verifiedDistrictAssociationRecords=sum(bool(a.get('verified')) for a in associations),ordinarySchoolsWithDistrictEvidence=sum(u['id'] in county_ids or u['id'] in assoc_ids for u in active),districtsWithCandidates=len(campus_regions|assoc_regions)
    )
    data['missingSchools']=unresolved;data['campusRecordGaps']=campus_gaps;data['districtEvidenceOnlySchools']=district_only;data['cityOnlySchools']=city_only
    data['inactiveSchools']=[{'uid':u['id'],'学校':u['u'],'省份':u['p'],'城市':u['c'],'状态':u.get('entityStatus'),'说明':u.get('statusLabel'),'依据':u.get('statusSourceUrl')} for u in inactive]
    data['pendingHostCities']=[{'uid':u['id'],'学校':u['u'],'省份':u['p'],'主城市':u['c'],'边界状态':u.get('hostBoundaryStatus'),'依据':u.get('hostOverrideSourceUrl'),'说明':u.get('hostOverrideNote')} for u in pending_hosts]
    coverage=[]
    for p in data.get('provinceCities',{}):
        us=[u for u in active if u['p']==p];rs=[r for r in campuses if r['p']==p];aa=[a for a in associations if a['p']==p];p_assoc={a['uid'] for a in aa};p_campus={r['uid'] for r in rs};p_evidence=p_assoc|p_campus
        coverage.append({'province':p,'schools':len(us),'registrySchools':sum(u['p']==p for u in ordinary),'inactiveSchools':sum(u['p']==p for u in inactive),'locatedSchools':sum(u['id'] in p_evidence for u in us),'campusLocatedSchools':sum(u['id'] in p_campus for u in us),'districtEvidenceOnly':sum(u['id'] in p_assoc and u['id'] not in p_campus for u in us),'missingSchools':sum(u['id'] not in p_evidence for u in us),'campuses':len(rs),'districtAssociations':len(aa),'districts':len({(r['c'],r['d']) for r in rs if r.get('d')}|{(a['c'],a['d']) for a in aa if a.get('d')}),'allDistricts':sum(n['p']==p and bool(n['d']) for n in regions.values()),'verifiedRecords':sum(bool(r.get('verified')) for r in rs)})
    data['coverage']=coverage;data.setdefault('revision',{})['version']=version;data['revision']['date']=date
    return data
