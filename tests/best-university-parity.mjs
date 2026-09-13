/* Audit <-> UI parity test (V5.6 §18).
 *
 * reports/best-university-coverage.csv and the map must never disagree about who wins a unit.
 * Both call src/winner-core.js, so the *decision* cannot drift; what can drift is the unit's
 * competition pool (which schools are eligible here). This test therefore re-derives every
 * unit inside the real page - using the page's own best(), locationFor(), provinceChildCityName()
 * and schoolRows() - and compares it against the committed audit row by row.
 *
 * It fails on:
 *   - a unit the UI renders whose winner uid / status differs from the audit
 *   - a unit the UI renders that the audit does not cover at all
 *   - an unresolved_incomparable unit whose UI still shows a school name (name fallback leak)
 *   - a resolved_policy unit whose UI does not mark the decision as policy
 *   - an audit unit with candidates that the UI renders nowhere, unless it is a known
 *     structural case (no boundary / a 直辖市 city roll-up, listed explicitly below)
 *   - any HTTP request: the page must stay offline
 *
 * Dependency-free browser test using Chrome DevTools Protocol; Node.js 22+.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

/* Bases that must be disclosed as project policy, never as ranking evidence, both in the
 * report and in the chip the map prints. Kept in one place so a new policy basis cannot be
 * added on the audit side and silently rendered as a ranking win on the map. */
const POLICY_BASES = ['public_before_private', 'level_order', 'campus_precedence', 'single_ranked_candidate'];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSV = path.join(ROOT, 'reports', 'best-university-coverage.csv');
const OUT = path.join(ROOT, 'reports', 'best-university-parity.json');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'university-atlas-parity-'));
const wait = ms => new Promise(r => setTimeout(r, ms));
let proc, ws;
const network = [], errors = [];

function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  for (const c of ['/c/Program Files/Google/Chrome/Application/chrome.exe',
                   'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe']) {
    if (fs.existsSync(c)) return c;
  }
  return execFileSync('which', ['google-chrome'], { encoding: 'utf8' }).trim();
}

/* --- the committed audit ---------------------------------------------------------------- */
const FIELDS = ['scope_level', 'province', 'city', 'district', 'candidate_count', 'competition_pool_count',
  'winner_uid', 'winner', 'status', 'decision_basis', 'unresolved_reason', 'ranking_display'];
function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) { if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\r') { /* skip */ }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.length > 1);
}
const raw = parseCsv(fs.readFileSync(CSV, 'utf8'));
const HEAD = raw[0];
const col = name => HEAD.indexOf(name);
const AUDIT = new Map();
for (const r of raw.slice(1)) {
  const get = n => r[col(n)] ?? '';
  AUDIT.set([get('province'), get('city'), get('district')].join('|'), {  // always 3 parts
    scope: get('scope_level'), province: get('province'), city: get('city'), district: get('district'),
    candidateCount: Number(get('candidate_count') || 0), poolCount: Number(get('competition_pool_count') || 0),
    uid: get('winner_uid'), name: get('winner'), status: get('status'), basis: get('decision_basis'),
    reason: get('unresolved_reason'), display: get('ranking_display')
  });
}
if (!AUDIT.size) throw new Error('reports/best-university-coverage.csv is empty; run node scripts/generate_best_university_coverage.mjs');

/* --- run the page's own unit enumeration ------------------------------------------------ */
const COLLECT = `(async()=>{
  const out=[];
  const q=b=>b?{uid:b.uid||'',u:b.u||'',rawU:b.rawU||'',status:b.status||'',basis:b.basis||'',chip:bestChip(b),count:b.count||0,
                rankLabel:b.winner?rawRank(b.winner):''}
              :{uid:'',u:'',rawU:'',status:'',basis:'',chip:'',count:0,rankLabel:''};
  const provId=n=>n&&!n.c&&n.p?n.id:'';
  const emit=(scope,p,c,d,f,node)=>out.push({scope,p,c,d,...q(best(f,node))});
  const feats=id=>(CACHE[id]||[]).map(feature);
  // country level: the province features ARE the province units when the node kind is country
  const countryNode={id:'100000',name:'',kind:'country',p:'',c:'',d:'',noChildren:false};
  for(const f of feats('100000')){
    if(!f.name)continue;
    emit('province',f.name,'','',f,countryNode);
  }
  // province level: a feature is a city unit when provinceChildCityName() names it, otherwise a district unit
  for(const [id,n] of Object.entries(D.regions||{})){
    if(n.c||!n.p)continue;
    const node={id, name:n.name, kind:'province', p:n.p, c:'', d:'', noChildren:false};
    for(const f of feats(id)){
      const cityName=provinceChildCityName(node,f);
      if(cityName){ emit('city',n.p,cityName,'',f,node); continue; }
      const l=locationFor(f,node);
      if(l.d)emit('district',l.p,l.c,l.d,f,node);
    }
  }
  // city level: districts of every real city node (a city without boundaries renders itself, not districts)
  for(const [id,n] of Object.entries(D.regions||{})){
    if(!n.c||n.d||!CACHE[id])continue;
    const cityName=n.c, node={id, name:n.name, kind:'city', p:n.p, c:cityName, d:'', noChildren:false};
    for(const f of feats(id)) emit('district',n.p,cityName,f.name,f,node);
  }
  /* Phase 2: the same verdicts as *rendered*, read back out of the sidebar DOM. Phase 1 exercises
   * best(); this exercises renderSidebar() so a list that prints the wrong string for an unresolved
   * unit is caught even though best() itself is right. Only the region-list levels are rendered
   * (country -> provinces, province -> cities, city -> districts); the district school-card list
   * shows candidates, not a winner, so there is nothing to compare there. */
  const rendered=[];
  const renderList=(node,geos,p,c)=>{
    S.stack=[root,node]; S.geo=geos; renderSidebar();
    const els=[...document.querySelectorAll('#list .item')];
    els.forEach((el,i)=>{
      const f=geos.filter(x=>x.name)[i]; if(!f)return;
      const l=node.kind==='country'?{p:f.name,c:'',d:''}:locationFor(f,node);
      rendered.push({p:l.p,c:l.c,d:l.d,feature:f.name,
        runi:(el.querySelector('.runi')||{}).textContent||'',
        chip:[...el.querySelectorAll('.chip')].map(x=>x.className).join(' ')});
    });
  };
  renderList({id:'100000',name:'全国',kind:'country',p:'',c:'',d:''},feats('100000'));
  for(const [id,n] of Object.entries(D.regions||{})){
    if(n.c||!n.p)continue;
    renderList({id,name:n.name,kind:'province',p:n.p,c:'',d:'',noChildren:false},feats(id));
  }
  for(const [id,n] of Object.entries(D.regions||{})){
    if(!n.c||n.d||!CACHE[id])continue;
    renderList({id,name:n.name,kind:'city',p:n.p,c:n.c,d:'',noChildren:false},feats(id));
  }
  const core=WinnerCore.decideWinner([...D.universities].filter(allowed).sort(compareU),{});
  return {units:out, rendered, country:{uid:core.winner?core.winner.id:'',name:core.winner?core.winner.u:'',status:core.status,pool:core.poolSize||0},
    regionIndex:Object.fromEntries(Object.entries(D.regions||{}).map(([id,n])=>[[n.p||'',n.c||'',n.d||''].join('|'),id])),
    cacheKeys:Object.keys(CACHE),
    adultDefault:document.getElementById('includeAdult').checked, branchDefault:document.getElementById('includeBranch').checked,
    activeCount:[...D.universities].filter(allowed).length};
})()`;

async function main() {
  const chrome = findChrome();
  proc = spawn(chrome, ['--headless', '--disable-gpu', '--disable-background-networking', '--no-first-run',
    '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 300 && !fs.existsSync(portFile); i++) await wait(100);
  if (!fs.existsSync(portFile)) throw new Error('Chrome DevTools startup failed');
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const tabs = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const tab = tabs.find(t => t.type === 'page');
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map();
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id) { const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
    else if (m.method === 'Network.requestWillBeSent' && /^https?:/.test(m.params.request.url)) network.push(m.params.request.url);
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await send('Page.navigate', { url: pathToFileURL(path.join(ROOT, 'dist/china-university-atlas.html')).href });
  let ready = false;
  for (let i = 0; i < 300; i++) { await wait(100); if (await ev('!!window.__atlas')) { ready = true; break; } }
  if (!ready) throw new Error('Atlas did not boot');
  if (!await ev('typeof bestChip==="function" && typeof locationFor==="function" && !!WinnerCore')) {
    throw new Error('the page does not expose the V5.6 winner surface; rebuild with python scripts/build.py');
  }
  const page = await ev(COLLECT);

  /* --- compare ---------------------------------------------------------------------------- */
  const problems = [];
  const uiSeen = new Set();
  for (const u of page.units) {
      const key = [u.p || '', u.c || '', u.d || ''].join('|');
    const a = AUDIT.get(key);
    if (!a) { problems.push({ kind: 'missing_in_audit', unit: key, scope: u.scope, ui: u.uid || u.status }); continue; }
    if (uiSeen.has(key)) { problems.push({ kind: 'duplicate_ui_unit', unit: key, scope: u.scope }); continue; }
    uiSeen.add(key);
    if (a.scope !== u.scope) problems.push({ kind: 'scope_mismatch', unit: key, audit: a.scope, ui: u.scope });
    if (a.uid !== u.uid) problems.push({ kind: 'winner_mismatch', unit: key, scope: u.scope, audit: { uid: a.uid, name: a.name, status: a.status }, ui: { uid: u.uid, name: u.u, status: u.status } });
    if (a.status !== u.status) problems.push({ kind: 'status_mismatch', unit: key, audit: a.status, ui: u.status });
    if (u.count !== a.poolCount) problems.push({ kind: 'pool_mismatch', unit: key, scope: u.scope, audit: a.poolCount, ui: u.count });
    // §12 / §18: the UI must not present a name when the audit says the unit is incomparable
    if (a.status === 'unresolved_incomparable') {
      if (u.uid || u.u) problems.push({ kind: 'ui_name_fallback', unit: key, ui: { uid: u.uid, name: u.u } });
      if (u.rawU !== '暂无可比最佳高校') problems.push({ kind: 'ui_unresolved_label', unit: key, rawU: u.rawU });
      if (!u.chip.includes('chip-unresolved')) problems.push({ kind: 'ui_unresolved_chip', unit: key, chip: u.chip });
    }
    // §12: a policy basis must be disclosed as policy, never dressed up as ranking evidence
    if (a.status === 'resolved_policy' && POLICY_BASES.includes(a.basis) && !u.chip.includes('chip-policy')) {
      problems.push({ kind: 'ui_policy_not_marked', unit: key, basis: a.basis, chip: u.chip });
    }
    /* §18 / §5: the position the report publishes for the winner must be the one the map shows,
     * character for character. These were built separately once (the report took the raw
     * `rankDisplay`, the map the labelled position), which let one row print '财经 17' while the
     * comparison it described used the 主榜参考 202 sitting in another column. */
    if (a.uid) {
      if (a.display && u.rankLabel !== a.display) {
        problems.push({ kind: 'ranking_display_mismatch', unit: key, audit: a.display, ui: u.rankLabel });
      }
      if (!a.display && u.rankLabel !== '暂无官方榜单可比名次：仅作候选展示') {
        problems.push({ kind: 'ranking_display_unpublished', unit: key, ui: u.rankLabel });
      }
    }
  }
  /* Phase 2: what the sidebar actually prints. A resolved unit must print its winner; an
   * unresolved unit must print 暂无可比最佳高校 and never a school name; a policy winner must be
   * chipped as policy. */
  if (page.rendered.length !== page.units.length) {
    problems.push({ kind: 'render_coverage_mismatch', note: 'rendered item count differs from decided unit count', rendered: page.rendered.length, units: page.units.length });
  }
  const renderedSeen = new Set();
  for (const it of page.rendered) {
    const key = [it.p, it.c, it.d].join('|');
    if (renderedSeen.has(key)) continue;
    renderedSeen.add(key);
    const a = AUDIT.get(key);
    if (!a) { problems.push({ kind: 'rendered_not_in_audit', unit: key, feature: it.feature }); continue; }
    if (a.status === 'unresolved_incomparable') {
      if (it.runi !== '暂无可比最佳高校') problems.push({ kind: 'sidebar_unresolved_text', unit: key, runi: it.runi });
      if (!it.chip.includes('chip-unresolved')) problems.push({ kind: 'sidebar_unresolved_chip', unit: key, chip: it.chip });
    } else if (a.name) {
      if (!it.runi.includes(a.name)) problems.push({ kind: 'sidebar_wrong_winner', unit: key, audit: a.name, runi: it.runi });
    } else if (a.status === 'no_candidate' && it.runi !== '高校数据待补') {
      problems.push({ kind: 'sidebar_no_candidate_text', unit: key, runi: it.runi });
    }
    if (a.status === 'resolved_policy' && POLICY_BASES.includes(a.basis) && !it.chip.includes('chip-policy')) {
      problems.push({ kind: 'sidebar_policy_not_marked', unit: key, basis: a.basis, chip: it.chip });
    }
  }

  // Units the audit publishes that the map renders nowhere. Only three shapes are legitimate:
  // a 直辖市 city roll-up (直辖市 are drawn as their districts at province level), a region the
  // boundary snapshot has no file for (a school's home city can exist in the registry without a
  // boundary - e.g. the 新疆生产建设兵团 county-level cities), and the country roll-up itself.
  // Everything else is a real audit/UI coverage gap and fails the test.
  const regionIndex = page.regionIndex, cache = new Set(page.cacheKeys);
  const DIRECT = new Set(['北京市', '天津市', '上海市', '重庆市']);
  const unrendered = [];
  for (const [key, a] of AUDIT) {
    if (!a.candidateCount || uiSeen.has(key)) continue;
    const [p, , d] = key.split('|');
    const id = regionIndex[key] || '';
    // A unit is structurally unrenderable only when the map has no board for it at all:
    // no boundary file behind its region node, or a 直辖市 city roll-up (直辖市 are drawn
    // as their districts at province level). Anything else is a real coverage gap.
    const noBoundary = !id || !cache.has(id);
    const structural = (a.scope === 'country')
      || (a.scope === 'province' && noBoundary)
      || (a.scope === 'city' && (noBoundary || DIRECT.has(p)))
      || (a.scope === 'district' && noBoundary && !d);
    if (!structural) problems.push({ kind: 'unrendered_audit_unit', unit: key, scope: a.scope, winner: a.name, status: a.status });
    unrendered.push({ unit: key, scope: a.scope, structural });
  }
  // country unit: the map has no country board, so parity is asserted against the page's own core
  const country = AUDIT.get('||');
  if (country) {
    if (page.country.uid !== country.uid) problems.push({ kind: 'winner_mismatch', unit: '||', scope: 'country', audit: { uid: country.uid, name: country.name }, ui: { uid: page.country.uid, name: page.country.name } });
    if (page.country.pool !== country.poolCount) problems.push({ kind: 'pool_mismatch', unit: '||', scope: 'country', audit: country.poolCount, ui: page.country.pool });
    if (page.activeCount !== country.poolCount) problems.push({ kind: 'pool_mismatch', unit: '||', scope: 'country', note: 'active school count', audit: country.poolCount, ui: page.activeCount });
  }

  const auditRow = [...AUDIT.values()];
  const checked = auditRow.filter(a => a.candidateCount).length;
  const auditResolved = auditRow.filter(a => a.candidateCount && a.uid).length;
  const auditUnresolved = auditRow.filter(a => a.candidateCount && a.status === 'unresolved_incomparable').length;
  const uiUnresolved = page.units.filter(u => u.status === 'unresolved_incomparable').length;
  /* Guard against a vacuous pass: an empty audit, an unrendered map or a broken comparison
   * would otherwise report zero problems for the wrong reason. */
  if (!checked) problems.push({ kind: 'vacuous_comparison', note: 'no audit unit carries candidates' });
  if (!page.units.length) problems.push({ kind: 'vacuous_comparison', note: 'the page rendered no unit' });
  if (!auditResolved) problems.push({ kind: 'vacuous_comparison', note: 'the audit resolved no winner' });
  if (!renderedSeen.size) problems.push({ kind: 'vacuous_comparison', note: 'the sidebar rendered no item' });
  if (uiUnresolved !== auditUnresolved) problems.push({ kind: 'unresolved_count_mismatch', audit: auditUnresolved, ui: uiUnresolved });

  const byKind = {};
  for (const p of problems) byKind[p.kind] = (byKind[p.kind] || 0) + 1;
  const result = {
    pass: problems.length === 0 && !network.length && !errors.length,
    offline: true, httpRequests: network, runtimeErrors: errors,
    auditUnitsWithCandidates: checked, auditResolvedWinners: auditResolved,
    uiUnitsRendered: page.units.length, matchedUnits: uiSeen.size,
    sidebarItemsRendered: page.rendered.length, sidebarItemsChecked: renderedSeen.size,
    adultExcludedByDefault: !page.adultDefault,
    unresolvedAuditUnits: auditUnresolved, unresolvedUiUnits: uiUnresolved,
    problemCount: problems.length, problemsByKind: byKind, problems: problems.slice(0, 60),
    unrenderedAuditUnits: unrendered.filter(u => u.structural).length,
    unrenderedDetail: unrendered.filter(u => u.structural).map(u => u.unit),
    artifact: 'reports/best-university-coverage.csv'
  };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  await send('Browser.close').catch(() => {});
  ws.close();
  if (!result.pass) throw new Error(`audit/UI parity failed: ${problems.length} problem(s) ${JSON.stringify(byKind)}`);
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => {
  if (ws) ws.close(); if (proc) proc.kill();
  /* Windows still holds the freshly killed Chrome's profile files for a moment after kill(), and
   * rmSync only swallows ENOENT - an EBUSY here throws inside the timer, which turns a passing test
   * into exit code 1. The scratch profile is under the OS temp dir; leaving it behind on a race is
   * not worth failing the build over. */
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* OS still holds it */ } }, 500);
});
