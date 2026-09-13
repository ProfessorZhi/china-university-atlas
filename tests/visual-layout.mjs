// V5.8 visual layout test: screenshots every route in the acceptance matrix and asserts real
// geometry - measured on the rendered page, not on the numbers the layout code believes it used.
//
// Dependency-free: Chrome DevTools Protocol only (Node.js 22+), same harness as tests/browser.mjs.
// Offline: the page is loaded over file:// with the network emulated offline, and any http(s)
// request is reported as a failure.
//
//   node tests/visual-layout.mjs            # screenshots + geometry assertions
//   SHOTS=0 node tests/visual-layout.mjs    # geometry only (no PNG writes)
//
// Output: reports/visual-layout.json, reports/visual/v5.8-visual-audit.json, reports/visual/*.png
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawn,execFileSync} from 'node:child_process';import {pathToFileURL,fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),shotDir=path.join(ROOT,'reports','visual');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'university-atlas-visual-'));
const errors=[],network=[],wait=ms=>new Promise(r=>setTimeout(r,ms));let proc,ws;
/* The test's own list of Chinese name components that must never be broken across a line. It is
 * deliberately NOT read from PROTECTED_WORDS in the page: a test that imports the implementation's
 * own list cannot catch the list being shortened, which is exactly how 浙江工商大学杭州商学院 started
 * being split. Both checks that use it - the rendered one in MEASURE and the synthetic one in
 * WRAP_GUARD - are driven by this single literal. */
const BOUND_WORDS="['职业技术大学','职业技术学院','职业技术学校','职业大学','职业学院','技术学院','技术大学','师范大学','理工大学','科技大学','工业大学','农业大学','医科大学','财经大学','交通大学','民族大学','外国语大学','外国语学院','政法大学','传媒大学','艺术学院','体育学院','商学院','管理学院','医学院','师范学院','大学','学院','学校']";
/* The acceptance matrix.  `id` is a region id from the embedded geometry, `label` names the route. */
const MATRIX=[
  {w:1440,h:900,mobile:false,id:'100000',label:'全国',slug:'nation'},
  {w:1440,h:900,mobile:false,id:'330000',label:'浙江省',slug:'zhejiang'},
  {w:1440,h:900,mobile:false,id:'330100',label:'杭州市',slug:'hangzhou'},
  {w:1440,h:900,mobile:false,id:'330106',label:'西湖区',slug:'xihu'},
  {w:1440,h:900,mobile:false,id:'440000',label:'广东省',slug:'guangdong'},
  {w:1440,h:900,mobile:false,id:'440300',label:'深圳市',slug:'shenzhen'},
  {w:1440,h:900,mobile:false,id:'110000',label:'北京市',slug:'beijing'},
  {w:1440,h:900,mobile:false,id:'310000',label:'上海市',slug:'shanghai'},
  {w:1280,h:800,mobile:false,id:'100000',label:'全国',slug:'nation'},
  {w:1280,h:800,mobile:false,id:'440000',label:'广东省',slug:'guangdong'},
  {w:430,h:932,mobile:true,id:'100000',label:'全国',slug:'nation'},
  {w:430,h:932,mobile:true,id:'330000',label:'浙江省',slug:'zhejiang'},
  {w:430,h:932,mobile:true,id:'440300',label:'深圳市',slug:'shenzhen'},
  {w:390,h:844,mobile:true,id:'100000',label:'全国',slug:'nation'}
];
/* Everything below runs inside the page.  It measures the *rendered* geometry (getBoundingClientRect
 * on the real label groups, so stroke and paint-order are included) and compares it against the
 * visible map rectangle and the UI chrome that must never be covered by a label. */
const MEASURE=`(() => {
  const map=document.getElementById('map'),mapRect=map.getBoundingClientRect();
  const groups=[...document.querySelectorAll('#labelLayer g[data-label-id]')];
  const boxOf=el=>{const r=el.getBoundingClientRect();return{l:r.left,t:r.top,r:r.right,b:r.bottom,w:r.width,h:r.height};};
  const labels=groups.map(g=>{const texts=[...g.querySelectorAll('text')];const r=texts.map(boxOf);return{
    id:g.getAttribute('data-label-id'),
    text:texts.map(t=>t.textContent).join(' '),
    fs:texts.map(t=>Number(t.getAttribute('font-size'))),
    stroke:texts.map(t=>Number(t.getAttribute('stroke-width'))),
    weight:texts.map(t=>t.getAttribute('font-weight')),
    leader:!!g.querySelector('.leader'),tier:Number(g.getAttribute('data-place-tier')||1),
    /* How the leader actually renders, not whether it exists. See leaderIllegible below. */
    leaderInk:(function(){var L=g.querySelector('line.leader');if(!L)return null;
      var cs=getComputedStyle(L),op=Number(cs.opacity),w=parseFloat(cs.strokeWidth);
      var nums=function(s){return (s.match(/[0-9.]+/g)||[]).map(Number).slice(0,3);};
      var lin=function(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};
      var lum=function(c){return 0.2126*lin(c[0])+0.7152*lin(c[1])+0.0722*lin(c[2]);};
      var cr=function(a,b){var A=lum(a),B=lum(b),hi=A>B?A:B,lo=A>B?B:A;return (hi+0.05)/(lo+0.05);};
      var fg=nums(cs.stroke);
      if(fg.length<3)return {w:w,op:op,minContrast:null};
      /* Worst case over the palette: the fill the line is least unlike once its alpha is applied.
         A leader is drawn across unknown ground, so the least favourable ground is the honest one. */
      var min=99;for(var i=0;i<palette.length;i++){var bg=nums('rgb('+[parseInt(palette[i].slice(1,3),16),parseInt(palette[i].slice(3,5),16),parseInt(palette[i].slice(5,7),16)].join(',')+')');
        var mix=fg.map(function(v,j){return v*op+bg[j]*(1-op);});
        min=Math.min(min,cr(mix,bg));}
      return {w:w,op:op,minContrast:min};})(),
    l:Math.min(...r.map(x=>x.l)),t:Math.min(...r.map(x=>x.t)),
    r:Math.max(...r.map(x=>x.r)),b:Math.max(...r.map(x=>x.b))};});
  const ui=[...document.querySelectorAll('.maphead,.mapcontrols,.legend,.modebadge')]
    .filter(el=>el.getClientRects().length).map(el=>({sel:el.className.split(' ')[0],...boxOf(el)}));
  const inter=(a,b,pad=0)=>{const w=Math.min(a.r,b.r+pad)-Math.max(a.l,b.l-pad),h=Math.min(a.b,b.b+pad)-Math.max(a.t,b.t-pad);return w>0.5&&h>0.5?w*h:0;};
  const overlaps=[];for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){const a=inter(labels[i],labels[j]);if(a>0)overlaps.push({a:labels[i].text,b:labels[j].text,area:Math.round(a)});}
  const TOL=1.5;
  const clipped=labels.filter(x=>x.l<mapRect.left-TOL||x.t<mapRect.top-TOL||x.r>mapRect.right+TOL||x.b>mapRect.bottom+TOL)
    .map(x=>({text:x.text,out:[Math.round(mapRect.left-x.l),Math.round(mapRect.top-x.t),Math.round(x.r-mapRect.right),Math.round(x.b-mapRect.bottom)].join(',')}));
  /* The fitted box and the drawn geometry have to be the same box. The national fit has always
   * excluded everything south of 18N so the frame is not spent on the South China Sea - but the draw
   * kept painting those rings, so 海南省 ran 164 points past the bottom edge and the frame cut them
   * (a 南海诸岛 inset carries that information instead). No label check can see this: every label was
   * inside the frame, the *geometry* was not. Measured on the rendered rects, which ignore the SVG
   * clip, so anything the frame is cutting shows up here. display:none paths are skipped - they are
   * not drawn, so nothing can cut them. */
  const geoOutside=[];let geoPaths=0;
  const shapesRoot=document.getElementById('shapes');
  if(shapesRoot)for(const p of shapesRoot.querySelectorAll('path')){
    if(getComputedStyle(p).display==='none'||!p.getClientRects().length)continue;
    const r=p.getBoundingClientRect();if(!r.width&&!r.height)continue;geoPaths++;
    const o={l:mapRect.left-r.left,t:mapRect.top-r.top,r:r.right-mapRect.right,b:r.bottom-mapRect.bottom};
    if(o.l>TOL||o.t>TOL||o.r>TOL||o.b>TOL)
      geoOutside.push({id:p.getAttribute('data-id'),name:(p.getAttribute('aria-label')||'').split('，')[0],
        out:[Math.round(o.l),Math.round(o.t),Math.round(o.r),Math.round(o.b)].join(',')});
  }
  const collisions=[];for(const x of labels)for(const u of ui){const a=inter(x,u,-2);if(a>0)collisions.push({text:x.text,ui:u.sel,area:Math.round(a)});}
  const tiny=labels.filter(x=>x.fs.some(f=>f<9)).map(x=>x.text);
  /* Campus pins are the only clickable thing drawn under the labels. A label box over a pin does not
   * hide the dot - labels carry no background - but the hit circle is the layer's only
   * pointer-events:all element, so a covered pin is a pin the reader cannot open. Measured against
   * the hit circle, which is what actually receives the click, not the 3.8px dot drawn inside it. */
  const pinHits=[...document.querySelectorAll('#labelLayer .campuspin-hit')];
  const pinsCovered=[];
  for(const p of pinHits){const r=p.getBoundingClientRect(),cx=(r.left+r.right)/2,cy=(r.top+r.bottom)/2;
    for(const x of labels)if(cx>=x.l&&cx<=x.r&&cy>=x.t&&cy<=x.b){pinsCovered.push(Math.round(cx)+','+Math.round(cy));break;}}
  /* The halo must stay proportional to the glyph. city-layer.js caps it at min(2, max(1, fs*.11)), so
   * it can never exceed 2px and never exceeds 11% of the glyph. The check that used to sit here asked
   * "stroke &gt; max(2, fs*.16)", which no label could ever satisfy - 2 is already the ceiling - so it
   * published a permanent 0 and would not have noticed the cap being raised to a fat fixed outline.
   * This compares against the cap itself, which is the thing the comment was promising. */
  const haloCap=fs=>Math.min(2,Math.max(1,fs*0.11));
  const halo=labels.filter(x=>x.stroke.some((s,i)=>s>haloCap(x.fs[i])+0.02))
    .map(x=>({text:x.text,stroke:x.stroke,fs:x.fs,cap:x.fs.map(f=>+haloCap(f).toFixed(2))}));
  /* Geographic honesty: a label may not sit inside a region other than the one it names unless a
   * leader line ties it back to its own anchor.  Measured on the live geometry, in map space.
   *
   * Three cases are not mislabels, and each is a measurement artefact rather than a layout fault:
   *  - the centre is inside the region's own polygon (the ideal);
   *  - the centre is within 2px of the region's own bounding box *and* the region is small enough
   *    that the polygon test carries no information.  At 全国 scale 澳门 is 1.1 x 1.6 px and 上海
   *    16 x 18 px, so a label centre a fraction of a pixel outside a simplified boundary says nothing
   *    about the layout.  The exemption is bounded to those regions on purpose: a bounding box also
   *    contains the water and the neighbours inside a concave or archipelagic unit (浙江 with 舟山,
   *    广东 with its islands), so exempting every label that falls inside its own bbox let a label
   *    that had genuinely landed on a neighbour pass as placed.
   *  - the region is smaller than the label box, so the name cannot be contained at all.  Hiding it
   *    is the only alternative that keeps the centre inside, and §23/§24 prefer the visible name.
   * Anything else - a label whose centre is over a neighbour while its own region had room to hold
   * it - is a real mislabel unless a leader line ties the label back. */
  const mislabelled=[];
  if(typeof S!=='undefined'&&S.base&&S.z){
    const inRing=(pt,r)=>{let yes=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>pt[1])!==(b[1]>pt[1])&&pt[0]<(b[0]-a[0])*(pt[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
    const boxes=S.base.filter(b=>b.f.name).map(b=>{let lo=[Infinity,Infinity],hi=[-Infinity,-Infinity];
      for(const r of b.rings)for(const p of r){if(p[0]<lo[0])lo[0]=p[0];if(p[1]<lo[1])lo[1]=p[1];if(p[0]>hi[0])hi[0]=p[0];if(p[1]>hi[1])hi[1]=p[1];}
      return{id:Number(b.f.id),name:b.f.name,rings:b.rings,lo,hi,area:(hi[0]-lo[0])*(hi[1]-lo[1])};});
    const NEAR=2;
    for(const x of labels){
      const cx=(x.l+x.r)/2-mapRect.left,cy=(x.t+x.b)/2-mapRect.top;
      const mx=(cx-(S.x||0))/S.z,my=(cy-(S.y||0))/S.z;
      if(!Number.isFinite(mx)||!Number.isFinite(my))continue;
      const own=boxes.find(o=>o.id===Number(x.id));
      if(!own)continue;
      if(mx>=own.lo[0]-NEAR&&mx<=own.hi[0]+NEAR&&my>=own.lo[1]-NEAR&&my<=own.hi[1]+NEAR){
        if(own.hi[0]-own.lo[0]<8||own.hi[1]-own.lo[1]<8)continue;   /* too small to test */
        if(own.rings.some(r=>inRing([mx,my],r)))continue;            /* inside its own polygon */
        /* Inside the bbox but outside the polygon: the point is in the water or in a neighbour
           threaded through this unit's bbox. Fall through and let the neighbour test decide. */
      }
      const labelArea=Math.max(1,(x.r-x.l)*(x.b-x.t));
      for(const o of boxes){
        if(o.id===Number(x.id))continue;
        if(mx<o.lo[0]||mx>o.hi[0]||my<o.lo[1]||my>o.hi[1])continue;
        if(!o.rings.some(r=>inRing([mx,my],r)))continue;
        if(x.leader)break;
        mislabelled.push({text:x.text,inside:o.name,unavoidable:own.area<labelArea});
        break;
      }
    }
  }
  /* A leader line buys its label an exemption from the mislabel test above, so the leader itself has
   * to be measured rather than trusted. An exemption earned by a line nobody can follow is not an
   * exemption: with .6px width and 50% opacity the old leader blended down to 1.73:1 against the
   * fills, i.e. it was the reason 20 of 34 labels passed a test they were failing. Anything thinner
   * than a pixel, translucent, or under 3:1 against its least favourable ground is counted here. */
  const leaderIllegible=[];let leaderMeasured=0,leaderWorst=null;
  if(typeof palette!=='undefined')for(const x of labels){
    const k=x.leaderInk;if(!k)continue;
    leaderMeasured++;
    if(k.minContrast!==null&&(leaderWorst===null||k.minContrast<leaderWorst))leaderWorst=k.minContrast;
    if(k.w<1||k.op<0.9||(k.minContrast!==null&&k.minContrast<3))
      leaderIllegible.push({text:x.text,w:k.w,op:k.op,minContrast:k.minContrast===null?null:Number(k.minContrast.toFixed(2))});
  }
  /* The breaker's work read back off the screen: a school name that renders with a component cut
   * across two lines. Chinese has no spaces, so a greedy fill used to produce 浙江工商大 / 学杭州商 /
   * 学院; the breaker now keeps these components whole, which is what the wrapGuard below asserts
   * without consulting a font at all. This count is kept because it is the one number that comes from
   * real rendered glyphs - but it is font-dependent (CI's Ubuntu image has no CJK face, so it measures
   * .notdef and its number there can only go down), which is why it is published for corroboration
   * and the synthetic wrapGuard, not this, is the gate. */
  const BOUND_WORDS=${BOUND_WORDS};
  const wordBreak=[];
  for(const g of groups){
    const ts=[...g.querySelectorAll('text')];if(ts.length<2)continue;
    const ln=ts.map(t=>t.textContent);
    for(let i=1;i<ln.length;i++){
      let hit=null;
      for(const w of BOUND_WORDS){for(let k=1;k<w.length;k++){
        if(ln[i-1].endsWith(w.slice(0,k))&&ln[i].startsWith(w.slice(k))){hit=w;break;}}
        if(hit)break;}
      if(hit){wordBreak.push({text:ln.join(''),word:hit,after:ln[i-1],before:ln[i]});break;}
    }
  }
  const unavoidable=mislabelled.filter(m=>m.unavoidable).length;
  /* Two neighbouring regions must never share a fill, or the boundary between them disappears and the
   * legend's promise ("colour only separates adjacent units") is false. Adjacency is the same
   * shared-vertex test the colouring itself uses, recomputed here from the rendered geometry, so this
   * fails the moment the palette is too short for the data rather than a moment later in review. */
  let adjSame=0,adjPairs=0,adjSample=[];
  if(typeof S!=='undefined'&&S.base){
    const named=S.base.filter(b=>b.f.name&&b.el),grp=named.map(()=>new Set()),owner=new Map();
    named.forEach((b,i)=>{for(const r of b.rings)for(const p of r){const key=Math.round(p[0]*1000)+','+Math.round(p[1]*1000);
      if(!owner.has(key))owner.set(key,new Set());
      for(const j of owner.get(key))if(i!==j){grp[i].add(j);grp[j].add(i);}
      owner.get(key).add(i);}});
    for(let i=0;i<named.length;i++)for(const j of grp[i]){if(j<i)continue;adjPairs++;
      const a=named[i].el.getAttribute('fill'),b=named[j].el.getAttribute('fill');
      if(a&&b&&a===b){adjSame++;if(adjSample.length<6)adjSample.push(named[i].f.name+' = '+named[j].f.name);}}
  }
  /* The inset is chrome as well: it must not sit under the zoom controls or the legend, which is
   * exactly where a corner-anchored box ends up once the controls grow to a touch size. */
  let insetVsUi=null;
  if(typeof S!=='undefined'&&S.insetBox){
    const ib={l:S.insetBox.l+mapRect.left,t:S.insetBox.t+mapRect.top,r:S.insetBox.r+mapRect.left,b:S.insetBox.b+mapRect.top};
    for(const u of ui)if(inter(ib,u,0)>0){insetVsUi=u.sel;break;}
  }
  /* §25: the map stays the main body of the page on a phone, and the controls are big enough to
   * hit with a thumb.  Both are measured against the *coarse pointer* the page actually sees, so
   * the touch stylesheet is exercised rather than assumed - the emulation is switched on with the
   * viewport in the driver below. */
  const coarse=matchMedia('(pointer:coarse)').matches;
  const smallTargets=[];
  if(coarse){
    const SEL='.mapcontrols button,.actions>button,.searchwrap input,.searchclear,.controls label,.item,.schoolcard summary,.footnote button';
    for(const el of document.querySelectorAll(SEL)){
      if(!el.getClientRects().length)continue;
      const r=el.getBoundingClientRect();
      if(r.width<44||r.height<44)smallTargets.push({t:(el.textContent||'').trim().slice(0,10)||el.className,w:Math.round(r.width),h:Math.round(r.height)});
    }
  }
  /* src/styles.css carries --canvas as a literal whose comment says it "mirrors MAP_STYLE.canvas in
   * src/app.js; the two must move together". A comment does not keep two values in step, and the map
   * card's background is exactly the kind of thing that drifts without anyone noticing. This reads the
   * authored declaration out of the stylesheet (not the computed value, which an inline override would
   * mask) and compares it to the constant the map paints with. */
  let canvasVar=null,canvasDrift=null;
  if(typeof MAP_STYLE!=='undefined')try{
    for(const sh of document.styleSheets)for(const rule of sh.cssRules||[]){
      const v=rule.style&&rule.style.getPropertyValue('--canvas');
      if(v){canvasVar=v.trim();if(canvasVar!==MAP_STYLE.canvas)canvasDrift={css:canvasVar,js:MAP_STYLE.canvas};}
    }
  }catch(e){canvasDrift={css:'unreadable',js:e.message};}
  const mapShare=+(mapRect.height/window.innerHeight*100).toFixed(1);
  const stats=typeof S!=='undefined'&&S.labelStats?S.labelStats:null;
  /* The placer keeps its own account of what it did in S.labelStats, and this test used to publish
   * those numbers as if they described the screen. They do not: S.labelStats.hidden counts the units
   * the placer decided to skip, which is the placer marking its own homework. Every number the
   * assertions below depend on is therefore recomputed from the label groups that are in the DOM,
   * and the engine's copy is kept only under an engine-prefixed name so the two can be compared.
   * A disagreement between them is the failure this test exists to catch, and it was invisible while
   * the engine's numbers were the only ones on the page. */
  const domIds=new Set(groups.map(g=>g.getAttribute('data-label-id')));
  const domNameOnly=groups.filter(g=>g.getAttribute('data-name-only')==='1');
  const domSilent=[];
  if(typeof S!=='undefined'&&S.base)for(const g of domNameOnly){
    const b=S.base.find(x=>String(x.f.id)===String(g.getAttribute('data-label-id')));
    if(!b||typeof best!=='function')continue;
    const bb=best(b.f);if(bb&&bb.u)domSilent.push(b.f.name+'→'+bb.u);
  }
  /* Named units whose anchor is inside the drawn map and which got no label group at all. */
  const domMissing=[];
  if(typeof S!=='undefined'&&S.base&&S.z)for(const b of S.base){
    if(!b.f.name||domIds.has(String(b.f.id)))continue;
    const x=b.cp[0]*S.z+S.x,y=b.cp[1]*S.z+S.y;
    if(x>=0&&y>=0&&x<=S.w&&y<=S.h)domMissing.push(b.f.name);
  }
  return {
    view:{w:Math.round(mapRect.width),h:Math.round(mapRect.height)},
    coarse,mapShare,smallTargetCount:smallTargets.length,smallTargets:smallTargets.slice(0,10),
    labels:labels.length,labelCount:typeof S!=='undefined'?S.labelCount:null,
    candidates:typeof S!=='undefined'&&S.base?S.base.filter(b=>b.f.name).length:null,
    domNameOnlyCount:domNameOnly.length,domSilentCount:domSilent.length,domSilentNames:domSilent.slice(0,12),
    domMissingCount:domMissing.length,domMissingNames:domMissing.slice(0,12),
    engineHidden:stats?stats.hidden:null,engineNameOnly:stats?stats.nameOnly:null,
    uniLabels:stats?stats.uniLabels:null,minLabelFont:stats?stats.minFont:null,
    leaderCount:stats?stats.leaders:null,displacedTier3:stats?stats.displaced:null,
    overlapCount:overlaps.length,overlaps:overlaps.slice(0,12),
    mislabelCount:mislabelled.filter(m=>!m.unavoidable).length,unavoidableSpillCount:unavoidable,
    mislabelled:mislabelled.slice(0,8),
    leaderCountRendered:labels.filter(x=>x.leader).length,
    leaderIllegibleCount:leaderIllegible.length,leaderIllegibleSample:leaderIllegible.slice(0,6),
    /* Published so the check above cannot pass by measuring nothing: a null here means no leader was
       measured at all, and the count of 0 would then be meaningless rather than reassuring. */
    leaderMeasured:leaderMeasured,leaderWorstContrast:leaderWorst===null?null:Number(leaderWorst.toFixed(2)),
    wordBreakCount:wordBreak.length,wordBreakSample:wordBreak.slice(0,6),
    clippedCount:clipped.length,clipped:clipped.slice(0,12),
    geoPaths,geoOutsideCount:geoOutside.length,geoOutside:geoOutside.slice(0,8),
    canvasVar,canvasDrift,
    uiCollisionCount:collisions.length,collisions:collisions.slice(0,12),
    pinCount:pinHits.length,pinsCoveredCount:pinsCovered.length,pinsCovered:pinsCovered.slice(0,12),
    adjacentPairs:adjPairs,adjacentSameFillCount:adjSame,adjacentSameFillSample:adjSample,insetVsUi,
    paletteLength:typeof palette!=='undefined'?palette.length:null,
    tinyFontLabels:tiny.length,tinyFontSample:tiny.slice(0,8),
    haloOverCapCount:halo.length,haloOverCapSample:halo.slice(0,8),
    /* Vertical only, and named for it: this is scrollHeight minus innerHeight. The horizontal axis is
       measured by the clipped-label and UI-collision checks instead, and it is 0 on every route. */
    pageOverflow:Math.max(0,Math.round(document.documentElement.scrollHeight-window.innerHeight)),
    domNodes:document.getElementsByTagName('*').length,
    labelTexts:labels.map(x=>x.text)
  };
})()`;
/* Chinese has no spaces, so the line breaker is the only thing between a school name and an arbitrary
 * character split - and the wordBreakCount check above reads the split off *rendered* glyphs, which
 * makes it a poor gate. CI's Ubuntu image ships no CJK font, the fallback face is .notdef, and the
 * same wrapText scores a different (and easily smaller) number there than on Windows. This guard
 * drives wrapText with a synthetic metric instead - em units, one full-width glyph 1em, one Latin
 * .5em - so it measures the breaker rather than the font, and asserts the two properties that hold
 * whatever the font happens to be:
 *   - the lines rejoin to exactly the input, and no line exceeds its budget;
 *   - no line boundary falls inside a word Chinese reads as one unit, checked against BOUND_WORDS -
 *     the test's own list, not the engine's - so shortening the engine's list cannot weaken this.
 * A name that cannot be wrapped without splitting is required to come back empty, which is the
 * engine's documented degradation: the caller then prints the administrative name alone. The cases
 * below pin the exact split for names the engine has to get right; the corpus sweep then runs the
 * same two invariants over every school and region name the page carries, at all three real budgets. */
const WRAP_GUARD=`(() => {
  const out={cases:[],failures:[],corpusChecked:0,corpusFailures:0,corpusSample:[],unavailable:false};
  if(typeof wrapText!=='function'||typeof textTokens!=='function'){out.unavailable=true;return out;}
  const WORDS=${BOUND_WORDS};
  const synth=s=>{let n=0;for(const ch of [...s])n+=CJK_RE.test(ch)?1:0.5;return n;};
  const splitWord=(a,b)=>{for(const w of WORDS)for(let k=1;k<w.length;k++)if(a.endsWith(w.slice(0,k))&&b.startsWith(w.slice(k)))return w;return null;};
  const audit=(name,budget,expect)=>{
    const lines=wrapText(name,budget,12,650,synth),why=[];
    if(lines.length){
      if(lines.join('')!==name)why.push('rejoin="'+lines.join('')+'"');
      for(let i=1;i<lines.length;i++){const w=splitWord(lines[i-1],lines[i]);if(w)why.push('splits '+w+' at line '+i);}
      if(lines.some(l=>synth(l)>budget+1e-6))why.push('line over budget');
    } else if(expect&&expect.length)why.push('degraded to nothing');
    if(expect&&lines.join('/')!==expect)why.push('expected "'+expect+'"');
    return {name,budget,got:lines.join('/'),why};
  };
  /* Budgets are the engine's own: nameMax is 5.4 on the national view and 7 elsewhere, uniMax 7.2
     national and 9.2 elsewhere. Only the 9.2 and 7.2 rows are school-name budgets; 5.4 is the
     administrative-name budget, and is exercised here because it is the tightest box the breaker
     ever sees. */
  const CASES=[
    ['浙江工商大学杭州商学院',9.2,'浙江工商大学/杭州商学院'],
    ['北京师范大学珠海分校',9.2,'北京师范大学/珠海分校'],
    ['电子科技大学中山学院',9.2,'电子科技大学/中山学院'],
    ['中国科学技术大学',7.2,'中国科学/技术大学'],
    ['上海中侨职业技术大学',7.2,'上海中侨/职业技术大学'],
    ['内蒙古自治区',5.4,'内蒙古/自治区'],
    ['哈尔滨工业大学',7.2,'哈尔滨工业大学'],
    ['职业技术学院',5.4,''],
    ['浙江工商大学杭州商学院',5.4,''],
    ['北京大学',5.4,'北京大学']
  ];
  for(const [n,b,e] of CASES){const r=audit(n,b,e);
    out.cases.push({name:r.name,budget:r.budget,got:r.got,expect:e||null});
    if(r.why.length)out.failures.push({name:r.name,budget:r.budget,got:r.got,why:r.why.join('; ')});}
  const names=[];
  if(typeof D!=='undefined'&&D)for(const u of D.universities||[])if(u.u)names.push(u.u);
  if(typeof S!=='undefined'&&S&&S.base)for(const b of S.base)if(b.f&&b.f.name)names.push(b.f.name);
  const seen=new Set();
  for(const n of names){if(seen.has(n))continue;seen.add(n);
    for(const b of [7.2,5.4,9.2]){out.corpusChecked++;
      const r=audit(n,b,null);
      if(r.why.length){out.corpusFailures++;if(out.corpusSample.length<10)out.corpusSample.push({name:n,budget:b,got:r.got,why:r.why.join('; ')});}}}
  return out;
})()`;
async function main(){
 const chrome=process.env.CHROME_BIN||execFileSync('which',['google-chrome'],{encoding:'utf8'}).trim();
 proc=spawn(chrome,['--headless','--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
 const portFile=path.join(profile,'DevToolsActivePort');for(let i=0;i<300&&!fs.existsSync(portFile);i++)await wait(100);if(!fs.existsSync(portFile))throw Error('Chrome DevTools startup failed');
 const port=fs.readFileSync(portFile,'utf8').split('\n')[0],tabs=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json(),tab=tabs.find(t=>t.type==='page');
 ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});let seq=0;const pending=new Map();
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);else if(m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url))network.push(m.params.request.url);};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:pathToFileURL(path.join(ROOT,'dist/china-university-atlas.html')).href});
 let ready=false;for(let i=0;i<300;i++){await wait(100);if(await evaluate('!!window.__atlas')){ready=true;break;}}if(!ready)throw Error('Atlas did not boot');
 const bootMs=await evaluate('Math.round(performance.now())');
 const wrapGuard=await evaluate(WRAP_GUARD);
 let cur=null,shots=0;const records=[];const problems=[];
 if(process.env.SHOTS!=='0')fs.mkdirSync(shotDir,{recursive:true});
 for(const m of MATRIX){
  const key=m.w+'x'+m.h;
  if(!cur||cur.w!==m.w||cur.h!==m.h){
    /* mobile:true alone does not make (pointer:coarse)/(hover:none) match - without touch
     * emulation the page keeps its mouse stylesheet, so the phone screenshots would show a layout
     * no phone ever renders and the touch-target assertion would pass vacuously. */
    await send('Emulation.setTouchEmulationEnabled',{enabled:!!m.mobile,maxTouchPoints:5});
    await send('Emulation.setDeviceMetricsOverride',{width:m.w,height:m.h,deviceScaleFactor:1,mobile:m.mobile});
    cur=m;await wait(200);
  }
  await evaluate(`document.getElementById('includeBranch').checked=true;__atlas.navigateID('${m.id}')`);
  await wait(520);
  const g=await evaluate(MEASURE);
  const name=`${key}-${m.slug}.png`;
  if(process.env.SHOTS!=='0'){const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(shotDir,name),Buffer.from(shot.data,'base64'));shots++;}
  const rec={viewport:key,mobile:m.mobile,route:m.label,regionId:m.id,shot:process.env.SHOTS!=='0'?'reports/visual/'+name:null,
    visibleLabels:g.labels,domNameOnlyCount:g.domNameOnlyCount,domSilentCount:g.domSilentCount,domSilentNames:g.domSilentNames,
    domMissingCount:g.domMissingCount,domMissingNames:g.domMissingNames,engineHidden:g.engineHidden,engineNameOnly:g.engineNameOnly,
    candidates:g.candidates,uniLabels:g.uniLabels,pinCount:g.pinCount,pinsCoveredCount:g.pinsCoveredCount,pinsCovered:g.pinsCovered,
    minLabelFont:g.minLabelFont,leaderCount:g.leaderCount,displacedTier3:g.displacedTier3,pageOverflow:g.pageOverflow,
    leaderCountRendered:g.leaderCountRendered,leaderIllegibleCount:g.leaderIllegibleCount,leaderIllegibleSample:g.leaderIllegibleSample,
    leaderMeasured:g.leaderMeasured,leaderWorstContrast:g.leaderWorstContrast,
    wordBreakCount:g.wordBreakCount,wordBreakSample:g.wordBreakSample,
    labelOverlapCount:g.overlapCount,mislabelCount:g.mislabelCount,clippedLabelCount:g.clippedCount,labelUiCollisionCount:g.uiCollisionCount,
    adjacentPairs:g.adjacentPairs,adjacentSameFillCount:g.adjacentSameFillCount,paletteLength:g.paletteLength,insetVsUi:g.insetVsUi,
    tinyFontLabels:g.tinyFontLabels,haloOverCapCount:g.haloOverCapCount,unavoidableSpillCount:g.unavoidableSpillCount,
    geoPaths:g.geoPaths,geoOutsideCount:g.geoOutsideCount,geoOutside:g.geoOutside,canvasVar:g.canvasVar,canvasDrift:g.canvasDrift,
    coarse:g.coarse,mapShare:g.mapShare,smallTargetCount:g.smallTargetCount,smallTargets:g.smallTargets,
    domNodes:g.domNodes,mapView:g.view,
    overlaps:g.overlaps,mislabelled:g.mislabelled,clipped:g.clipped,collisions:g.collisions,
    tinyFontSample:g.tinyFontSample,haloOverCapSample:g.haloOverCapSample,labelTexts:g.labelTexts,httpRequests:[],runtimeErrors:[]};
  records.push(rec);
  for(const k of ['labelOverlapCount','clippedLabelCount','labelUiCollisionCount','mislabelCount','tinyFontLabels'])
   if(rec[k])problems.push({route:m.label,viewport:key,kind:k,count:rec[k],
     detail:k==='labelOverlapCount'?rec.overlaps:k==='clippedLabelCount'?rec.clipped:k==='mislabelCount'?rec.mislabelled:k==='tinyFontSample'?rec.tinyFontSample:rec.collisions});
  /* §24 lets a two-line label fall back to the administrative name alone when the box cannot be
   * placed anywhere, which is a degradation the spec sanctions rather than a layout fault - so it is
   * asserted only where the map demonstrably had room. At 1440 every route places every winner
   * (measured 0 on all four desktop routes), so a non-zero count there is a placer regression, not a
   * space limit. Below 1440 and on a phone the count and the affected regions are published in the
   * report for review instead: a bare number cannot be reviewed, and 430px genuinely cannot hold 34
   * two-line labels. */
  if(!m.mobile&&m.w>=1440&&rec.domSilentCount)problems.push({route:m.label,viewport:key,kind:'silentOnAnswer',count:rec.domSilentCount,detail:rec.domSilentNames});
  if(rec.adjacentSameFillCount)problems.push({route:m.label,viewport:key,kind:'adjacentSameFillCount',count:rec.adjacentSameFillCount,detail:rec.adjacentSameFillSample});
  if(rec.insetVsUi)problems.push({route:m.label,viewport:key,kind:'insetVsUi',count:1,detail:[rec.insetVsUi]});
  /* Not viewport-gated: geometry outside the fitted box is cut by the frame at every width. geoPaths
     is published next to the count so a 0 cannot be the result of measuring nothing. */
  if(rec.geoOutsideCount)problems.push({route:m.label,viewport:key,kind:'geoOutsideCount',count:rec.geoOutsideCount,detail:rec.geoOutside});
  if(rec.haloOverCapCount)problems.push({route:m.label,viewport:key,kind:'haloOverCapCount',count:rec.haloOverCapCount,detail:rec.haloOverCapSample});
  if(rec.pinsCoveredCount)problems.push({route:m.label,viewport:key,kind:'pinsCoveredCount',count:rec.pinsCoveredCount,detail:rec.pinsCovered});
  /* Not viewport-gated. A leader that cannot be followed is a defect at every width, because the
     mislabel exemption above is granted on the assumption that the reader can follow it. */
  if(rec.leaderIllegibleCount)problems.push({route:m.label,viewport:key,kind:'leaderIllegibleCount',count:rec.leaderIllegibleCount,detail:rec.leaderIllegibleSample});
  if(m.mobile&&rec.smallTargetCount)problems.push({route:m.label,viewport:key,kind:'smallTargetCount',count:rec.smallTargetCount,detail:rec.smallTargets});
  if(m.mobile&&(rec.mapShare<50||rec.mapShare>70))problems.push({route:m.label,viewport:key,kind:'mapShare',count:rec.mapShare,detail:[]});
  /* The stacked mobile layout (map over list) is taller than the viewport by design, so page
   * overflow is only a defect on the desktop layout, where the shell is meant to fit the window. */
  if(!m.mobile&&rec.pageOverflow>0)problems.push({route:m.label,viewport:key,kind:'pageOverflow',count:rec.pageOverflow,detail:[]});
 }
 /* Route-independent checks, reported once rather than once per screenshot. */
 if(records[0]&&records[0].canvasDrift)problems.push({route:'(stylesheet)',viewport:'-',kind:'canvasVarDrift',count:1,detail:[records[0].canvasDrift]});
 if(wrapGuard.unavailable)problems.push({route:'(breaker)',viewport:'-',kind:'wrapGuardUnavailable',count:1,detail:[]});
 if(wrapGuard.failures.length)problems.push({route:'(breaker)',viewport:'-',kind:'wrapGuardCases',count:wrapGuard.failures.length,detail:wrapGuard.failures});
 if(wrapGuard.corpusFailures)problems.push({route:'(breaker)',viewport:'-',kind:'wrapGuardCorpus',count:wrapGuard.corpusFailures,detail:wrapGuard.corpusSample});
 const sum=k=>records.reduce((s,r)=>s+r[k],0);
 const result={pass:problems.length===0&&!network.length&&!errors.length,screenshots:shots,routes:records.length,
  labelOverlapCount:sum('labelOverlapCount'),clippedLabelCount:sum('clippedLabelCount'),labelUiCollisionCount:sum('labelUiCollisionCount'),
  mislabelCount:sum('mislabelCount'),tinyFontLabels:sum('tinyFontLabels'),haloOverCapCount:sum('haloOverCapCount'),
  geoOutsideCount:sum('geoOutsideCount'),geoPaths:sum('geoPaths'),
  canvasVar:records[0]?.canvasVar??null,canvasDrift:records[0]?.canvasDrift??null,
  wrapGuard:{cases:wrapGuard.cases,failures:wrapGuard.failures,corpusChecked:wrapGuard.corpusChecked,
    corpusFailures:wrapGuard.corpusFailures,corpusSample:wrapGuard.corpusSample,unavailable:wrapGuard.unavailable},
  labelsPlaced:sum('visibleLabels'),labelsNameOnly:sum('domNameOnlyCount'),
  /* DOM truth, then the placer's own account of the same map. When these two diverge the engine is
     describing a map that is not on the screen. */
  silentOnAnswer:sum('domSilentCount'),labelsMissing:sum('domMissingCount'),
  engineReportedHidden:sum('engineHidden'),engineReportedNameOnly:sum('engineNameOnly'),
  unavoidableSpillCount:sum('unavoidableSpillCount'),
  adjacentPairs:sum('adjacentPairs'),adjacentSameFillCount:sum('adjacentSameFillCount'),
  paletteLength:records[0]?.paletteLength??null,
  smallTargetCount:sum('smallTargetCount'),pinCount:sum('pinCount'),pinsCoveredCount:sum('pinsCoveredCount'),
  leaderCountRendered:sum('leaderCountRendered'),leaderIllegibleCount:sum('leaderIllegibleCount'),
  leaderMeasured:sum('leaderMeasured'),wordBreakCount:sum('wordBreakCount'),
  leaderWorstContrast:Math.min(...records.map(r=>r.leaderWorstContrast===null||r.leaderWorstContrast===undefined?Infinity:r.leaderWorstContrast))===Infinity?null
    :Number(Math.min(...records.map(r=>r.leaderWorstContrast===null||r.leaderWorstContrast===undefined?Infinity:r.leaderWorstContrast)).toFixed(2)),
  mobileMapShare:records.filter(r=>r.coarse).map(r=>r.mapShare),
  maxPageOverflow:Math.max(...records.map(r=>r.pageOverflow??0)),
  maxDesktopPageOverflow:Math.max(...records.filter(r=>!r.mobile).map(r=>r.pageOverflow??0)),
  minLabelFont:Math.min(...records.map(r=>r.minLabelFont??99)),
  bootMs,domNodes:records[0]?.domNodes??null,
  offline:true,httpRequests:network,runtimeErrors:errors,problems:problems.slice(0,40),artifact:'dist/china-university-atlas.html',
  generatedAtNote:'geometry measured with getBoundingClientRect on rendered #labelLayer groups (stroke included)'};
 if(process.env.SHOTS!=='0'){fs.writeFileSync(path.join(ROOT,'reports/visual-layout.json'),JSON.stringify(result,null,2)+'\n');
  fs.writeFileSync(path.join(ROOT,'reports/visual/v5.8-visual-audit.json'),JSON.stringify({summary:result,records},null,2)+'\n');}
 console.log(JSON.stringify(result));
 await send('Browser.close').catch(()=>{});ws.close();if(!result.pass)throw Error('Visual layout test failed');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>{if(ws)ws.close();if(proc)proc.kill();setTimeout(()=>{try{fs.rmSync(profile,{recursive:true,force:true});}catch{/* Windows may still hold the profile */}},500);});
