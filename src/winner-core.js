/* Winner semantics shared by the offline build, the coverage audit and the page.
 *
 * The page and the audit must never disagree about who won a unit, so both call
 * decideWinner() below and tests/best-university-parity.mjs asserts they agree.
 *
 * A winner is declared only on evidence that can actually be compared:
 *
 *   level          本科 > 专科 > 成人              policy
 *   prestige tag   985 > 211 > 双一流 > 无          official designation (strong)
 *   rank           a position on one comparison     strong
 *                  group's own scale
 *
 * Ranks from two different comparison groups are never compared as bare numbers.
 * An open band published by the agency ("500+") is never turned into a position,
 * and the pre-ingestion 总榜 snapshot (``preferredRank.legacy``) is never used to
 * pick a winner - it is a display order and a backfill hint, nothing more.
 *
 * When those rules cannot separate the leading candidates the unit is left
 * ``unresolved_incomparable`` and no winner is invented: Chinese-name order is
 * allowed to order a candidate list, never to choose a best university.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WinnerCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LEVEL_ORDER = ['本科', '专科', '成人'];
  const PRESTIGE_ORDER = ['985', '211', '双一流'];
  const COLLATOR = new Intl.Collator('zh-CN');

  const STATUS = {
    STRONG: 'resolved_strong',
    POLICY: 'resolved_policy',
    INCOMPARABLE: 'unresolved_incomparable',
    NO_CANDIDATE: 'no_candidate',
    REFERENCE: 'reference_only'
  };

  const GLOBAL_GROUP = 'global-university-ranking';

  /* Declared list order, used only by the non-blocking mode and by candidate-list display.
   * It is an atlas convention, never a claim that one scale's numbers beat another's. */
  const GROUP_PRECEDENCE = [
    'shanghairanking-bcur', 'shanghairanking-bcur-private',
    'shanghairanking-bcvcr-public-vocational-undergraduate', 'shanghairanking-bcvcr-private-vocational-undergraduate',
    'shanghairanking-bcvcr-public-vocational', 'shanghairanking-bcvcr-private-vocational',
    'shanghairanking-bcur-art-list',
    'qs-wur', 'the-wur', 'the-asia', 'arwu'
  ];

  /* The one policy switch in this file, so the choice is visible and auditable.
   *
   * An official list position is comparable only inside its own comparison group: 软科's
   * 民办榜, the 职业本科榜 and the 普通本科主榜 are separate scales with no published
   * conversion, and 软科 itself moved 职业本科 out of BCUR in 2025. When the leading
   * candidates split across groups there is no honest order between them, so the unit stays
   * unresolved instead of comparing bare ranks or inventing "职业本科 below 普通本科".
   *
   * The alternative (crossGroupBlocks=false) lets the group whose scale is decidable win and
   * records the other group's champion as an incomparable candidate. scripts/measure_winner_rules.mjs
   * reports both counts; the reports use this setting. */
  const RULES = { crossGroupBlocks: true };

  const UNRESOLVED = {
    NO_RANKING: 'unresolved_incomparable_no_ranking',
    CROSS_SYSTEM: 'unresolved_incomparable_cross_system',
    BAND: 'unresolved_incomparable_band',
    EQUAL_RANK: 'unresolved_incomparable_equal_rank'
  };

  function unwrap(entry) {
    return entry && typeof entry.u === 'object' ? entry.u : entry;
  }

  function levelIndex(u) {
    const i = LEVEL_ORDER.indexOf(u && u.level);
    return i < 0 ? LEVEL_ORDER.length : i;
  }

  function prestigeIndex(u) {
    const tags = (u && u.tags) || [];
    for (let i = 0; i < PRESTIGE_ORDER.length; i++) if (tags.includes(PRESTIGE_ORDER[i])) return i;
    return PRESTIGE_ORDER.length;
  }

  function prestigeName(u) {
    const i = prestigeIndex(u);
    return i < PRESTIGE_ORDER.length ? PRESTIGE_ORDER[i] : '无重点标签';
  }

  function bandFloor(label) {
    const m = /(\d+)/.exec(String(label || ''));
    return m ? Number(m[1]) : null;
  }

  /* How one school's map ranking reads on its own comparison group's scale.
   *
   *   numeric  a published exact position on `group`'s scale
   *   band     an open interval ("500+"); a floor, never a position
   *   legacy   the pre-ingestion 总榜 snapshot; not comparable evidence
   *   none     the school is absent from every list we ingested
   */
  function rankInfo(u) {
    const p = u && u.preferredRank;
    if (!p) return { kind: 'none', group: '', value: null, floor: null, label: '' };
    const group = p.comparisonGroup || p.rankingId || GLOBAL_GROUP;
    const label = p.label || '';
    if (p.legacy) {
      return { kind: 'legacy', group, value: null, floor: bandFloor(p.bandLabel), label };
    }
    const value = Number(p.sortValue);
    if (p.band || !Number.isFinite(value)) {
      return { kind: 'band', group, value: null, floor: bandFloor(p.bandLabel), label };
    }
    return { kind: 'numeric', group, value, floor: null, label };
  }

  /* Deterministic list order. Never a quality judgement: it only decides which of
   * several equally-supported candidates is written first. */
  function displayTier(info) {
    return info.kind === 'numeric' ? 0 : info.kind === 'band' ? 1 : info.kind === 'legacy' ? 2 : 3;
  }

  function compareForDisplay(a, b) {
    const x = unwrap(a), y = unwrap(b);
    const ax = [levelIndex(x), prestigeIndex(x), displayTier(rankInfo(x)), rankInfo(x).value, x.private ? 1 : 0];
    const ay = [levelIndex(y), prestigeIndex(y), displayTier(rankInfo(y)), rankInfo(y).value, y.private ? 1 : 0];
    for (let i = 0; i < ax.length; i++) {
      const xv = ax[i] === null || ax[i] === undefined ? Infinity : ax[i];
      const yv = ay[i] === null || ay[i] === undefined ? Infinity : ay[i];
      if (xv !== yv) return xv < yv ? -1 : 1;
    }
    return COLLATOR.compare(String(x.u || ''), String(y.u || ''));
  }

  /* Order for a list of candidates that were *not* compared. Any rank-derived key would sort them
   * by a comparison the row explicitly says did not happen - and, across scales, by exactly the
   * cross-system comparison this project forbids. So an incomparable unit's candidate list is
   * ordered by name, the one key §13 sanctions for stable display. */
  function compareByName(a, b) {
    return COLLATOR.compare(String(unwrap(a)?.u || ''), String(unwrap(b)?.u || ''));
  }

  function groupLabel(group) {
    return String(group || '').replace(/^shanghairanking-/, '软科 ').replace(/^bcvcr-/, '高职 ');
  }

  function describe(basis, w, r, extra) {
    const wn = (w && w.u) || '';
    const rn = (r && r.u) || '';
    switch (basis) {
      case 'single_candidate': return '该行政单元在现行口径下只有 1 个候选，无需比较';
      case 'campus_precedence': return '区县层以实际办学地点(campus)为准；association-only 候选不参与主榜';
      case 'level_order': return `${w.level}层次优先于${(r && r.level) || '更低层次候选'}（项目层次政策）`;
      case 'prestige_tag': return `${prestigeName(w)} 标签优先于${prestigeName(r)}（国家官方重点建设名单）`;
      case 'comparable_ranking': return `${wn} 在同榜可比名次上优于 ${rn}（${groupLabel(extra && extra.group)}）`;
      /* Only reachable when the winner's scale carried nobody else: the sentence must say that
       * the school is the only one covered, never that it out-ranked anyone. */
      case 'single_ranked_candidate': {
        const g = groupLabel((extra && extra.group) || '');
        const where = g ? `（${g}）` : '';
        return rn
          ? `${wn} 是当前候选里唯一被官方榜单覆盖的学校${where}；其余候选不在该榜覆盖范围内，按项目口径「未覆盖不等于更差」不构成名次比较`
          : `${wn} 是当前候选里唯一被官方榜单覆盖的学校${where}`;
      }
      case 'public_before_private': {
        const base = '同层次同标签下公办优先（按当前项目政策，非排名证据）';
        const inner = extra && extra.innerBasis;
        /* 公办优先 is what narrowed the field, so it stays the basis even when the public subset
         * was then separated by a real comparison - saying only the inner rule would hide the
         * policy that removed the private candidates. */
        if (inner === 'comparable_ranking') return `${base}；公办候选之间再按同榜名次比较`;
        if (inner === 'single_ranked_candidate') return `${base}；公办候选里也只有 ${wn} 被官方榜单覆盖`;
        return base;
      }
      case 'cross_group_scale_policy': return `${wn} 取自主榜序列；其余候选分属不同榜单体系，名次不可直接比较，按当前项目政策以主榜序列为先`;
      case 'reference_fallback': return '无学校主体候选，仅沿用省级参考标签';
      default: return '';
    }
  }

  /* The level / national-tag prefilter is a precondition, not the decision, whenever it left more
   * than one candidate standing. The published basis then names the rule that actually separated
   * them, and this note keeps the prefilter visible: without it a reader applying the published
   * basis to the whole pool would not see why the field was narrowed first. When the prefilter did
   * narrow the pool to a single school it *is* the deciding rule, `describe` already says so, and
   * no note is added. */
  function prefilterNote(token, w) {
    if (token === 'level_order') return `候选池先按层次收敛：${w.level}层次优先于更低层次（项目层次政策）`;
    if (token === 'prestige_tag') return `候选池先按国家标签收敛：${prestigeName(w)}`;
    return '';
  }

  function summarize(items) {
    const names = items.map(x => x.u.u);
    if (names.length <= 6) return names.join('、');
    return names.slice(0, 6).join('、') + ` 等 ${names.length} 所`;
  }
  function describeUnresolved(reason, items, unranked) {
    const names = summarize(items || []);
    switch (reason) {
      case UNRESOLVED.NO_RANKING: return `领先候选（${names}）均无官方榜单可比名次，无法判定先后`;
      case UNRESOLVED.CROSS_SYSTEM: {
        /* Name the scales: "different ranking systems" alone leaves a reader unable to check
         * whether the split is real, and most of these blocks are one recurring pair
         * (普通本科主榜 vs 职业本科榜). */
        const gs = [...new Set((items || []).map(x => x.rank.group).filter(Boolean))].map(groupLabel);
        const gap = gs.length > 1 ? `（${gs.join(' / ')}）` : '';
        return `领先候选（${names}）分属不同榜单体系${gap}，名次不在同一标尺上，不可直接比较`;
      }
      case UNRESOLVED.BAND: {
        /* Say which open interval actually blocked the decision, and whether a number sat
         * inside it - "均落在开放区间" is simply false when one candidate is an exact position
         * that the interval may still contain. */
        const open = [...new Set((items || []).filter(x => x.rank.kind === 'band')
          .map(x => (x.u.preferredRank && x.u.preferredRank.bandLabel) || '').filter(Boolean))];
        const exact = (items || []).filter(x => x.rank.kind === 'numeric');
        const zone = open.length ? open.join('、') : '开放区间';
        const both = (items || []).length > 1;
        return exact.length
          ? `领先候选（${names}）的名次与开放区间（${zone}）重叠，区间内可能包含该名次，无法判定先后`
          : `领先候选（${names}）${both ? '同榜且均落在' : '落在'}开放区间（${zone}），区间内不排序`;
      }
      case UNRESOLVED.EQUAL_RANK: return `领先候选（${names}）在同一榜单上名次相同`;
      default: return '';
    }
  }

  function rankingOf(u) {
    const p = (u && u.preferredRank) || null;
    if (!p) return null;
    return {
      rankingId: p.rankingId || '', comparisonGroup: p.comparisonGroup || p.rankingId || '',
      edition: p.edition || '', label: p.label || '', listKey: p.listKey || '',
      listTypeId: p.listTypeId ?? null, listName: p.listName || '', category: p.category || '',
      scaleField: p.scaleField || '', sortValue: Number.isFinite(Number(p.sortValue)) ? Number(p.sortValue) : null,
      band: !!p.band, bandLabel: p.bandLabel || '', legacy: !!p.legacy, sourceUrl: p.sourceUrl || '',
      rankDisplay: p.rankDisplay || '', referenceRank: p.referenceRank ?? null,
      referenceRankDisplay: p.referenceRankDisplay || '', retrievedAt: p.retrievedAt || ''
    };
  }

  function snapshot(items) {
    return items.map(x => ({
      uid: x.u.id, name: x.u.u, level: x.u.level || '', private: !!x.u.private,
      tags: (x.u.tags || []).slice(), comparisonGroup: x.rank.group,
      evidence: x.rank.kind, rankDisplay: x.rank.label,
      rankValue: x.rank.value, rankBandLabel: x.rank.kind === 'band' ? (x.u.preferredRank && x.u.preferredRank.bandLabel) || '' : ''
    }));
  }

  function result(patch) {
    return Object.assign({
      status: STATUS.NO_CANDIDATE, evidenceStrength: '', decisionBasis: '', decisionDetail: '',
      unresolvedReason: '', winnerEntry: null, winner: null, runnerUpEntry: null, runnerUp: null,
      topEntries: [], comparableCandidates: [], unrankedCandidates: [], incomparableCandidates: [],
      ranking: null, referenceWinner: '', crossGroup: false, poolSize: 0, restCount: 0
    }, patch);
  }

  /* The best-supported candidate on one comparison group's own scale.
   *
   * A band on the same scale is only beaten when the exact position sits inside the open
   * interval the band describes, so "500+" never loses to a number it may still contain. */
  function groupChampion(group, list) {
    const nums = list.filter(x => x.rank.kind === 'numeric');
    const bands = list.filter(x => x.rank.kind === 'band');
    if (!nums.length) return { group, winner: null, top: list, reason: UNRESOLVED.BAND };
    const best = Math.min(...nums.map(x => x.rank.value));
    const tied = nums.filter(x => x.rank.value === best);
    const blocking = bands.filter(x => x.rank.floor === null || best >= x.rank.floor);
    if (tied.length > 1) return { group, winner: null, top: tied.concat(blocking), reason: UNRESOLVED.EQUAL_RANK };
    if (blocking.length) return { group, winner: null, top: tied.concat(blocking), reason: UNRESOLVED.BAND };
    return { group, winner: tied[0], top: tied, reason: '' };
  }

  /* The comparability-safe ladder.
   *
   * Returns { winner, basis, strength, top, reason }. `top` is the set of candidates that
   * survived every rule that could separate them - one entry means a real winner, more than
   * one means the unit is genuinely incomparable. Candidates with no ranking at all are
   * reported separately and never block: an absent list entry means 未覆盖, not "worst".
   *
   * The order of the steps below is the whole policy, and it is deliberate:
   *
   *   1. a comparison that actually happened (one scale, several candidates on it, champion
   *      unbeaten) -> comparable_ranking, strong
   *   2. 公办优先 for a public/private split -> public_before_private, policy
   *   3. the winner is the sole candidate an official list covers -> policy
   *   4. otherwise unresolved
   *
   * Step 3 is a coverage rule, not a comparison - being the only school a list happens to cover
   * says nothing about the others - so it must never run ahead of step 2. It used to: a private
   * school holding the only published position beat a public rival outright, while the same pair
   * elsewhere was settled by 公办优先 merely because both happened to be ranked. Running the
   * policy chain uniformly is what makes two structurally identical units get the same answer,
   * and it is why the "nothing is ranked at all" case no longer escapes the policy early.
   */
  function decideCore(items, ctx) {
    if (items.length === 1) {
      return { winner: items[0], top: items, basis: ctx.basis || 'single_candidate', strength: ctx.strength || 'policy', reason: '', unranked: [] };
    }
    const ranked = items.filter(x => x.rank.kind === 'numeric' || x.rank.kind === 'band');
    const unranked = items.filter(x => x.rank.kind === 'none' || x.rank.kind === 'legacy');

    const groups = new Map();
    for (const x of ranked) {
      if (!groups.has(x.rank.group)) groups.set(x.rank.group, []);
      groups.get(x.rank.group).push(x);
    }
    const champs = [...groups].map(([group, list]) => groupChampion(group, list));
    const decided = champs.filter(c => c.winner);
    const undecided = champs.filter(c => !c.winner);

    /* (1) A ranking comparison really happened here, so the basis is the comparison itself - not
     * the level/prestige reason that merely narrowed the field down to these candidates. A scale
     * carrying the winner and nobody else is *not* a comparison: nothing was compared against
     * anything, so it falls through to the policy steps instead of claiming a same-scale victory. */
    const soloScale = decided.length === 1 && (groups.get(decided[0].group) || []).length === 1;
    if (decided.length === 1 && !undecided.length && !soloScale) {
      return { winner: decided[0].winner, top: decided[0].top, basis: 'comparable_ranking', strength: 'strong', reason: '', unranked };
    }
    /* (2) 公办优先 is an explicit project policy, so it is allowed to settle a public-vs-private
     * split that no ranking can. It is never presented as ranking evidence. The inner result is
     * carried along so the report can disclose what else the policy narrowed away. */
    let policy = null;
    if (items.some(x => !x.u.private) && items.some(x => x.u.private)) {
      policy = decideCore(items.filter(x => !x.u.private), { basis: 'public_before_private', strength: 'policy' });
      if (policy.winner) {
        return {
          winner: policy.winner, top: policy.top, basis: 'public_before_private', strength: 'policy', reason: '',
          unranked: policy.unranked, inner: { basis: policy.basis, strength: policy.strength }
        };
      }
    }
    /* (3) Exactly one candidate is covered by an official list. Its published position is real,
     * but nothing was compared: the decision rests on the coverage policy. */
    if (decided.length === 1 && !undecided.length) {
      return {
        winner: decided[0].winner, top: decided[0].top, basis: ctx.basis || 'single_ranked_candidate',
        strength: ctx.strength || 'policy', reason: '', unranked, covered: true
      };
    }
    if (RULES.crossGroupBlocks) {
      /* The reason must describe what actually blocked the decision. When the policy chain
       * already narrowed the field to a single scale that is still stuck, that block is the
       * operative one - reporting a cross-scale block instead would blame a comparison nobody
       * was left to make. */
      const pTop = policy && policy.top && policy.top.length ? policy.top : null;
      if (pTop && new Set(pTop.map(x => x.rank.group).filter(Boolean)).size === 1) {
        return { winner: null, top: pTop, basis: '', strength: '', reason: policy.reason || UNRESOLVED.NO_RANKING, unranked };
      }
      /* When no candidate is covered by any list there are no groups to take survivors from, and
       * the unit's candidates are the only honest answer for "who was in play". */
      const top = champs.length ? champs.flatMap(c => c.top) : items;
      const topGroups = new Set(top.map(x => x.rank.group).filter(Boolean));
      /* Two decidable scales, or any surviving set spanning comparison groups, is a cross-scale
       * block; a band block is only true when the survivors sit on one scale and one of them is
       * an open interval. */
      const reason = (decided.length > 1 || topGroups.size > 1)
        ? UNRESOLVED.CROSS_SYSTEM
        : (undecided[0] ? undecided[0].reason : UNRESOLVED.NO_RANKING);
      return { winner: null, top, basis: '', strength: '', reason, unranked };
    }
    /* crossGroupBlocks=false: the leading candidates sit on more than one scale. Take the
     * decidable scale's champion and keep the other groups' champions as reported
     * incomparable candidates, labelled as policy rather than as ranking evidence. */
    if (decided.length === 1) {
      return { winner: decided[0].winner, top: decided[0].top, basis: ctx.basis || 'cross_group_scale_policy', strength: ctx.strength || 'policy', reason: '', unranked, crossGroup: champs.length > 1 };
    }
    if (decided.length > 1) {
      const primary = primaryGroupChampion(decided);
      return { winner: primary.winner, top: primary.top, basis: ctx.basis || 'cross_group_scale_policy', strength: ctx.strength || 'policy', reason: '', unranked, crossGroup: true };
    }
    return { winner: null, top: champs.flatMap(c => c.top), basis: '', strength: '', reason: undecided[0] ? undecided[0].reason : UNRESOLVED.NO_RANKING, unranked };
  }

  /* Ordering several group champions is exactly the cross-scale comparison this module refuses,
   * so the non-blocking mode falls back to the atlas's declared list order (普通本科 first,
   * then 民办本科, then the vocational tracks) and labels the result as policy. */
  function primaryGroupChampion(decided) {
    const rank = g => { const i = GROUP_PRECEDENCE.indexOf(g); return i < 0 ? GROUP_PRECEDENCE.length : i; };
    return decided.slice().sort((a, b) => rank(a.group) - rank(b.group) || COLLATOR.compare(a.group, b.group))[0];
  }

  /* Decide the winner of one administrative unit.
   *
   * `entries` is the unit's competition pool: plain university objects, or
   * `{u, hasCampus, ...}` wrappers as the district layer builds them. The caller
   * owns pool membership (city = local-subject schools only; district = campus
   * candidates first), winner-core only owns the comparison.
   */
  function decideWinner(entries, options) {
    const o = options || {};
    const items = [];
    for (const entry of (entries || [])) {
      const u = unwrap(entry);
      if (u) items.push({ entry, u, rank: rankInfo(u) });
    }
    if (!items.length) {
      return result({ status: o.referenceWinner ? STATUS.REFERENCE : STATUS.NO_CANDIDATE, referenceWinner: o.referenceWinner || '', decisionBasis: o.referenceWinner ? 'reference_fallback' : '', decisionDetail: o.referenceWinner ? describe('reference_fallback') : '' });
    }

    const minLevel = Math.min(...items.map(x => levelIndex(x.u)));
    const byLevel = items.filter(x => levelIndex(x.u) === minLevel);
    const minPrestige = Math.min(...byLevel.map(x => prestigeIndex(x.u)));
    const elite = byLevel.filter(x => prestigeIndex(x.u) === minPrestige);

    let basis = '';
    if (byLevel.length < items.length) basis = 'level_order';
    if (elite.length < byLevel.length) basis = 'prestige_tag';
    /* `decideCore` runs without a ctx basis and reports the rule that actually separated the
     * candidates. The prefilter label is published only when it narrowed the pool all the way down
     * to one school, because only there does it truly decide - passing it in as ctx.basis made a
     * rule that merely narrowed the field read as the rule that picked the winner, so two schools
     * still tied on level published "本科层次优先于本科" while a coverage rule quietly broke the tie. */
    const core = decideCore(elite, {});

    const ordered = items.slice().sort(compareForDisplay);
    const unranked = core.unranked || [];

    if (!core.winner) {
      /* This unit's whole published meaning is "these candidates were NOT compared". Ordering the
       * list by rankInfo().value would publish them in an order implied by exactly the comparison
       * the row says did not happen - and across scales, by the comparison the project forbids.
       * Ordering is therefore by name (§13: stable display order only, never a quality judgment),
       * so the list reads as an inventory rather than as a ranking. */
      const top = core.top.slice().sort(compareByName);
      return result({
        status: STATUS.INCOMPARABLE, evidenceStrength: '', decisionBasis: '', decisionDetail: describeUnresolved(core.reason, top),
        unresolvedReason: core.reason, topEntries: top.map(x => x.entry), poolSize: items.length,
        comparableCandidates: snapshot(top), unrankedCandidates: snapshot(unranked)
      });
    }

    const winner = core.winner;
    let finalBasis = basis && elite.length === 1 ? basis : core.basis;
    let finalStrength = core.strength;
    /* 985/211/双一流 are national designations, so a tag that narrowed the pool to a single school
     * is strong evidence. A tag that left several schools standing did not decide anything: the
     * basis then names the rule that separated them, and that rule is not a designation. */
    if (finalBasis === 'prestige_tag' && core.winner) finalStrength = 'strong';
    if (finalBasis === 'single_candidate' && o.campusPreferred) finalBasis = 'campus_precedence';
    /* The runner-up is only ever a real second place: the best remaining candidate on the winner's
     * OWN comparison scale. There used to be a fallback to "whoever sorted first among the rest",
     * and that fallback was a cross-scale min() - in one district it paired 上海大学 (本科, 主榜)
     * with a 民办高职 holding 类别 position 17 instead of the 公办高职 holding 33 on the 总榜, which
     * is precisely the comparison this project forbids, performed in the one column whose entire
     * job is to say who came second. A unit where the deciding rule left nobody on a comparable
     * scale has no second place, so the slot stays empty and the report says so. `restCount`
     * carries how many candidates were set aside, so the report can disclose that without naming
     * one of them as a runner-up. */
    const rest = ordered.filter(x => x !== winner);
    const sameGroup = rest.filter(x => x.rank.group && x.rank.group === winner.rank.group && x.rank.kind !== 'none' && x.rank.kind !== 'legacy');
    const rankOrder = (a, b) => {
      const av = a.rank.kind === 'numeric' ? a.rank.value : (a.rank.floor === null ? Infinity : a.rank.floor);
      const bv = b.rank.kind === 'numeric' ? b.rank.value : (b.rank.floor === null ? Infinity : b.rank.floor);
      return av - bv || compareForDisplay(a, b);
    };
    const runnerUp = sameGroup.length ? sameGroup.slice().sort(rankOrder)[0] : null;
    return result({
      status: finalStrength === 'strong' ? STATUS.STRONG : STATUS.POLICY,
      evidenceStrength: finalStrength, decisionBasis: finalBasis,
      decisionDetail: describe(finalBasis, winner.u, runnerUp ? runnerUp.u : null, { group: winner.rank.group, innerBasis: core.inner ? core.inner.basis : '' })
        + (basis && elite.length > 1 ? '；' + prefilterNote(basis, winner.u) : ''),
      winnerEntry: winner.entry, winner: winner.u, poolSize: items.length,
      runnerUpEntry: runnerUp ? runnerUp.entry : null, runnerUp: runnerUp ? runnerUp.u : null, restCount: rest.length,
      topEntries: [winner.entry], comparableCandidates: snapshot([winner].concat(runnerUp ? [runnerUp] : [])),
      unrankedCandidates: snapshot(unranked.filter(x => x !== winner)), ranking: rankingOf(winner.u),
      crossGroup: !!core.crossGroup,
      incomparableCandidates: core.crossGroup ? snapshot(core.crossGroupIncomparable || []) : []
    });
  }

  return {
    LEVEL_ORDER, PRESTIGE_ORDER, STATUS, UNRESOLVED, RULES, GROUP_PRECEDENCE,
    unwrap, levelIndex, prestigeIndex, prestigeName, rankInfo, compareForDisplay, compareByName,
    decideWinner, describe, describeUnresolved, rankingOf
  };
});
