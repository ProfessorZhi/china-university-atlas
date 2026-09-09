"""Derived V5.3 coverage model: campus, legal-local-boundary evidence, inactive status are distinct states."""


def terminal_city_boundaries(regions):
    """Return p/c keys whose city-level region is already the lowest legal boundary in this dataset.

    This covers province-administered county-level units (e.g. 济源、仙桃、海南直辖县、兵团城市)
    and prefecture-level cities without county/district children (e.g. 东莞、中山、嘉峪关、儋州).
    Such places must not be reported as a missing county/district merely because ``d`` is empty.
    """
    city_keys={(n.get('p',''),n.get('c','')) for n in regions.values() if n.get('c')}
    keys_with_d={(n.get('p',''),n.get('c','')) for n in regions.values() if n.get('d')}
    return city_keys-keys_with_d


def refresh_derived(data, version, date='2026-09-09'):
    universities=data['universities'];campuses=data['campuses'];raw_associations=data.get('districtAssociations',[]);regions=data['regions'];st=data['stats']
    associations=[a for a in raw_associations if a.get('current',True) is not False]
    superseded_associations=[a for a in raw_associations if a.get('current',True) is False]
    data['districtAssociations']=associations
    data['supersededDistrictAssociations']=superseded_associations
    ordinary=[u for u in universities if u['level']!='成人']
    active=[u for u in ordinary if u.get('rankingEligible',True)]
    inactive=[u for u in ordinary if not u.get('rankingEligible',True)]
    terminal_keys=terminal_city_boundaries(regions)
    pending_hosts=[u for u in active if u.get('hostBoundaryStatus')=='pending-new-region']
    pending_boundary_ids={u['id'] for u in pending_hosts}
    pending_boundary_keys={(u.get('p',''),u.get('c','')) for u in pending_hosts}
    def campus_has_local_boundary(r):
        return bool(r.get('d')) or (r.get('p'),r.get('c')) in terminal_keys or (r.get('p'),r.get('c')) in pending_boundary_keys
    campus_ids={r['uid'] for r in campuses}
    local_boundary_campus_ids={r['uid'] for r in campuses if campus_has_local_boundary(r)}
    assoc_ids={a['uid'] for a in associations};evidence_ids=campus_ids|assoc_ids
    local_boundary_evidence_ids=local_boundary_campus_ids|assoc_ids|pending_boundary_ids
    unresolved=[{'uid':u['id'],'学校':u['u'],'省份':u['p'],'城市':u['c'],'层次':u['level'],'档案编号':u.get('profileId',''),'缺口':'现役候选且尚无校区/办学地点记录，也无法定地方边界归属证据'} for u in active if u['id'] not in evidence_ids]
    campus_gaps=[{'uid':u['id'],'学校':u['u'],'省份':u['p'],'城市':u['c'],'层次':u['level'],'状态':'已有县区/等效法定边界证据，精确校区/门牌仍待补' if u['id'] in assoc_ids else '尚无校区/办学地点记录'} for u in active if u['id'] not in campus_ids]
    district_only=[{'uid':u['id'],'学校':u['u'],'省份':u['p'],'城市':u['c'],'层次':u['level'],'状态':'县区/等效法定边界证据已收录；不冒充校区门牌或坐标'} for u in active if u['id'] in assoc_ids and u['id'] not in campus_ids]
    city_only=[{'uid':u['id'],'学校':u['u'],'省份':u['p'],'城市':u['c'],'层次':u['level'],'缺口':'已有办学地点，但当前记录尚未映射到最低可用法定行政边界'} for u in active if u['id'] in campus_ids and u['id'] not in local_boundary_campus_ids and u['id'] not in pending_boundary_ids]
    campus_location_gaps=[{'campus_id':r.get('id'),'uid':r.get('uid'),'学校':r.get('u'),'省份':r.get('p'),'城市':r.get('c'),'校区':r.get('campus'),'地址':r.get('address'),'来源类型':r.get('sourceKind'),'状态':r.get('status')} for r in campuses if not campus_has_local_boundary(r)]
    campus_regions={(r['p'],r['c'],r.get('d','')) for r in campuses if r.get('d') or (r.get('p'),r.get('c')) in terminal_keys}
    assoc_regions={(a['p'],a['c'],a['d']) for a in associations if a.get('d')}
    st.update(
        campusRecords=len(campuses),positionedCampuses=sum(isinstance(r.get('lng'),(int,float)) and isinstance(r.get('lat'),(int,float)) for r in campuses),schoolsWithCampuses=len(campus_ids),districtsWithCampuses=len(campus_regions),
        campusRecordsWithLowestLegalBoundary=len(campuses)-len(campus_location_gaps),campusRecordsOnlyCityLocation=len(campus_location_gaps),campusRecordsPendingBoundary=sum((r.get('p'),r.get('c')) in pending_boundary_keys for r in campuses),
        ordinarySchoolsWithLocations=sum(u['id'] in evidence_ids for u in active),ordinarySchoolsWithAnyLocationEvidence=sum(u['id'] in evidence_ids for u in active),ordinarySchoolsWithCampusRecords=sum(u['id'] in campus_ids for u in active),
        ordinarySchoolsWithoutLocations=len(unresolved),ordinarySchoolsWithoutAnyLocationEvidence=len(unresolved),ordinarySchoolsWithoutCampusRecords=len(campus_gaps),ordinarySchoolsDistrictEvidenceOnly=len(district_only),ordinarySchoolsOnlyCityLocation=len(city_only),
        resolvedInactiveOrdinarySchools=len(inactive),activeOrdinarySchools=len(active),pendingNewHostCitySchools=len(pending_hosts),pendingNewBoundarySchools=len(pending_hosts),officialCampusAssociations=sum(bool(r.get('verified')) for r in campuses),officialLocationRecords=sum(bool(r.get('verified')) for r in campuses),corroboratedLocationRecords=sum(r.get('sourceKind')=='corroborated' for r in campuses),
        districtAssociationRawRecords=len(raw_associations),districtAssociationRecords=len(associations),supersededDistrictAssociationRecords=len(superseded_associations),districtAssociationSchools=len(assoc_ids),verifiedDistrictAssociationRecords=sum(bool(a.get('verified')) for a in associations),ordinarySchoolsWithDistrictEvidence=sum(u['id'] in local_boundary_evidence_ids for u in active),ordinarySchoolsWithLowestLegalLocationEvidence=sum(u['id'] in local_boundary_evidence_ids for u in active),districtsWithCandidates=len(campus_regions|assoc_regions),
        terminalCityBoundaries=len(terminal_keys),activeSchoolsAtTerminalCityBoundary=sum(u['id'] in local_boundary_campus_ids and (u['p'],u['c']) in terminal_keys for u in active)
    )
    data['missingSchools']=unresolved;data['campusRecordGaps']=campus_gaps;data['districtEvidenceOnlySchools']=district_only;data['cityOnlySchools']=city_only;data['campusLocationGaps']=campus_location_gaps
    data['terminalCityBoundaries']=[{'省份':p,'城市或县级单位':c,'说明':'该 p/c 在当前法定区划数据中无 d 子级，城市/县级单位边界即最低可用法定行政边界'} for p,c in sorted(terminal_keys)]
    data['inactiveSchools']=[{'uid':u['id'],'学校':u['u'],'省份':u['p'],'城市':u['c'],'状态':u.get('entityStatus'),'说明':u.get('statusLabel'),'依据':u.get('statusSourceUrl')} for u in inactive]
    pending_rows=[{'uid':u['id'],'学校':u['u'],'省份':u['p'],'主城市':u['c'],'边界状态':u.get('hostBoundaryStatus'),'依据':u.get('hostOverrideSourceUrl'),'说明':u.get('hostOverrideNote')} for u in pending_hosts]
    data['pendingHostCities']=pending_rows;data['pendingBoundarySchools']=pending_rows
    coverage=[]
    for p in data.get('provinceCities',{}):
        us=[u for u in active if u['p']==p];rs=[r for r in campuses if r['p']==p];aa=[a for a in associations if a['p']==p]
        terminal_in_p={(pp,c) for pp,c in terminal_keys if pp==p}
        local_units={(r['c'],r['d']) for r in rs if r.get('d')}|{(r['c'],'') for r in rs if (r.get('p'),r.get('c')) in terminal_keys}|{(a['c'],a['d']) for a in aa if a.get('d')}
        all_local_units={(n['c'],n['d']) for n in regions.values() if n['p']==p and n.get('d')}|{(c,'') for pp,c in terminal_in_p}
        province_campus_gaps=sum(not campus_has_local_boundary(r) for r in rs)
        coverage.append({'province':p,'schools':len(us),'registrySchools':sum(u['p']==p for u in ordinary),'inactiveSchools':sum(u['p']==p for u in inactive),'locatedSchools':sum(u['id'] in evidence_ids for u in us),'campusLocatedSchools':sum(u['id'] in campus_ids for u in us),'districtEvidenceOnly':sum(u['id'] in assoc_ids and u['id'] not in campus_ids for u in us),'missingSchools':sum(u['id'] not in evidence_ids for u in us),'pendingBoundarySchools':sum(u['id'] in pending_boundary_ids for u in us),'campuses':len(rs),'campusRecordsWithLowestLegalBoundary':len(rs)-province_campus_gaps,'campusLocationGaps':province_campus_gaps,'districtAssociations':len(aa),'districts':len(local_units),'allDistricts':len(all_local_units),'verifiedRecords':sum(bool(r.get('verified')) for r in rs)})
    data['coverage']=coverage;data.setdefault('revision',{})['version']=version;data['revision']['date']=date
    return data
