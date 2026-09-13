/* Best-university coverage audit for every country / province / city / district unit.
 *
 * The winner is not recomputed here: src/winner-core.js owns the decision, the page calls the
 * same function, and tests/best-university-parity.mjs asserts the two never disagree. This
 * script only builds each unit's competition pool (country = all; province = school home
 * province; city = school home city only, external branches never compete; district = actual
 * campus candidates first) and writes the per-unit evidence out.
 *
 * Statuses are the V5.6 set: resolved_strong / resolved_policy / unresolved_incomparable
 * (+ no_candidate and reference_only for units with nothing to decide). A unit whose leading
 * candidates cannot be compared stays unresolved - it never falls back to Chinese-name order.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WinnerCore = require('../src/winner-core.js');

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist', 'china-university-atlas.html');
const OUT_CSV = path.join(ROOT, 'reports', 'best-university-coverage.csv');
const OUT_JSON = path.join(ROOT, 'reports', 'best-university-coverage.json');
const CHECK = process.argv.includes('--check');
/* Measurement override only: the committed reports use winner-core's declared default. */
if (process.argv.includes('--no-cross-group-blocks')) WinnerCore.RULES.crossGroupBlocks = false;
const DRY = process.argv.includes('--dry');
const collator = new Intl.Collator('zh-CN');

function readSchoolData() {
  const html = fs.readFileSync(DIST, 'utf8');
  const m = html.match(/<script([^>]*\bid=["']schoolData["'][^>]*)>([\s\S]*?)<\/script>/i);
  if (!m) throw new Error('schoolData payload not found in dist/china-university-atlas.html');
  const attrs = m[1], raw = m[2].trim();
  if (/data-encoding=["']gzip["']/i.test(attrs)) return JSON.parse(zlib.gunzipSync(Buffer.from(raw, 'base64')).toString('utf8'));
  return JSON.parse(raw);
}

const D = readSchoolData();
const active = (D.universities || []).filter(u => u?.rankingEligible !== false && u?.level !== '成人');
const UM = new Map(active.map(u => [u.id, u]));
const campuses = (D.campuses || []).filter(r => UM.has(r.uid));
const associations = (D.districtAssociations || []).filter(r => UM.has(r.uid));

const key = (...xs) => xs.join('|');
const pushMap = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
const byProvince = new Map();
const byCity = new Map();
for (const u of active) {
  pushMap(byProvince, u.p || '', u);
  pushMap(byCity, key(u.p || '', u.c || ''), u);
}

/* Deterministic candidate-list order. Mirrors the page's compareU so a report row lists
 * candidates in the same order the sidebar does; it is never a quality judgement.
 * ``mapPriority`` is [level, prestige, evidenceTier, value, private], where evidenceTier puts an
 * official exact position (0) before an open band (1) and before a school still on the pre-ingestion
 * 总榜 snapshot (2) - the same ladder the winner itself is decided by. */
function compareU(a, b) {
  const x = Array.isArray(a?.mapPriority) && a.mapPriority.length ? a.mapPriority : [9, 9, 2, 999999, a?.private ? 1 : 0];
  const y = Array.isArray(b?.mapPriority) && b.mapPriority.length ? b.mapPriority : [9, 9, 2, 999999, b?.private ? 1 : 0];
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const xv = x[i] ?? 999999, yv = y[i] ?? 999999;
    if (xv !== yv) return xv - yv;
  }
  return collator.compare(String(a?.u || ''), String(b?.u || ''));
}

function unwrap(entry) { return entry && typeof entry.u === 'object' ? entry.u : entry; }

/* District pool: an actual campus outranks an association record. Association-only schools
 * compete only when the district has no campus candidate at all. */
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
/* How strong the location evidence behind a district row actually is. The grade is published so a
 * reader can tell a 官网核验过的 campus from a historical POI that only ever had a coordinate
 * match: a district resting on the latter is auditable as such instead of reading like any other
 * campus. The tiers are checked strongest-first, so a district that also has a good record is
 * never downgraded by a weak one sitting next to it. */
function locationEvidence(entry) {
  if (!entry?.hasCampus) return entry?.hasAssociation ? 'association' : 'entity';
  const rr = entry.campusRows || [];
  if (rr.some(r => r.verified)) return 'verified_campus';
  if (rr.some(r => ['official', 'government'].includes(r.sourceKind))) return 'official_unverified_campus';
  if (rr.some(r => r.sourceKind === 'corroborated')) return 'corroborated_campus';
  if (rr.some(r => r.sourceKind === 'profile')) return 'profile_campus';
  if (rr.some(r => r.sourceKind === 'historical')) return 'historical_campus';
  return 'other_campus';
}

/* The publisher ranks a school on its own list and, for category-split lists, numbers it inside
 * its category as well - on the 高职总榜 (623) `ranking` *is* the category position while the 总榜
 * position lives in the reference column. So the display is the same string the page shows for
 * that school: the position on its own list, followed by the other scale when the two differ
 * ("2026软科医药 1 · 主榜参考 14"). Building it here from `rankDisplay` alone produced a token on
 * the *category* scale while `ranking_scale_field` and the decision both used the reference scale,
 * so a reader could compare one row's 164 with another's 医药 43 and read an inversion that the
 * report's own comparison never made. Publishing the page's label makes the CSV and the UI one
 * artefact (asserted by tests/best-university-parity.mjs) and puts both scales on the row. */
function rankingColumns(d) {
  const r = d.ranking || {};
  const token = r.rankDisplay || (r.band ? r.bandLabel : '') || '';
  const split = r.scaleField === 'rankOverall' && r.listKey !== 'bcur-main';
  return {
    ranking_system: r.legacy ? 'legacy-snapshot' : (r.comparisonGroup || ''),
    comparison_group: r.comparisonGroup || '', ranking_id: r.rankingId || '', ranking_edition: r.edition || '',
    ranking_list: r.listName || '', ranking_category: (split && r.category) ? r.category : '',
    ranking_scale_field: r.scaleField || '',
    ranking_display: r.label || token,
    ranking_reference: r.band ? (r.bandLabel || '') : (r.referenceRank != null ? r.referenceRank : (r.sortValue != null ? r.sortValue : '')),
    ranking_source_url: r.sourceUrl || ''
  };
}

/* The runner-up is only a real runner-up when it competes on the winner's own scale. When it
 * does not, it is the next candidate under the policy that actually decided the unit, so it is
 * published as that - never as a school that "came second" in a comparison nobody performed. */
function runnerUpRow(winner, runner) {
  const rg = runner ? WinnerCore.rankInfo(runner) : null;
  const wg = winner ? WinnerCore.rankInfo(winner) : null;
  const sameScale = !!(rg && wg && rg.group && rg.group === wg.group && rg.kind !== 'none' && rg.kind !== 'legacy');
  return { uid: runner?.id || '', name: runner?.u || '', level: runner?.level || '', system: rg?.group || '', sameScale };
}

const rows = [];
function addRow(scope, p, c, d, entries, options = {}) {
  /* The district pool is a list of wrappers carrying *why* each school is in the pool (a campus
   * here, an association record, its own home district). Those wrappers must survive the decision:
   * winner-core hands back the entry it chose, and that entry is the only place the winner's
   * location basis can come from. Unwrapping first silently blanked location_basis on every
   * district row. Sorting still compares the schools, since mapPriority lives on the school. */
  const candidates = entries.filter(e => unwrap(e));
  const ordered = candidates.slice().sort((a, b) => compareU(unwrap(a), unwrap(b)));
  const d0 = WinnerCore.decideWinner(ordered, { campusPreferred: !!options.campusPreferred, referenceWinner: options.referenceWinner });
  const winner = d0.winner, runner = d0.runnerUp;
  const winnerEntry = d0.winnerEntry;
  const unranked = (d0.unrankedCandidates || []).length;

  let status = d0.status, basis = d0.decisionBasis, strength = d0.evidenceStrength;
  let detail = d0.decisionDetail;
  if (status === WinnerCore.STATUS.NO_CANDIDATE && options.referenceWinner) {
    status = WinnerCore.STATUS.REFERENCE; basis = 'reference_fallback'; strength = 'reference';
    detail = '无学校主体候选，仅沿用省级参考标签';
  }
  const unresolvedReason = d0.unresolvedReason || '';
  const comparable = (d0.comparableCandidates || []).map(x => x.name).join('|');
  // Backfill is needed whenever something decisive is still missing: an unresolved unit (ranking
  // data is precisely what could break its tie), or a resolved one whose winner rests on the
  // pre-ingestion snapshot, on an uncovered candidate, or on a policy that exists only because no
  // comparison was possible. A unit decided by 本科>专科 or a 985/211 tag is *not* a backfill
  // candidate: no further ranking coverage could overturn it, so counting it would only bury the
  // units that really need the data.
  const winnerRank = winner ? WinnerCore.rankInfo(winner) : null;
  /* "Additional coverage could change this decision" - not "the winner happens to be unranked".
   * A winner with no position of its own is a different fact and is counted separately
   * (byScope.winnerWithoutRanking), so a unit the level filter or a national tag settled alone is
   * not flagged: no further listing can overturn 本科>专科 or a 985 designation. What *can* is an
   * unresolved unit, a winner still on the pre-ingestion snapshot, a leading candidate no list
   * covers, or a decision that rests on a coverage rule (公办优先, 唯一被覆盖者). */
  const needs = status === WinnerCore.STATUS.INCOMPARABLE || (!!winner && (
    winnerRank.kind === 'legacy' || unranked > 0 ||
    ['public_before_private', 'single_ranked_candidate'].includes(basis)
  ));
  const runnerInfo = runnerUpRow(winner, runner);
  const notes = [];
  if (options.campusPreferred) notes.push('district campus candidates take precedence over association-only candidates');
  if (status === WinnerCore.STATUS.INCOMPARABLE) notes.push('no winner published: leading candidates are not on a comparable scale');
  if (unranked > 0) notes.push(`${unranked} leading candidate(s) carry no official list ranking`);
  if (winnerRank && winnerRank.kind === 'legacy') notes.push('winner still rests on the pre-ingestion 总榜 snapshot');
  if (status === WinnerCore.STATUS.INCOMPARABLE) notes.push('no winner published: additional ranking coverage is what could settle this unit');
  /* A resolved unit can legitimately have no second place: the deciding rule (本科>专科, a 985/211
   * tag, 公办优先) separated the winner and left nobody on the winner's own scale. Saying so is the
   * honest disclosure; naming one of the set-aside candidates as "runner-up" would be a cross-scale
   * comparison the report is not allowed to make. */
  if (!runner && winner && d0.restCount > 0) notes.push(`no comparable second place: the deciding rule set aside the other ${d0.restCount} candidate(s) without leaving anybody on the winner's own scale`);
  /* Two candidates can share one comparison scale and still be separated by a rule that is not the
   * comparison itself: a 985/211 designation or a 层次 difference outranks a better official
   * position, by policy. The row has to say so, because a reader who sees only "winner" and
   * "runner-up" will otherwise read the second place as the worse-ranked one. */
  const runnerRank = runner ? WinnerCore.rankInfo(runner) : null;
  if (runnerInfo.sameScale && winnerRank.kind === 'numeric' && runnerRank.kind === 'numeric' && runnerRank.value < winnerRank.value) {
    notes.push(`runner-up ${runner.u} holds the better position on the shared comparison scale (${runnerRank.value} vs ${winnerRank.value}); this unit was decided by ${basis}, not by that comparison`);
  }

  rows.push({
    scope_level: scope, province: p, city: c, district: d,
    candidate_count: options.candidateCount ?? candidates.length, competition_pool_count: ordered.length,
    winner_uid: winner?.id || '', winner: winner?.u || options.referenceWinner || '', winner_level: winner?.level || '',
    winner_private: winner ? (winner.private ? 'yes' : 'no') : '', winner_tags: (winner?.tags || []).join('|'),
    decision_basis: basis, decision_detail: detail, evidence_strength: strength, status,
    ...rankingColumns(d0),
    /* A unit with no winner has no location basis to publish. Leaving the columns blank is honest;
     * a stale "entity" would read as if some entity-level record had been checked. */
    location_basis: winnerEntry ? locationBasis(scope, winnerEntry) : '',
    location_evidence: winnerEntry ? locationEvidence(winnerEntry) : '',
    runner_up_uid: runnerInfo.uid, runner_up: runnerInfo.name, runner_up_level: runnerInfo.level,
    runner_up_system: runnerInfo.system, runner_up_same_scale: runnerInfo.sameScale ? 'yes' : 'no',
    unresolved_reason: unresolvedReason, comparable_candidates: comparable,
    needs_ranking_backfill: needs ? 'yes' : 'no', notes: notes.join('; ')
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
const fields = ['scope_level', 'province', 'city', 'district', 'candidate_count', 'competition_pool_count', 'winner_uid', 'winner', 'winner_level', 'winner_private', 'winner_tags', 'decision_basis', 'decision_detail', 'evidence_strength', 'status', 'ranking_system', 'comparison_group', 'ranking_id', 'ranking_edition', 'ranking_list', 'ranking_category', 'ranking_scale_field', 'ranking_display', 'ranking_reference', 'ranking_source_url', 'location_basis', 'location_evidence', 'runner_up_uid', 'runner_up', 'runner_up_level', 'runner_up_system', 'runner_up_same_scale', 'unresolved_reason', 'comparable_candidates', 'needs_ranking_backfill', 'notes'];
const csvCell = v => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
const csv = '﻿' + [fields.join(','), ...rows.map(r => fields.map(f => csvCell(r[f])).join(','))].join('\r\n') + '\r\n';

const RESOLVED = [WinnerCore.STATUS.STRONG, WinnerCore.STATUS.POLICY];
const byScope = {};
for (const scope of Object.keys(scopeOrder)) {
  const rr = rows.filter(r => r.scope_level === scope), cand = rr.filter(r => r.candidate_count > 0);
  const count = f => cand.filter(f).length;
  byScope[scope] = {
    totalUnits: rr.length, candidateUnits: cand.length, noCandidateUnits: rr.length - cand.length,
    strong: count(r => r.status === WinnerCore.STATUS.STRONG),
    policy: count(r => r.status === WinnerCore.STATUS.POLICY),
    unresolvedIncomparable: count(r => r.status === WinnerCore.STATUS.INCOMPARABLE),
    /* Two different facts, and they used to be the same number: a winner that holds no official
     * position of its own is not the same as a unit whose decision more coverage could change. A
     * single-candidate unit has a winner with no ranking AND needs no backfill; a unit decided by a
     * real comparison can need backfill for an uncovered leading candidate while its winner is
     * ranked. Reading the winner's own coverage off the published columns keeps the count auditable
     * from the CSV instead of restating the flag. */
    winnerWithoutRanking: count(r => !!r.winner_uid && !r.ranking_scale_field && !r.ranking_display),
    rankingBackfillUnits: count(r => r.needs_ranking_backfill === 'yes')
  };
}
const candidateRows = rows.filter(r => r.candidate_count > 0);
const kpi = {
  candidateUnitsTotal: candidateRows.length,
  resolvedStrongUnits: candidateRows.filter(r => r.status === WinnerCore.STATUS.STRONG).length,
  resolvedPolicyUnits: candidateRows.filter(r => r.status === WinnerCore.STATUS.POLICY).length,
  unresolvedIncomparableUnits: candidateRows.filter(r => r.status === WinnerCore.STATUS.INCOMPARABLE).length,
  noCandidateUnits: rows.filter(r => r.candidate_count === 0).length,
  // The three Definition-of-Done zeros. Each is asserted structurally, not just counted:
  // winner-core has no name path, no legacy path, and no status outside the V5.6 set.
  legacyWinnerUnits: candidateRows.filter(r => RESOLVED.includes(r.status) && r.decision_basis === 'legacy_ranking').length,
  nameFallbackWinnerUnits: candidateRows.filter(r => RESOLVED.includes(r.status) && r.decision_basis === 'name_zh_fallback').length,
  unreviewedWinnerUnits: candidateRows.filter(r => ![...RESOLVED, WinnerCore.STATUS.INCOMPARABLE].includes(r.status)).length,
  winnerStillOnLegacySnapshot: candidateRows.filter(r => RESOLVED.includes(r.status) && r.notes.includes('pre-ingestion')).length,
  needsRankingBackfillUnits: candidateRows.filter(r => r.needs_ranking_backfill === 'yes').length,
  winnerWithoutRankingUnits: candidateRows.filter(r => !!r.winner_uid && !r.ranking_scale_field && !r.ranking_display).length
};
const basisCounts = {};
for (const r of candidateRows) if (r.decision_basis) basisCounts[r.decision_basis] = (basisCounts[r.decision_basis] || 0) + 1;
const unresolvedCounts = {};
for (const r of candidateRows) if (r.unresolved_reason) unresolvedCounts[r.unresolved_reason] = (unresolvedCounts[r.unresolved_reason] || 0) + 1;

/* Which schools' missing coverage actually blocks a decision.
 *
 * An unresolved unit publishes no winner and no runner-up, so keying this list off those two
 * columns alone left 93 of the 121 unresolved units contributing nothing at all - the units that
 * most need the data were the ones the list could not name. The leading candidates of an
 * unresolved unit are exactly the schools whose list coverage would settle it, so they are
 * counted from the candidate set the row already publishes. */
const backfillImpact = new Map();
const bump = (uid, name, role, scope, viaUnresolved) => {
  if (!uid) return;
  if (!backfillImpact.has(uid)) backfillImpact.set(uid, { uid, university: name, affectedUnits: 0, winnerUnits: 0, runnerUpUnits: 0, unresolvedCandidateUnits: 0, scopes: new Set() });
  const x = backfillImpact.get(uid);
  x.affectedUnits++;
  if (role === 'winner') x.winnerUnits++; else if (role === 'runnerUp') x.runnerUpUnits++; else x.unresolvedCandidateUnits++;
  x.scopes.add(scope);
};
const uidByName = new Map((D.universities || []).map(u => [u.u, u.id]));
for (const r of candidateRows.filter(x => x.needs_ranking_backfill === 'yes')) {
  bump(r.winner_uid, r.winner, 'winner', r.scope_level);
  bump(r.runner_up_uid, r.runner_up, 'runnerUp', r.scope_level);
  if (r.status !== WinnerCore.STATUS.INCOMPARABLE) continue;
  for (const name of (r.comparable_candidates || '').split('|')) {
    if (name) bump(uidByName.get(name) || '', name, 'unresolvedCandidate', r.scope_level);
  }
}
const rankingBackfillPriority = [...backfillImpact.values()].map(x => ({ ...x, scopes: [...x.scopes].sort() })).sort((a, b) => b.affectedUnits - a.affectedUnits || collator.compare(a.university, b.university));

const summary = {
  generatedFrom: 'dist/china-university-atlas.html schoolData',
  winnerCore: 'src/winner-core.js',
  rankingPolicyVersion: D.rankingPolicy?.policyVersion || '',
  mapSemantics: {
    province: 'school entity home province',
    city: 'school entity home city only; external branches, 研究院 and 研究生院 never compete for the city main board',
    district: 'actual campus candidates first; association-only candidates compete only when no campus candidate exists',
    defaultAdultExcluded: true,
    incomparable: 'candidates that cannot be compared stay unresolved_incomparable; Chinese-name order is never used to pick a winner'
  },
  byScope,
  kpi,
  decisionBasisCounts: Object.fromEntries(Object.entries(basisCounts).sort()),
  unresolvedReasonCounts: Object.fromEntries(Object.entries(unresolvedCounts).sort()),
  rankingBackfillPriority,
  unresolvedUnits: candidateRows.filter(r => r.status === WinnerCore.STATUS.INCOMPARABLE).map(r => ({
    scope: r.scope_level, province: r.province, city: r.city, district: r.district,
    reason: r.unresolved_reason, candidates: r.comparable_candidates || '', candidateCount: r.candidate_count
  })),
  policyUnits: candidateRows.filter(r => r.status === WinnerCore.STATUS.POLICY).map(r => ({
    scope: r.scope_level, province: r.province, city: r.city, district: r.district, winner: r.winner, basis: r.decision_basis
  }))
};
const json = JSON.stringify(summary, null, 2) + '\n';

/* Structural guards. Every one of these is an invariant a reader of the report relies on, and a
 * violation fails the audit instead of publishing a row nobody can check. They exist because
 * location_basis was once blank on every district row - the pool wrapper was unwrapped before the
 * decision, so the winner's location basis had nowhere to come from and the whole district layer
 * silently published an unauditable column. */
const problems = [];
const bad = m => problems.push(m);
for (const r of rows) {
  const unit = `${r.scope_level} ${r.province}|${r.city}|${r.district}`;
  const hasWinner = !!r.winner_uid;
  if (hasWinner && !r.location_evidence) bad(`${unit}: winner published with no location evidence`);
  if (r.scope_level === 'district') {
    if (hasWinner && !r.location_basis) bad(`${unit}: district winner published with no location basis`);
  } else if (hasWinner && r.location_basis !== 'entity_home') {
    bad(`${unit}: non-district winner must rest on its own home location`);
  }
  if (r.status === WinnerCore.STATUS.INCOMPARABLE) {
    if (hasWinner || r.decision_basis) bad(`${unit}: incomparable unit published a winner or a basis`);
    if (!r.unresolved_reason) bad(`${unit}: incomparable unit published no unresolved reason`);
  }
  if (RESOLVED.includes(r.status)) {
    if (!hasWinner) bad(`${unit}: resolved unit published no winner`);
    if (!r.decision_basis) bad(`${unit}: resolved unit published no decision basis`);
    if (r.evidence_strength !== (r.status === WinnerCore.STATUS.STRONG ? 'strong' : 'policy')) {
      bad(`${unit}: evidence strength does not match the published status`);
    }
    if (r.winner_uid === r.runner_up_uid) bad(`${unit}: the same school is both winner and runner-up`);
    /* A published runner-up is a claim about a comparison, so it must be a candidate the winner
     * was actually compared against. This is the guard that would have caught the cross-scale
     * min() that used to fill the slot: no runner-up may be published on a different scale. */
    if (r.runner_up_uid && r.runner_up_same_scale !== 'yes') {
      bad(`${unit}: runner-up published on a different ranking scale (${r.runner_up_system || 'no list'})`);
    }
  }
}
if (problems.length) {
  throw new Error(`coverage audit failed its own structural guards (${problems.length}):\n  ` + problems.slice(0, 20).join('\n  '));
}

function writeOrCheck(file, content) {
  if (DRY) return;
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
console.log(JSON.stringify({ mode: CHECK ? 'check' : 'write', rows: rows.length, kpi, byScope, decisionBasisCounts: summary.decisionBasisCounts, unresolvedReasonCounts: summary.unresolvedReasonCounts }, null, 2));
