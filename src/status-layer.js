// V5.3 status layer: inactive/non-recruiting historical entities remain searchable for audit,
// but never participate in current province/city/district candidate ranking.
const universityHTMLV53Base=universityHTML;
allowed=function(u){return !!u&&u.rankingEligible!==false&&($('includeAdult').checked||u.level!=='成人');};
universityHTML=function(u){
  const base=universityHTMLV53Base(u);
  if(u?.rankingEligible!==false)return base;
  const label=esc(u.statusLabel||u.entityStatus||'不参与当前候选');
  const ev=u.statusEvidence?`<div class="statusnote"><b>${label}</b><br>${esc(u.statusEvidence)}${u.statusSourceUrl?`<br><a href="${esc(u.statusSourceUrl)}" target="_blank" rel="noopener noreferrer">状态依据（联网时查看） ↗</a>`:''}</div>`:`<div class="statusnote"><b>${label}</b></div>`;
  return base+ev;
};
