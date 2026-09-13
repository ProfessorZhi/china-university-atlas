// V5.3: one university entity has one host city for city-ranking purposes.
// Physical campuses remain visible at district level; city hover discloses two external tiers.
const CITY_DIRECT_REGIONS=new Set(['北京市','天津市','上海市','重庆市','香港特别行政区','澳门特别行政区']);
function regionNodeForFeature(f){return(D.regions||{})[String(f.id)]||null;}
function cityAffiliateKey(p,c){return p+'|'+c;}
function cityAffiliatesFor(p,c){return(D.cityAffiliates||{})[cityAffiliateKey(p,c)]||null;}
function hasCityAffiliates(a){return!!a&&((a.undergraduate||[]).length>0||(a.graduate||[]).length>0);}
function cityAffiliateBundle(f,node=current()){return node.kind==='province'?cityAffiliatesFor(node.p,f.name):null;}
function cityAffiliatesVisible(f,node=current()){return $('includeBranch').checked&&hasCityAffiliates(cityAffiliateBundle(f,node));}
function cityDisplayUniversity(f,b,node=current()){return(b.u||'')+(b.u&&cityAffiliatesVisible(f,node)?'＋':'');}
function provinceChildCityName(node,f){
  if(node.kind!=='province'||CITY_DIRECT_REGIONS.has(node.p))return'';
  const r=regionNodeForFeature(f);if(r&&r.p===node.p&&r.c&&!r.d)return r.c;
  if((D.provinceCities?.[node.p]||[]).includes(f.name))return f.name;
  if(cityAffiliatesFor(node.p,f.name))return f.name;
  if(f.level==='city')return f.name;
  return'';
}
function locationFor(f,node=current()){
  if(node.kind==='country')return{p:f.name,c:'',d:''};
  if(node.kind==='province'){
    const cityName=provinceChildCityName(node,f);if(cityName)return{p:node.p,c:cityName,d:''};
    const r=regionNodeForFeature(f);if(r&&r.p===node.p)return{p:r.p,c:r.c||'',d:r.d||''};
    if(CITY_DIRECT_REGIONS.has(node.p))return{p:node.p,c:cityForDistrict(node.p,f.name),d:f.name};
    return{p:node.p,c:f.name,d:f.name};
  }
  return{p:node.p,c:node.c,d:node.kind==='district'?node.d:f.name};
}
function enter(f){
  if(S.loading)return;if(!f.name||f.id==='0'||f.id.includes('JD'))return;const v=current();
  if(v.loadError){delete v.loadError;renderView();return;}if(v.kind==='district'){toast(f.name+' 已是当前最细地图层级');return;}if(v.noChildren){toast('当前数据源没有该地区进一步细分边界');return;}
  const l=locationFor(f,v),provinceCity=!!provinceChildCityName(v,f);let kind=v.kind==='country'?'province':(provinceCity||v.kind==='province'&&f.level==='city'&&!l.d?'city':'district');const noChildren=kind==='city'&&!f.n&&!CACHE[String(f.id)];
  S.stack.push({id:f.id,name:f.name,kind,...l,f,noChildren});renderView();
}
function localCityRows(p,c){return(UIX.get(keyOf(p,c))||[]).filter(allowed).map(u=>({...u,campuses:[],associations:[],branch:false})).sort(compareU);}
function schoolRows(p,c='',d=''){
  if(c&&!d)return localCityRows(p,c);
  const map=new Map(),cr=campusRows(p,c,d),ar=associationRows(p,c,d);
  for(const u of UIX.get(keyOf(p,c,d))||[])if(allowed(u))map.set(u.id,{...u,campuses:[],associations:[],branch:false});
  for(const r of cr){const u=UM.get(r.uid);if(!u)continue;if(!map.has(u.id))map.set(u.id,{...u,campuses:[],associations:[],branch:!!d&&(u.p!==p||u.c!==c)});map.get(u.id).campuses.push(r);}
  for(const a of ar){const u=UM.get(a.uid);if(!u)continue;if(!map.has(u.id))map.set(u.id,{...u,campuses:[],associations:[],branch:false});map.get(u.id).associations.push(a);}
  const rows=[...map.values()];return rows.sort((a,b)=>d?((b.campuses.length>0)-(a.campuses.length>0)||compareU(a,b)):compareU(a,b));
}
// V5.6: who is "best" is decided once, in src/winner-core.js, and reported by
// scripts/generate_best_university_coverage.mjs from the same function. The map never
// invents a winner: an unresolved unit shows 暂无可比最佳高校 and lists its candidates.
function winnerFields(d,rs,extra){
  const u=d.winner;
  return {
    u:u?u.u:'',rawU:u?u.u:(rs.length?'暂无可比最佳高校':''),uid:u?u.id:'',level:u?u.level:'',winner:u,
    status:d.status,basis:d.decisionBasis,detail:d.decisionDetail,
    unresolvedReason:d.unresolvedReason,candidates:(d.topEntries||[]).map(x=>WinnerCore.unwrap(x).u),
    sample:false,count:rs.length,...(extra||{})
  };
}
// Chips say *why* a school is the current winner. A policy basis is labelled as policy so
// the map never presents 公办优先 / 本科>专科 as if ranking evidence had decided it.
/* Four different situations all end in the same sentence, and they are not the same statement: a
   unit whose leading candidates carry no official position at all is a different case from one whose
   candidates sit on two separately published scales. The school line under the name already prints
   暂无可比最佳高校, so the chip next to the name carries the *class* of the block instead of echoing
   the verdict. The chip's own text is free to change; its class is not - the parity gate reads
   chip-unresolved as the machine-readable mark that the map withheld a winner. */
const UNRESOLVED_CHIP={
  unresolved_incomparable_no_ranking:'无榜单名次',
  unresolved_incomparable_cross_system:'榜单不可比',
  unresolved_incomparable_band:'区间内并列',
  unresolved_incomparable_equal_rank:'名次相同'
};
function bestChip(b){
  if(!b||!b.u)return b&&b.status==='unresolved_incomparable'?`<span class="chip chip-unresolved">${esc(UNRESOLVED_CHIP[b.unresolvedReason]||'暂无可比')}</span>`:'';
  if(b.basis==='public_before_private'||b.basis==='level_order'||b.basis==='campus_precedence'||b.basis==='single_ranked_candidate')return '<span class="chip chip-policy">按项目规则</span>';
  if(b.basis==='single_candidate')return '<span class="chip">唯一候选</span>';
  return '';
}
function best(f,node=current()){
  const cityName=provinceChildCityName(node,f),l=cityName?{p:node.p,c:cityName,d:''}:locationFor(f,node),isP=node.kind==='country';
  if(cityName){
    const rs=localCityRows(l.p,l.c),extra=cityAffiliatesFor(l.p,l.c),d=WinnerCore.decideWinner(rs,{});
    if(d.winner){const u=d.winner;return winnerFields(d,rs,{cityAffiliates:extra,meta:[u.level,u.level==='专科'?'专科补位':'',rawRank(u),hasCityAffiliates(extra)?'有异地办学 · 悬浮查看':'本地主体高校'].filter(Boolean).join(' · ')});}
    return winnerFields(d,rs,{cityAffiliates:extra,meta:unresolvedMeta(d,rs,hasCityAffiliates(extra)?'本地主体高校尚未匹配 · 有异地办学信息':'本地主体高校尚未匹配')});
  }
  let rs,opts={};
  if(isP)rs=(UIX.get(keyOf(f.name))||[]).filter(allowed).slice().sort(compareU);
  else{
    rs=schoolRows(l.p,l.c,(node.kind==='city'&&node.noChildren)?'':l.d);
    if(l.d){const exact=rs.filter(x=>x.campuses?.length);if(exact.length&&exact.length<rs.length){rs=exact;opts.campusPreferred=true;}}
  }
  const d=WinnerCore.decideWinner(rs,opts);
  if(d.winner){const u=d.winner,cp=u.campuses?.[0],a=u.associations?.[0];return winnerFields(d,rs,{meta:[u.level,u.level==='专科'?'专科补位':'',rawRank(u),cp?quality(cp):a?'县区归属依据 · 非精确校区地址':'名录所在地'].filter(Boolean).join(' · '),sample:!!cp,campus:cp,uncertain:!!a||!!cp&&!cp.verified});}
  if(rs.length)return winnerFields(d,rs,{meta:unresolvedMeta(d,rs)});
  if(isP&&D.provinceBest[f.name])return{u:D.provinceBest[f.name],rawU:D.provinceBest[f.name],meta:'沿用参考标签；港澳台名录尚未系统纳入',count:0,sample:false,status:'reference_only'};
  return{u:'',rawU:'',meta:l.d?'尚无校区或县区归属证据；不代表当地没有高校':'当前口径未匹配本地主体高校；不代表当地没有高校',count:0,sample:false,status:'no_candidate'};
}
/* The row already prints 暂无可比最佳高校 twice - once in the chip, once as the school line - so
   this line carries only what those two cannot: how many candidates were in play and, from
   winner-core's own wording, why none of them could be separated. Reading d.candidates/d.detail here
   was reading fields decideWinner() never returns (it publishes topEntries/decisionDetail), so the
   reason never reached the UI and the line repeated the chip instead. */
/* winner-core names a comparison scale by the identifier its source publishes, and its own
   groupLabel() only rewrites the two source prefixes - the tail survives into the sidebar, so a row
   could read 软科 bcvcr-public-vocational-undergraduate. The table and the gloss live here, in the
   display layer, because that identifier is the audit's stable key: renaming it upstream would break
   the report-to-map join the parity gate checks, and the map is only ever a reader of it.
   The gloss is deliberately structural (公办·职业本科) rather than a claimed 榜名, so it restates what
   the identifier is made of instead of asserting a published title this project cannot cite. */
const GROUP_WORDS={bcur:'普通本科主榜',bcvcr:'高职院校榜',public:'公办',private:'民办',
  vocational:'职业',undergraduate:'本科',total:'总榜',art:'艺术',list:'榜'};
function humanGroup(s){
  return String(s??'').replace(/[A-Za-z][A-Za-z-]*[A-Za-z]/g,token=>{
    const parts=token.split('-').filter(Boolean);
    /* bcur / bcvcr name a whole scale on their own, so they are read as one word rather than joined
       to the qualifiers that follow. */
    if(parts.length===1)return GROUP_WORDS[parts[0].toLowerCase()]||parts[0];
    if(parts[0].toLowerCase()==='bcvcr')parts.shift();
    else if(parts[0].toLowerCase()==='bcur')parts[0]=GROUP_WORDS.bcur;
    /* 榜 / 总榜 read as suffixes, so they attach to the word they qualify instead of standing alone
       as 艺术·榜. */
    const out=[];
    for(const w of parts){const t=GROUP_WORDS[w.toLowerCase()]||w;
      if((t==='榜'||t==='总榜')&&out.length)out[out.length-1]+=t;else out.push(t);}
    return out.join('·');
  });
}
function unresolvedMeta(d,rs,fallback){
  if(!rs||!rs.length)return fallback||'暂无可比最佳高校';
  const detail=humanGroup((d&&d.decisionDetail)||'');
  return [`候选 ${rs.length} 所`,detail].filter(Boolean).join(' · ');
}
function affiliateLines(a){const lines=[];if(a?.undergraduate?.length)lines.push({label:'本科校区 / 分校',items:a.undergraduate});if(a?.graduate?.length)lines.push({label:'研究生院 / 研究院',items:a.graduate});return lines;}
function showTip(e,f){
  const b=best(f),t=$('tooltip'),main=b.rawU||b.u||'本地主体高校待补',bundle=cityAffiliatesVisible(f)?cityAffiliateBundle(f):null,tiers=affiliateLines(bundle);
  let html=`<strong>${esc(f.name)}</strong><div class="citymain">${esc(main)}</div><span class="tipmeta">${esc(b.meta)}</span>`;
  if(tiers.length)html+='<div class="citytiers">'+tiers.map(tier=>`<div><em>${esc(tier.label)}</em><span>（${tier.items.map(x=>esc(x.name)).join('、')}）</span></div>`).join('')+'</div>';
  t.innerHTML=html;t.style.display='block';const r=$('map').getBoundingClientRect();t.style.left=Math.max(5,Math.min(r.width-t.offsetWidth-8,e.clientX-r.left+15))+'px';t.style.top=Math.max(7,Math.min(r.height-t.offsetHeight-8,e.clientY-r.top+15))+'px';highlight(f.id);
}
/* ===========================================================================
   V5.8 label engine.
   Two typographic layers, one label group per region:
     L1 行政区名   - smaller, medium weight, desaturated blue-grey, no emphasis
     L2 最佳高校名 - full size, bold, the single accent colour
   The group is placed as one unit, so a region can never be separated from its
   university name, and no two groups may touch.  Placement order is explicit:

     level   province 0  >  city 1  >  district 2  >  unnamed 9
     then    a unit with a winner outranks one without
     then    larger area first

   A label that will not fit is degraded, never shrunk into illegibility:
     full group  ->  region name only  ->  hidden.
   =========================================================================== */
const LABEL_TYPO={region:{color:MAP_STYLE.label.region,weight:500,ratio:.86},uni:{color:MAP_STYLE.label.uni,weight:700,ratio:1}};
/* LABEL_GAP is a visual clearance, and it is deliberately not tuned down to 3 to buy room: the
   placement is a greedy packer, so shrinking the gap only reshuffles which unit wins the last free
   rectangle - 3px cost 山东 its 山东大学 at 1440 without placing a single extra label on a phone. */
const LABEL_LH=1.22,LABEL_PAD=4,LABEL_PADY=2,LABEL_EDGE=6,LABEL_GAP=4,MIN_LABEL_FONT=9.6;
const LEVEL_RANK={province:0,city:1,district:2};
const CJK_RE=/[⺀-鿿　-〿＀-￯㐀-䶿]/;
/* Structural words in an institution name. A line break inside one of these reads as a typo, not as
   a line break, and the previous version of this wrapper produced exactly that: it balanced the
   target width to (total/n)*1.04 and then filled greedily, so 浙江工商大学杭州商学院 got a target of
   5.72 glyphs - narrower than its own first word (浙江工商大学, 6 glyphs) - and 大学 was cut in half.
   Longest match wins, so 职业技术学院 beats 技术学院 beats 学院. The list is deliberately limited to
   school-name morphology; administrative terms are left to the plain per-character rule. */
const PROTECTED_WORDS=['职业技术大学','职业技术学院','职业技术学校','职业大学','职业学院','技术学院','技术大学','师范大学','理工大学','科技大学','工业大学','农业大学','医科大学','财经大学','交通大学','民族大学','外国语大学','外国语学院','政法大学','传媒大学','艺术学院','体育学院','商学院','管理学院','医学院','师范学院','大学','学院','学校'];
/* Break opportunities: one per CJK character, except that a protected word is one atomic token and
   may never be cut. Latin runs stay whole so a name never splits mid-word. */
function textTokens(s){
  const out=[];let buf='';
  const flush=()=>{if(buf){out.push(buf);buf='';}};
  for(let i=0;i<s.length;){
    let hit=null;
    if(CJK_RE.test(s[i]))for(const w of PROTECTED_WORDS)if(s.startsWith(w,i)){hit=w;break;}
    if(hit){flush();out.push(hit);i+=hit.length;continue;}
    const ch=s[i];i++;
    if(CJK_RE.test(ch)){flush();out.push(ch);}
    else if(ch===' '||ch==='　'||ch==='·'||ch==='-'||ch==='/'){buf+=ch;flush();}
    else buf+=ch;
  }
  flush();
  return out;
}
/* Minimum-raggedness line breaking over atomic tokens, so a protected word is never cut and the cut
   points are token boundaries by construction. For each line count k, smallest first, the cheapest
   arrangement of exactly k lines is found; the cost is the sum of squared deviation from the balanced
   target, which is what keeps 内蒙古自治区 at 3+3 rather than 5+1 and makes a single hanging glyph
   expensive without a special case. The first k that fits is the answer, so line count is minimised
   first and the balance only decides among layouts that already use that many lines. */
function breakTokens(tokens,fs,weight,maxWidth,m){
  const n=tokens.length,W=tokens.map(t=>m(t,fs,weight));
  const pre=[0];for(let i=0;i<n;i++)pre.push(pre[i]+W[i]);
  /* The table is rebuilt per k and the target is that k's target for every line in the pass. It has to
     be: a table carried over from the k-1 pass holds costs accumulated against the *previous* target,
     and mixing the two makes a 7-glyph first line look cheaper than the 6-glyph one that actually
     balances - which is how 浙江工商大学杭州商学院 came out as 浙江工商大学杭 / 州商学院. */
  for(let k=1;k<=n;k++){
    const target=Math.min(maxWidth,(pre[n]/k)*1.04);
    const best=[];for(let q=0;q<=k;q++)best.push(new Array(n+1).fill(null));
    best[0][0]={cost:0,parts:[]};
    for(let q=1;q<=k;q++)for(let i=0;i<n;i++){
      const cur=best[q-1][i];if(!cur)continue;
      for(let j=i+1;j<=n;j++){
        const w=pre[j]-pre[i];if(w>maxWidth)break;
        const c=cur.cost+(target-w)*(target-w),ex=best[q][j];
        if(!ex||c<ex.cost)best[q][j]={cost:c,parts:cur.parts.concat([tokens.slice(i,j).join('')])};
      }
    }
    if(best[k][n])return best[k][n].parts;
  }
  return[];
}
/* Wrap to a measured width. The measure is a parameter so the line breaker can be tested with a
   synthetic metric - on a machine with no CJK font every real measurement is a tofu box, and a guard
   that only holds for one machine's fonts is not a guard. */
function wrapText(s,maxWidth,fs,weight,m=textWidth){
  const clean=String(s||'').trim();if(!clean||maxWidth<=0)return[];
  if(m(clean,fs,weight)<=maxWidth)return[clean];
  let tokens=textTokens(clean),lines=breakTokens(tokens,fs,weight,maxWidth,m);
  if(!lines.length){
    /* Unwrappable: one atomic token is wider than the whole budget. Cutting it would split exactly
       the word this function exists to protect, so the caller is told to drop the name and the unit
       degrades to its region name - §24's trade, and the better one. A long Latin run is the other
       case: it has no lemma to protect, so it is broken down to characters and retried, which is
       what the previous version did for everything. */
    let wi=0;for(let i=1;i<tokens.length;i++)if(m(tokens[i],fs,weight)>m(tokens[wi],fs,weight))wi=i;
    if(PROTECTED_WORDS.includes(tokens[wi]))return[];
    tokens=tokens.slice(0,wi).concat([...tokens[wi]],tokens.slice(wi+1));
    lines=breakTokens(tokens,fs,weight,maxWidth,m);
    if(!lines.length)return[];
  }
  /* 禁则 (kinsoku). Chinese breaks freely between Han characters, but a line must not *open* with a
     closing mark and must not *close* with an opening one. The repair is to move the offending mark
     across the break; the previous line grows by one glyph, which is the trade 禁则 asks for. It can
     only move punctuation, and no protected word contains punctuation, so it cannot re-split a word.
     Without this, 香港中文大学（深圳） could break after （ and open the next line with ）. */
  const OPEN_MARKS=[...'（「『【《〈“‘'],CLOSE_MARKS=[...'，。、；：！？）」』】》〉”’…'];
  for(let i=1;i<lines.length;i++){
    const a=[...lines[i-1]],b=[...lines[i]];
    while(b.length>1&&CLOSE_MARKS.includes(b[0]))a.push(b.shift());
    while(a.length>1&&OPEN_MARKS.includes(a[a.length-1]))b.unshift(a.pop());
    lines[i-1]=a.join('');lines[i]=b.join('');
  }
  return lines;
}
/* The chrome that a label must never sit under: the map heading, the control stack, the legend,
   the mode badge and the inset.  Measured from the live DOM, so it follows the responsive layout
   instead of guessing pixel constants. */
function labelExclusions(){
  const mapRect=$('map').getBoundingClientRect(),out=[];
  for(const sel of ['.maphead','.mapcontrols','.legend','.modebadge']){
    for(const el of document.querySelectorAll(sel)){
      if(!el.getClientRects().length)continue;const r=el.getBoundingClientRect();
      out.push({l:r.left-mapRect.left-4,r:r.right-mapRect.left+4,t:r.top-mapRect.top-4,b:r.bottom-mapRect.top+4});
    }
  }
  if(S.insetBox)out.push(S.insetBox);
  return out;
}
/* -3..3 steps, not -2..2: on a phone the two steps were not enough to reach the open water beside
   a cramped province, so the name was dropped instead of moved.  The search stays cheap because the
   ordering is computed once and the caller breaks out at the first tier-1 hit. */
function labelOffsets(w,h){
  const sx=w/2+7,sy=h+5,out=[];
  for(const ky of[0,-1,1,-2,2,-3,3])for(const kx of[0,-1,1,-2,2,-3,3])out.push([kx*sx,ky*sy]);
  out.sort((a,b)=>(a[0]*a[0]*1.15+a[1]*a[1])-(b[0]*b[0]*1.15+b[1]*b[1]));
  return out;
}
function ringBox(r){let lo=[Infinity,Infinity],hi=[-Infinity,-Infinity];for(const p of r){if(p[0]<lo[0])lo[0]=p[0];if(p[1]<lo[1])lo[1]=p[1];if(p[0]>hi[0])hi[0]=p[0];if(p[1]>hi[1])hi[1]=p[1];}return[lo,hi];}
function drawLabels(){
  const g=$('labelLayer');g.innerHTML='';
  const node=current(),nation=node.kind==='country',showUni=$('showUni').checked,avoid=$('avoid').checked;
  const all=S.base.filter(b=>b.f.name).map(b=>{
    const rbox=b.rings.map(ringBox);let lo=[Infinity,Infinity],hi=[-Infinity,-Infinity];
    for(const bx of rbox){if(bx[0][0]<lo[0])lo[0]=bx[0][0];if(bx[0][1]<lo[1])lo[1]=bx[0][1];if(bx[1][0]>hi[0])hi[0]=bx[1][0];if(bx[1][1]>hi[1])hi[1]=bx[1][1];}
    return{...b,best:best(b.f),rbox,bbox:[lo,hi]};
  });
  /* Placement order is not the same as display order.  The labels that are hardest to fit are
     placed first - a province name that cannot be placed leaves a hole in the map, while a large
     province whose label is nudged 20px is still perfectly readable.  So: level first (a province
     name always outranks a district name), then smallest area first, then shortest name. */
  const items=all.slice().sort((a,b)=>(LEVEL_RANK[a.f.level]??8)-(LEVEL_RANK[b.f.level]??8)||a.area-b.area||a.f.name.length-b.f.name.length);
  /* The units that go into stage 1, smallest area first.  That is the order pass 1 has always used
     and it is also the one that packs best: a small unit has nowhere else to go, while a large one
     can still be labelled after its neighbours because it has room inside itself.  Ordering this
     list by size descending - what the old upgrade pass did - answered "which university" for 新疆
     and 西藏 while staying silent on 北京 and 上海.  Ordering it by the winner's prestige instead
     (985 before 211 before the rest) was tried and reverted: it groups the units into tiers and
     re-creates the same greedy-packing failure inside each tier, costing 河南 its 郑州大学 at 1440. */
  const upgrades=all.filter(b=>b.best.u).sort((a,b)=>a.area-b.area);
  const density=items.length<=3?1.26:items.length<=8?1.11:1;
  /* Type size has to answer to the drawing area as well as to the zoom.  Without the viewport term
     the same 12.8px glyph is ~1.1% of the map width at 1073px and ~3.4% at 376px, so on a phone
     every label is three times its proper size relative to the country - the western provinces fill
     the screen and 广东, 浙江, 山东 and 安徽 fall off it entirely.  The factor is clamped so the
     desktop answer is untouched and the phone only gives up as much type as it must. */
  const vp=Math.min(1,Math.max(.86,S.w/1073));
  const base=Math.max(11.2,Math.min(26,(nation?12.8:13.6)*Number($('fontSize').value)/100*Math.pow(S.z,.34)*density*vp));
  const nameMax=nation?5.4:7,uniMax=nation?7.2:9.2;
  const ui=labelExclusions(),accepted=ui.slice(),placed=new Map();
  let hidden=0,minPlaced=Infinity;

  /* Geographic honesty.  A label is placed inside the region it names whenever that is possible.
     If the region is too small to hold its own name (北京, 香港 and 澳门 are a few pixels across on
     a national map) the label moves to open ground beside it - the sea or the area outside the
     country.  Only if neither exists may it be pushed into a neighbouring region, and then the
     displacement is capped by the region's own size and a leader line ties it back to the anchor,
     so a reader can still see which name belongs to which shape. */
  function inside(item,mx,my){
    for(let i=0;i<item.rings.length;i++){const bx=item.rbox[i];
      if(mx<bx[0][0]||mx>bx[1][0]||my<bx[0][1]||my>bx[1][1])continue;
      if(inRing([mx,my],item.rings[i]))return true;}
    return false;
  }
  function inForeign(self,mx,my){
    for(const it of all){if(it===self)continue;const bb=it.bbox;
      if(mx<bb[0][0]||mx>bb[1][0]||my<bb[0][1]||my>bb[1][1])continue;
      if(inside(it,mx,my))return it;}
    return null;
  }
  function build(b,scale,withUni){
    const fsR=Math.max(MIN_LABEL_FONT,base*scale*LABEL_TYPO.region.ratio),fsU=Math.max(MIN_LABEL_FONT+0.8,base*scale);
    const lines=wrapText(nation?short(b.f.name):b.f.name,fsR*nameMax,fsR,LABEL_TYPO.region.weight)
      .map(t=>({t,fs:fsR,weight:LABEL_TYPO.region.weight,color:LABEL_TYPO.region.color,role:'region'}));
    const nameCount=lines.length;
    if(withUni&&showUni&&b.best.u){
      for(const t of wrapText(b.best.u,fsU*uniMax,fsU,LABEL_TYPO.uni.weight))
        lines.push({t,fs:fsU,weight:LABEL_TYPO.uni.weight,color:LABEL_TYPO.uni.color,role:'uni'});
    }
    if(!lines.length)return null;
    const width=Math.max(...lines.map(l=>textWidth(l.t,l.fs,l.weight)))+LABEL_PAD*2;
    const height=lines.reduce((s,l)=>s+l.fs*LABEL_LH,0)+LABEL_PADY*2;
    return{lines,nameCount,width,height};
  }
  function fits(box,skip){
    if(box.l<LABEL_EDGE||box.t<LABEL_EDGE||box.r>S.w-LABEL_EDGE||box.b>S.h-LABEL_EDGE)return false;
    if(!avoid)return true;
    for(let i=0;i<accepted.length;i++){if(i===skip)continue;const a=accepted[i];
      if(!(box.r+LABEL_GAP<a.l||box.l-LABEL_GAP>a.r||box.b+LABEL_GAP<a.t||box.t-LABEL_GAP>a.b))return false;}
    return true;
  }
  /* Returns {box,tier,dx,dy}: tier 1 = inside its own region, 2 = open ground, 3 = displaced into
     a neighbour (a leader line is then mandatory).  The best tier wins; ties go to the nearest. */
  function place(b,x,y,label,skip){
    const cap=Math.max(32,Math.min(.9*Math.sqrt(Math.max(b.area,1))*S.z,110));
    let best=null;
    for(const[dx,dy]of labelOffsets(label.width,label.height)){
      const dist=Math.hypot(dx,dy);
      const cx=x+dx,cy=y+dy,box={l:cx-label.width/2,r:cx+label.width/2,t:cy-label.height/2,b:cy+label.height/2};
      if(!fits(box,skip))continue;
      const mx=(cx-S.x)/S.z,my=(cy-S.y)/S.z;
      let tier=inside(b,mx,my)?1:(inForeign(b,mx,my)?3:2);
      if(tier===3){
        if(dist>cap)continue;
        if(best&&best.tier<3)continue;
        if(best&&best.tier===3&&best.dist<=dist)continue;
      }else{
        if(best&&best.tier<=tier&&best.dist<=dist)continue;
      }
      best={box,tier,dx,dy,dist};
      if(tier===1&&dist<=1)break;
    }
    return best;
  }
  const onScreen=b=>{const x=b.cp[0]*S.z+S.x,y=b.cp[1]*S.z+S.y;return !(x<-120||y<-120||x>S.w+120||y>S.h+120);};
  /* Two stages, and the order inside a stage is the whole algorithm:
       stage 1  every unit with a university to show, smallest area first -> the full two-line
                group, so its box is measured and placed at its final size;
       stage 2  everything still unplaced - units with no winner, plus any unit whose two-line
                group would not fit anywhere - -> the administrative name alone.
     The previous design placed 34 small name boxes first and then tried to grow 33 of them in an
     already-crowded field, which meant a unit received its answer only if a neighbour happened to
     leave a gap beside it: 湖北 lost 武汉大学 at 1440 while 西藏 kept 西藏大学, and the set of
     units that lost depended on how many pixels the window had.  Sizing the box before the space
     is spent removes that failure mode, and a unit that still cannot fit two lines keeps its name
     instead of vanishing from the map. */
  function stage(list,withUni){
    for(const b of list){
      if(placed.has(b.f.id)||!onScreen(b))continue;
      const x=b.cp[0]*S.z+S.x,y=b.cp[1]*S.z+S.y;
      for(const scale of[1,.93,.86,.79]){
        const label=build(b,scale,withUni);
        if(!label)break;
        if(withUni&&label.lines.length<=label.nameCount)break;
        const hit=place(b,x,y,label,-1);
        if(!hit)continue;
        accepted.push(hit.box);
        placed.set(b.f.id,{b,label,box:hit.box,tier:hit.tier,dx:hit.dx,dy:hit.dy,slot:accepted.length-1,onlyName:!withUni});
        break;
      }
    }
  }
  stage(upgrades,true);
  stage(items,false);
  for(const b of items)if(onScreen(b)&&!placed.has(b.f.id))hidden++;
  let shown=0,nameOnly=0,uniLines=0,leaders=0,displaced=0;
  S.labels=[];
  for(const rec of placed.values()){
    const b=rec.b,label=rec.label,box=rec.box;shown++;
    if(rec.onlyName)nameOnly++;
    minPlaced=Math.min(minPlaced,...label.lines.map(l=>l.fs));
    const x=b.cp[0]*S.z+S.x,y=b.cp[1]*S.z+S.y;
    const cx=(box.l+box.r)/2,cy=box.t+LABEL_PADY+label.lines.reduce((s,l)=>s+l.fs*LABEL_LH,0)/2;
    const dist=Math.hypot(cx-x,cy-y);
    // A leader line is mandatory whenever the label is not sitting on its own anchor: either it
    // was displaced far enough that the eye needs help, or it could not be placed inside its own
    // region at all.  Without one, a reader would assign the name to the wrong shape.
    const needLeader=rec.tier===3||dist>Math.max(12,label.height*.55);
    const group=E('g',{'data-label-id':b.f.id,'data-label-level':b.f.level||'island','data-name-only':rec.onlyName?'1':'0','data-place-tier':String(rec.tier||1)});
    if(needLeader){
      /* Full opacity, 1px, and vector-effect so zoom cannot thin it back into a smudge. The .6px/50%
         original was below the point where a line reads as a line, and the mislabel exemption below
         leans on it being followed by the eye. */
      group.append(E('line',{class:'leader',x1:x.toFixed(2),y1:y.toFixed(2),x2:cx.toFixed(2),y2:cy.toFixed(2),stroke:MAP_STYLE.label.leader,'stroke-width':1,'opacity':1,'vector-effect':'non-scaling-stroke'}));
      group.append(E('circle',{class:'leader',cx:x.toFixed(2),cy:y.toFixed(2),r:1.8,fill:MAP_STYLE.label.leader,opacity:1}));
      leaders++;if(rec.tier===3)displaced++;
    }
    let top=box.t+LABEL_PADY;
    for(const l of label.lines){
      const lh=l.fs*LABEL_LH;
      // The halo is proportional to the glyph, never a fixed width: a white outline fatter than
      // the stroke it protects fills the counters of small Chinese characters and turns the map
      // background white.  0.11em, capped at 2px, keeps small labels crisp.
      group.append(E('text',{x:cx.toFixed(2),y:(top+lh*.82).toFixed(2),'text-anchor':'middle','font-size':l.fs.toFixed(2),'font-weight':l.weight,'font-family':FONT_STACK,fill:l.color,stroke:MAP_STYLE.label.halo,'stroke-width':Math.min(2,Math.max(1,l.fs*.11)).toFixed(2),'stroke-linejoin':'round','paint-order':'stroke fill','data-role':l.role},l.t));
      top+=lh;
      if(l.role==='uni')uniLines++;
    }
    g.append(group);
    S.labels.push({l:box.l,t:box.t,r:box.r,b:box.b,id:b.f.id,level:b.f.level,nameOnly:rec.onlyName,anchor:[x,y],tier:rec.tier||1,leader:needLeader});
  }
  /* The campus pins are the only map layer whose meaning is carried entirely by a fill colour, and
     nothing on screen said what the two colours were. The key lives in the legend and is shown only
     when the layer is: a key for a layer with nothing in it is worse than no key, and the pins exist
     only at the district level. */
  const pins=current().kind==='district'?drawCampusPins(g):0;
  const pinKey=document.querySelector('.legendpins');
  if(pinKey)pinKey.hidden=!pins;
  S.labelCount=shown;S.nameOnlyLabelCount=nameOnly;
  S.labelStats={shown,hidden,nameOnly,uniLabels:uniLines,leaders,displaced,candidates:items.length,
    minFont:Number.isFinite(minPlaced)?Number(minPlaced.toFixed(2)):null,uiExclusions:ui.length};
}

/* ===========================================================================
   V5.8 touch tooltip.
   The tooltip carries the two-tier 异地办学 detail that no other surface shows, and it was wired to
   pointermove only - a phone has no hover, so the information was simply unreachable there. A long
   press (450ms without moving) opens it instead, and the tap that follows is swallowed so the reader
   can look at the tooltip without also navigating into the region. The pointerup listener runs in the
   capture phase, so it clears tapFeature before app.js's own bubble-phase endPointer() reads it.
   =========================================================================== */
const TIP_PRESS_MS=450;
let tipTimer=null,tipShown=false;
function featureUnder(e){
  const el=e.target&&e.target.closest?e.target.closest('[data-i]'):null;
  return el&&S.geo?S.geo[Number(el.dataset.i)]:null;
}
$('map').addEventListener('pointerdown',e=>{
  if(e.pointerType==='mouse'||e.button!==0)return;
  const f=featureUnder(e);
  if(!f)return;
  clearTimeout(tipTimer);
  tipTimer=setTimeout(()=>{tipTimer=null;tipShown=true;showTip(e,f);},TIP_PRESS_MS);
});
$('map').addEventListener('pointermove',()=>{if(tipTimer){clearTimeout(tipTimer);tipTimer=null;}});
$('map').addEventListener('pointercancel',()=>{clearTimeout(tipTimer);tipTimer=null;tipShown=false;},{capture:true});
$('map').addEventListener('pointerup',()=>{
  clearTimeout(tipTimer);tipTimer=null;
  if(!tipShown)return;
  tipShown=false;
  tapFeature=null;
},{capture:true});
