/* V5.9 Premium Atlas interaction layer.
 * Keeps the data/winner engine untouched. It only changes presentation and input scheduling.
 */
(()=>{
  const map=$('map'),labels=$('labelLayer'),shapes=$('shapes'),edges=$('edgeLayer');
  if(!map||!labels||!shapes||!edges)return;

  const metrics=window.__premiumMetrics={
    version:'5.9.0',layoutCount:0,fastTransformCount:0,wheelEvents:0,wheelFrames:0,
    leadersRemoved:0,offShapeLabelsRemoved:0,lastSettleMs:0,lastReason:'boot'
  };
  let layoutState=null,settleTimer=0,settleRAF=0,wheelRAF=0,wheelDelta=0,wheelPoint=null;
  let pinBaseline=[],drawerOpen=false;
  const SETTLE_MS=150;

  const originalDrawLabels=drawLabels;
  const originalDrawMap=drawMap;
  const originalEnter=enter;
  const originalNavigateID=navigateID;

  function premiumUi(){
    const actions=document.querySelector('.actions');
    if(actions&&!document.getElementById('premiumPanelBtn')){
      const b=document.createElement('button');b.id='premiumPanelBtn';b.className='premium-panel-toggle';
      b.textContent='浏览';b.setAttribute('aria-label','打开地区与高校列表');b.onclick=()=>setDrawer(!drawerOpen);
      actions.append(b);
    }
    const side=document.querySelector('.side');
    if(side&&!side.querySelector('.premium-drawer-close')){
      const b=document.createElement('button');b.className='premium-drawer-close';b.textContent='×';b.setAttribute('aria-label','关闭地区列表');
      b.onclick=()=>setDrawer(false);side.prepend(b);
    }
    if(!document.querySelector('.premium-scrim')){
      const s=document.createElement('div');s.className='premium-scrim';s.onclick=()=>setDrawer(false);document.body.append(s);
    }
    if(!document.querySelector('.premium-scale')){
      const el=document.createElement('div');el.className='premium-scale';el.setAttribute('aria-hidden','true');
      el.innerHTML='<div class="premium-scale-bar"></div><div class="premium-scale-label"></div>';
      document.querySelector('.mapcard')?.append(el);
    }
  }

  function setDrawer(open){
    drawerOpen=!!open;document.querySelector('.side')?.classList.toggle('premium-open',drawerOpen);
    document.querySelector('.premium-scrim')?.classList.toggle('open',drawerOpen);
    document.getElementById('premiumPanelBtn')?.setAttribute('aria-expanded',String(drawerOpen));
  }
  window.__premiumSetDrawer=setDrawer;

  function niceDistance(v){
    if(!(v>0))return 0;const pow=Math.pow(10,Math.floor(Math.log10(v))),q=v/pow;
    return(q>=5?5:q>=2?2:1)*pow;
  }
  function updateScale(){
    const el=document.querySelector('.premium-scale');if(!el||!S.projection||!(S.z>0)){if(el)el.style.display='none';return;}
    const node=current(),cp=node?.f?.cp||[105,35],lon=Number(cp?.[0])||105,lat=Math.max(5,Math.min(60,Number(cp?.[1])||35));
    const a=project([lon,lat]),b=project([lon+1,lat]),proj=Math.hypot(b[0]-a[0],b[1]-a[1]);
    const px=proj*S.projection.scale*S.z,km=111.32*Math.cos(lat*Math.PI/180);if(!(px>0&&km>0)){el.style.display='none';return;}
    const kmPerPx=km/px,target=92,nice=niceDistance(kmPerPx*target),width=Math.max(38,Math.min(160,nice/kmPerPx));
    el.style.display='block';el.querySelector('.premium-scale-bar').style.width=width.toFixed(1)+'px';
    el.querySelector('.premium-scale-label').textContent=nice>=1?`${Math.round(nice)} km`:`${Math.round(nice*1000)} m`;
  }

  function mapPointFromLayout(p){
    if(!layoutState||!p)return p;const k=S.z/layoutState.z;
    return[S.x+k*(p[0]-layoutState.x),S.y+k*(p[1]-layoutState.y)];
  }
  function fastLabels(){
    if(!layoutState)return;
    if(current().kind==='district'){
      // District views include campus circles. Move each item in screen space so symbols and type
      // stay constant-size during interaction instead of being GPU-scaled into large blobs.
      for(const rec of S.labels||[]){const g=labels.querySelector(`g[data-label-id="${CSS.escape(String(rec.id))}"]`);if(!g||!rec.anchor)continue;
        const p=mapPointFromLayout(rec.anchor);g.setAttribute('transform',`translate(${(p[0]-rec.anchor[0]).toFixed(2)} ${(p[1]-rec.anchor[1]).toFixed(2)})`);}
      for(const pin of pinBaseline){const p=mapPointFromLayout([pin.x,pin.y]);pin.el.setAttribute('cx',p[0].toFixed(2));pin.el.setAttribute('cy',p[1].toFixed(2));}
      labels.removeAttribute('transform');
      return;
    }
    for(const rec of S.labels||[]){const g=labels.querySelector(`g[data-label-id="${CSS.escape(String(rec.id))}"]`);if(!g||!rec.anchor)continue;
      const p=mapPointFromLayout(rec.anchor);g.setAttribute('transform',`translate(${(p[0]-rec.anchor[0]).toFixed(2)} ${(p[1]-rec.anchor[1]).toFixed(2)})`);}
    labels.removeAttribute('transform');
  }

  function clearTransient(){
    labels.removeAttribute('transform');for(const g of labels.querySelectorAll('g[data-label-id]'))g.removeAttribute('transform');
    for(const pin of pinBaseline){pin.el.setAttribute('cx',pin.x);pin.el.setAttribute('cy',pin.y);}
  }

  function scheduleSettle(reason='interaction',delay=SETTLE_MS){
    metrics.lastReason=reason;clearTimeout(settleTimer);cancelAnimationFrame(settleRAF);
    document.body.classList.add('premium-zooming');
    settleTimer=setTimeout(()=>{settleRAF=requestAnimationFrame(()=>{
      const t=performance.now();document.body.classList.remove('premium-zooming');document.body.classList.add('premium-settling');
      drawLabels();metrics.lastSettleMs=Number((performance.now()-t).toFixed(2));
      setTimeout(()=>document.body.classList.remove('premium-settling'),180);
    });},delay);
  }

  function fastTransform(reason='interaction'){
    metrics.fastTransformCount++;
    const t=`translate(${S.x} ${S.y}) scale(${S.z})`;shapes.setAttribute('transform',t);edges.setAttribute('transform',t);
    fastLabels();$('zoomInfo').textContent=Math.round(S.z*100)+'%';updateScale();scheduleSettle(reason);
  }

  // Existing drag/pinch/button code calls applyTransform(). Replace the expensive implementation:
  // no drawLabels on every pointer frame; only geometry and label positions move, then one idle layout.
  applyTransform=()=>fastTransform('transform');

  drawLabels=function(){
    cancelAnimationFrame(drawFrame);clearTimeout(settleTimer);clearTransient();
    metrics.layoutCount++;originalDrawLabels();

    // Default presentation is zero-leader. An off-shape label without a line is ambiguous, so the
    // whole group is removed. The sidebar/drawer remains the complete source of truth.
    let removed=0,leaders=0;
    for(const g of [...labels.querySelectorAll('g[data-label-id]')]){
      const tier=Number(g.getAttribute('data-place-tier')||1);
      leaders+=g.querySelectorAll('line.leader,circle.leader').length;
      if(tier!==1){g.remove();removed++;continue;}
      for(const e of g.querySelectorAll('line.leader,circle.leader'))e.remove();
    }
    metrics.leadersRemoved+=leaders;metrics.offShapeLabelsRemoved+=removed;
    if(Array.isArray(S.labels))S.labels=S.labels.filter(r=>(r.tier||1)===1);
    S.labelCount=S.labels?.length||0;
    if(S.labelStats){S.labelStats.leaders=0;S.labelStats.displaced=0;S.labelStats.shown=S.labelCount;S.labelStats.hidden=(S.labelStats.hidden||0)+removed;}
    pinBaseline=[...labels.querySelectorAll('.campuspin,.campuspin-hit')].map(el=>({el,x:Number(el.getAttribute('cx')),y:Number(el.getAttribute('cy'))}));
    layoutState={z:S.z,x:S.x,y:S.y};updateScale();document.body.dataset.premiumLeaders=String(labels.querySelectorAll('.leader').length);
  };

  drawMap=function(reset=false){labels.innerHTML='';S.labels=[];layoutState=null;const r=originalDrawMap(reset);scheduleSettle('map',0);return r;};

  // Coalesce the entire wheel stream to at most one transform per animation frame. The original
  // bubble listener is stopped in capture phase, so it cannot trigger its per-event layout path.
  map.addEventListener('wheel',e=>{
    e.preventDefault();e.stopImmediatePropagation();metrics.wheelEvents++;wheelDelta+=e.deltaY;
    const r=map.getBoundingClientRect();wheelPoint=[e.clientX-r.left,e.clientY-r.top];
    if(wheelRAF)return;
    wheelRAF=requestAnimationFrame(()=>{
      wheelRAF=0;metrics.wheelFrames++;const d=wheelDelta;wheelDelta=0;const [cx,cy]=wheelPoint||[S.w/2,S.h/2];
      const nz=Math.max(.65,Math.min(24,S.z*Math.exp(-d*.00145))),k=nz/S.z;
      S.x=cx-(cx-S.x)*k;S.y=cy-(cy-S.y)*k;S.z=nz;fastTransform('wheel');
    });
  },{capture:true,passive:false});

  // Keep the hover card compact; complete detail belongs in the drawer.
  showTip=function(e,f){
    const b=best(f),t=$('tooltip'),school=b.rawU||b.u||'暂无可比最佳高校';
    t.innerHTML=`<span class="premium-tip-region">${esc(f.name)}</span><strong class="premium-tip-school">${esc(school)}</strong>`;
    t.style.display='block';const r=map.getBoundingClientRect();t.style.left=Math.max(8,Math.min(r.width-t.offsetWidth-10,e.clientX-r.left+14))+'px';
    t.style.top=Math.max(76,Math.min(r.height-t.offsetHeight-10,e.clientY-r.top+14))+'px';highlight(f.id);
  };

  enter=function(f){const r=originalEnter(f);setTimeout(()=>setDrawer(true),60);return r;};
  navigateID=async function(id){const r=await originalNavigateID(id);setDrawer(true);return r;};

  premiumUi();setDrawer(false);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&drawerOpen)setDrawer(false);});
  window.__premium={metrics,setDrawer,updateScale,settle:()=>drawLabels()};
})();
