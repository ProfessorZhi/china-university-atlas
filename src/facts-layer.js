// V5.3 institution facts layer: ranking editions live in data, not hard-coded UI logic.
const universityHTMLFactsBase=universityHTML;
priority=function(u){
  const x=u?.mapPriority;
  if(Array.isArray(x)&&x.length)return x;
  return [u?.level==='本科'?0:u?.level==='专科'?1:2,(u?.tags||[]).includes('985')?0:(u?.tags||[]).includes('211')?1:(u?.tags||[]).includes('双一流')?2:3,Number.isFinite(Number(u?.rank))?Number(u.rank):999999,u?.private?1:0];
};
compareU=function(a,b){
  a=UM.get(a?.uid)||a;b=UM.get(b?.uid)||b;const x=priority(a),y=priority(b),n=Math.max(x.length,y.length);
  for(let i=0;i<n;i++){const xv=x[i]??999999,yv=y[i]??999999;if(xv!==yv)return xv-yv;}
  return String(a?.u||'').localeCompare(String(b?.u||''),'zh-CN');
};
rawRank=function(u){return u?.preferredRank?.label||'暂无可比排名快照：仅作候选展示';};
function rankingFactsHTML(u){
  const latest=u?.latestRankings||{},rows=Object.values(latest).filter(Boolean);
  if(!rows.length)return '<div class="factnote">暂无标准化外部榜单记录；地图仍可使用教育部层次、政策标签及迁移中的2026软科快照作为排序兜底。</div>';
  rows.sort((a,b)=>String(a.rankingId).localeCompare(String(b.rankingId)));
  return '<div class="facttable">'+rows.map(r=>{
    const rank=r.rankDisplay||r.rank||'',ref=r.referenceRank?` · 主榜参考 ${esc(r.referenceRank)}`:'',score=Number.isFinite(Number(r.score))?` · 分数 ${esc(r.score)}`:'';
    return `<p><b>${esc(r.agency||'榜单')}</b> · ${esc(r.rankingName||r.rankingId)} ${esc(r.edition||'')}：${esc(rank)}${ref}${score}${r.sourceUrl?` <a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener noreferrer">来源 ↗</a>`:''}</p>`;
  }).join('')+'</div>';
}
universityHTML=function(u){
  const base=universityHTMLFactsBase(u),ad=u?.admissionFactCount||0,fin=u?.financeFactCount||0;
  return base+`<details class="institutionfacts"><summary>排名 / 招生 / 财务数据</summary><p><b>地图当前排序参考：</b>${esc(rawRank(u))}</p>${rankingFactsHTML(u)}<p>录取事实：${ad} 条${u?.latestAdmissionYear?' · 最新 '+esc(u.latestAdmissionYear):''}；财务事实：${fin} 条${u?.latestFinanceYear?' · 最新 '+esc(u.latestFinanceYear):''}。</p><p class="factnote">录取线按年份、省份、选科/科类、批次和专业保存；预算与决算分口径保存。缺失不按零分处理。</p></details>`;
};
