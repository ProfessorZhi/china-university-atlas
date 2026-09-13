import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist', 'china-university-atlas.html');
const OUT_CSV = path.join(ROOT, 'reports', 'best-university-coverage.csv');
const OUT_JSON = path.join(ROOT, 'reports', 'best-university-coverage.json');
const CHECK = process.argv.includes('--check');
const collator = new Intl.Collator('zh-CN');

function readSchoolData() {
  const html = fs.readFileSync(DIST, 'utf8');
  const m = html.match(/<script[^>]+id=["']schoolData["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) throw new Error('schoolData JSON not found in dist/china-university-atlas.html');
  return JSON.parse(m[1]);
}

const D = readSchoolData();
const active = (D.universities || []).filter(u => u?.rankingEligible !== false && u?.level !== '成人');
const UM = new Map(active.map(u => [u.id, u]));
const campuses = (D.campuses || []).filter(r => UM.has(r.uid));
const associations = (D.districtAssociations || []).filter(r => UM.has(r.uid));

const key = (...xs) => xs.join('|');
const byProvince = new Map();
const byCity = new Map();
const pushMap = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
for (const u of active) {
  pushMap(byProvince, u.p || '', u);
  pushMap(byCity, key(u.p || '', u.c || ''), u);
}

function unwrap(entry) {
  return entry && typeof entry.u === 'object' ? entry.u : entry;
}
function priority(u) {
  const x = u?.mapPriority;
  if (Array.isArray(x) && x.length) return x;
  return [u?.level === '本科' ? 0 : u?.level === '专科' ? 1 : 2,
    (u?.tags || []).includes('985') ? 0 : (u?.tags || []).includes('211') ? 1 : (u?.tags || []).includes('双一流') ? 2 : 3,
    Number.isFinite(Number(u?.rank)) ? Number(u.rank) : 999999,
    u?.private ? 1 : 0];
}
function compareU(a, b) {
  const x = priority(a), y = priority(b), n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const xv = x[i] ?? 999999, yv = y[i] ?? 999999;
    if (xv !== yv) return xv - yv;
  }
  return collator.compare(String(a?.u || ''), String(b?.u || ''));
}
function rankKind(u) {
  const p = u?.preferredRank;
  if (!p) return 'none';
  return p.legacy || p.rankingId === 'legacy-shanghairanking-bcur' ? 'legacy' : 'normalized';
}
function prestigeName(u) {
  const tags = new Set(u?.tags || []);
  return tags.has('985') ? '985' : tags.has('211') ? '211' : tags.has('双一流') ? '双一流' : 'none';
}
function decision(winner, runner, poolMeta = {}) {
  if (!runner) {
    if (poolMeta.candidateCount > poolMeta.poolCount && poolMeta.poolCount === 1) return ['campus_precedence', 'policy'];
    return ['single_candidate', 'policy'];
  }
  const a = priority(winner), b = priority(runner);
  if ((a[0] ?? 999999) !== (b[0] ?? 999999)) return ['level_order', 'policy'];
  if ((a[1] ?? 999999) !== (b[1] ?? 999999)) return ['prestige_tag', 'strong'];
  if ((a[2] ?? 999999) !== (b[2] ?? 999999)) return rankKind(winner) === 'normalized' ? ['normalized_ranking', 'strong'] : ['legacy_ranking', 'legacy'];
  if ((a[3] ?? 999999) !== (b[3] ?? 999999)) return ['public_before_private', 'weak'];
  return ['name_zh_fallback', 'weak'];
}
function describeDecision(kind, w, r) {
  if (kind === 'single_candidate') return '该行政单元仅有1个可参与当前口径的候选';
  if (kind === 'campus_precedence') return '区县层优先实际 campus；association-only 候选不与 campus 候选争夺 winner';
  if (kind === 'level_order') return `${w.level}优先于${r?.level || '较低层次候选'}`;
  if (kind === 'prestige_tag') return `${prestigeName(w)}政策标签优先于${prestigeName(r)}`;
  if (kind === 'normalized_ranking') return `版本化排名 ${w.preferredRank?.label || ''}`.trim();
  if (kind === 'legacy_ranking') return `迁移中的排名快照 ${w.preferredRank?.label || ''}`.trim();
  if (kind === 'public_before_private') return '同层次、同政策标签、同排名值时公办优先';
  if (kind === 'name_zh_fallback') return '前序规则完全打平，最终按中文名称排序';
  if (kind === 'reference_fallback') return '无学校主体候选，仅沿用省级参考标签';
  return '';
}

function districtCandidates(p, c, d) {
  const map = new Map();
  const ensure = uid => {
    if (!UM.has(uid)) return null;
    if (!map.has(uid)) map.set(uid, { u: UM.get(uid), hasCampus: false, hasAssociation: false, entityExact: false, campusRows: [], associationRows: [] });
    return map.get(uid);
  };
  for (const u of active) if (u.p === p && u.c === c && u.d === d) ensure(u.id).entityExact = true;
  for (const r of campuses) if (r.p === p && r.c === c && r.d === d) { const x = ensure(r.uid); if (x) { x.hasCampus = true; x.campusRows.push(r); } }
  for (const a of associations) if (a.p === p && a.c === c && a.d === d) { const x = ensure(a.uid); if (x) { x.hasAssociation = true; x.associationRows.push(a); } }
  const all = [...map.values()];
  const exact = all.filter(x => x.hasCampus);
  const pool = exact.length ? exact : all;
  return { all, pool, campusPreferred: exact.length > 0 && exact.length < all.length };
}
function locationBasis(scope, entry) {
  if (scope !== 'district') return 'entity_home';
  if (entry?.hasCampus) return 'campus';
  if (entry?.hasAssociation) return 'district_association';
  if (entry?.entityExact) return 'entity_home_district';
  return '';
}
function locationEvidence(entry) {
  if (!entry?.hasCampus) return entry?.hasAssociation ? 'association' : 'entity';
  const rr = entry.campusRows || [];
  if (rr.some(r => r.verified)) return 'verified_campus';
  if (rr.some(r => ['official', 'government'].includes(r.sourceKind))) return 'official_unverified_campus';
  if (rr.some(r => r.sourceKind === 'corroborated')) return 'corroborated_campus';
  return 'profile_or_other_campus';
}
function rankingFields(u) {
  const p = u?.preferredRank || {};
  return {
    ranking_kind: rankKind(u), ranking_id: p.rankingId || '', ranking_edition: p.edition || '',
    ranking_label: p.label || '', ranking_sort_value: Number.isFinite(Number(p.sortValue)) ? Number(p.sortValue) : '',
    ranking_source_url: p.sourceUrl || ''
  };
}

const rows = [];
function addRow(scope, p, c, d, entries, options = {}) {
  const candidates = entries.map(unwrap).filter(Boolean);
  const sortedEntries = entries.slice().sort((a, b) => compareU(unwrap(a), unwrap(b)));
  const winnerEntry = sortedEntries[0] || null, runnerEntry = sortedEntries[1] || null;
  const winner = unwrap(winnerEntry), runner = unwrap(runnerEntry);
  let kind = '', strength = '', detail = '', status = 'no_candidate';
  if (winner) {
    [kind, strength] = decision(winner, runner, { candidateCount: options.candidateCount ?? entries.length, poolCount: entries.length });
    detail = describeDecision(kind, winner, runner);
    status = strength === 'strong' ? 'resolved_strong' : strength === 'policy' ? 'resolved_policy' : strength === 'legacy' ? 'resolved_legacy' : 'resolved_weak';
  } else if (options.referenceWinner) {
    kind = 'reference_fallback'; strength = 'reference'; detail = describeDecision(kind); status = 'reference_only';
  }
  const rank = rankingFields(winner);
  const needs = !!winner && entries.length > 1 && ['legacy_ranking', 'public_before_private', 'name_zh_fallback'].includes(kind);
  rows.push({
    scope_level: scope, province: p, city: c, district: d,
    candidate_count: options.candidateCount ?? candidates.length, competition_pool_count: entries.length,
    winner_uid: winner?.id || '', winner: winner?.u || options.referenceWinner || '', winner_level: winner?.level || '',
    winner_private: winner ? (winner.private ? 'yes' : 'no') : '', winner_tags: (winner?.tags || []).join('|'),
    location_basis: locationBasis(scope, winnerEntry), location_evidence: locationEvidence(winnerEntry),
    decision_basis: kind, decision_detail: detail, evidence_strength: strength, status,
    ...rank,
    runner_up_uid: runner?.id || '', runner_up: runner?.u || '', runner_up_level: runner?.level || '',
    needs_ranking_backfill: needs ? 'yes' : 'no',
    notes: options.campusPreferred ? 'district campus candidates take precedence over association-only candidates' : ''
  });
}

addRow('country', '', '', '', active);
const provinces = new Set([...Object.keys(D.provinceCities || {}), ...active.map(u => u.p), ...Object.values(D.regions || {}).map(r => r.p).filter(Boolean), ...Object.keys(D.provinceBest || {})]);
for (const p of [...provinces].sort(collator.compare)) {
  const candidates = (byProvince.get(p) || []).slice();
  addRow('province', p, '', '', candidates, { referenceWinner: !candidates.length ? D.provinceBest?.[p] : '' });
}
const citySet = new Set();
for (const [p, cs] of Object.entries(D.provinceCities || {})) for (const c of cs || []) citySet.add(key(p, c));
for (const r of Object.values(D.regions || {})) if (r.p && r.c) citySet.add(key(r.p, r.c));
for (const u of active) if (u.p && u.c) citySet.add(key(u.p, u.c));
for (const r of campuses) if (r.p && r.c) citySet.add(key(r.p, r.c));
for (const a of associations) if (a.p && a.c) citySet.add(key(a.p, a.c));
for (const k of [...citySet].sort((a, b) => collator.compare(a, b))) {
  const [p, c] = k.split('|');
  addRow('city', p, c, '', (byCity.get(k) || []).slice());
}
const districtSet = new Set();
for (const r of Object.values(D.regions || {})) if (r.p && r.c && r.d) districtSet.add(key(r.p, r.c, r.d));
for (const r of campuses) if (r.p && r.c && r.d) districtSet.add(key(r.p, r.c, r.d));
for (const a of associations) if (a.p && a.c && a.d) districtSet.add(key(a.p, a.c, a.d));
for (const k of [...districtSet].sort((a, b) => collator.compare(a, b))) {
  const [p, c, d] = k.split('|');
  const dc = districtCandidates(p, c, d);
  addRow('district', p, c, d, dc.pool, { candidateCount: dc.all.length, campusPreferred: dc.campusPreferred });
}

const scopeOrder = { country: 0, province: 1, city: 2, district: 3 };
rows.sort((a, b) => scopeOrder[a.scope_level] - scopeOrder[b.scope_level] || collator.compare(key(a.province, a.city, a.district), key(b.province, b.city, b.district)));
const fields = ['scope_level','province','city','district','candidate_count','competition_pool_count','winner_uid','winner','winner_level','winner_private','winner_tags','location_basis','location_evidence','decision_basis','decision_detail','evidence_strength','status','ranking_kind','ranking_id','ranking_edition','ranking_label','ranking_sort_value','ranking_source_url','runner_up_uid','runner_up','runner_up_level','needs_ranking_backfill','notes'];
const csvCell = v => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replaceAll('"','""')}"` : s; };
const csv = '\uFEFF' + [fields.join(','), ...rows.map(r => fields.map(f => csvCell(r[f])).join(','))].join('\r\n') + '\r\n';

const byScope = {};
for (const scope of Object.keys(scopeOrder)) {
  const rr = rows.filter(r => r.scope_level === scope), cand = rr.filter(r => r.candidate_count > 0);
  byScope[scope] = {
    totalUnits: rr.length, candidateUnits: cand.length, noCandidateUnits: rr.length - cand.length,
    strong: cand.filter(r => r.evidence_strength === 'strong').length,
    policy: cand.filter(r => r.evidence_strength === 'policy').length,
    legacy: cand.filter(r => r.evidence_strength === 'legacy').length,
    weak: cand.filter(r => r.evidence_strength === 'weak').length,
    rankingBackfillUnits: cand.filter(r => r.needs_ranking_backfill === 'yes').length
  };
}
const backfillImpact = new Map();
for (const r of rows.filter(r => r.needs_ranking_backfill === 'yes')) {
  for (const [uid, name, role] of [[r.winner_uid, r.winner, 'winner'], [r.runner_up_uid, r.runner_up, 'runner_up']]) {
    if (!uid) continue;
    if (!backfillImpact.has(uid)) backfillImpact.set(uid, { uid, university: name, affectedUnits: 0, winnerUnits: 0, runnerUpUnits: 0, scopes: new Set() });
    const x = backfillImpact.get(uid); x.affectedUnits++; x[role === 'winner' ? 'winnerUnits' : 'runner_up' ? 'runnerUpUnits' : 'runnerUpUnits']++; x.scopes.add(r.scope_level);
  }
}
const rankingBackfillPriority = [...backfillImpact.values()].map(x => ({ ...x, scopes: [...x.scopes].sort() })).sort((a, b) => b.affectedUnits - a.affectedUnits || collator.compare(a.university, b.university));
const summary = {
  generatedFrom: 'dist/china-university-atlas.html schoolData',
  rankingPolicyVersion: D.rankingPolicy?.policyVersion || '',
  activeOrdinarySchools: active.length,
  mapSemantics: {
    province: 'school entity home province', city: 'school entity home city only; external branches do not compete',
    district: 'actual campus candidates first; association-only candidates compete only when no campus candidate exists',
    defaultAdultExcluded: true
  },
  byScope,
  candidateUnitsTotal: rows.filter(r => r.candidate_count > 0).length,
  weakOrLegacyUnits: rows.filter(r => r.candidate_count > 0 && ['weak','legacy'].includes(r.evidence_strength)).length,
  rankingBackfillPriority,
  weakUnits: rows.filter(r => r.candidate_count > 0 && r.evidence_strength === 'weak').map(r => ({ scope: r.scope_level, province: r.province, city: r.city, district: r.district, winner: r.winner, runnerUp: r.runner_up, basis: r.decision_basis })),
  legacyUnits: rows.filter(r => r.candidate_count > 0 && r.evidence_strength === 'legacy').map(r => ({ scope: r.scope_level, province: r.province, city: r.city, district: r.district, winner: r.winner, runnerUp: r.runner_up, basis: r.decision_basis }))
};
const json = JSON.stringify(summary, null, 2) + '\n';

function writeOrCheck(file, content) {
  if (CHECK) {
    const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (old !== content) throw new Error(`stale derived report: ${path.relative(ROOT, file)}`);
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
  }
}
writeOrCheck(OUT_CSV, csv);
writeOrCheck(OUT_JSON, json);
console.log(JSON.stringify({ mode: CHECK ? 'check' : 'write', rows: rows.length, candidateUnits: summary.candidateUnitsTotal, weakOrLegacyUnits: summary.weakOrLegacyUnits, byScope }, null, 2));
