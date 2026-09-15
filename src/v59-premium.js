/* V5.9 Premium Atlas interaction layer.
 * Presentation only: data, winner semantics and source evidence are untouched.
 */
(()=>{
  const map=$('map'),labels=$('labelLayer'),shapes=$('shapes'),edges=$('edgeLayer');
  if(!map||!labels||!shapes||!edges)return;

  const metrics=window.__premiumMetrics={
    version:'5.9.0',layoutCount:0,fastTransformCount:0,wheelEvents:0,wheelFrames:0,
    leadersRendered:0,lastSettleMs:0,lastReason:'boot'
  };
  const SETTLE_MS=150;
  let layoutState=null,settleTimer=0,settleRAF=0,wheelRAF=0,wheelDelta=0,wheelPoint=null;
  let labelBaseline=[],pinBaseline=[],drawerOpen=false;

  const baseDrawLabels=drawLabels;
  const baseShowTip=showTip;
  const baseEnter=enter;
  const baseNavigateID=navigateID;

  function premiumUi(){
    const actions=document.querySelector('.actions');
    if(actions&&!document.getElementById('premiumPanelBtn')){
      const b=document.createElement('button');b.id='premiumPanelBtn';b.className='premium-panel-toggle';
      b.textContent='浏览';b.setAttribute('aria-label','打开地区与高校列表');b.setAttribute('aria-expanded','false');
      b.onclick=()=>setDrawer(!drawerOpen);actions.append(b);
    }
    const side=document.querySelector('.side');
    if(side&&!side.querySelector('.premium-drawer-close')){
      const b=document.createElement('button');b.className='premium-drawer-close';b.textContent='×';
      b.setAttribute('aria-label','关闭地区与高校列表');b.onclick=()=>setDrawer(false);side.prepend(b);
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

  function niceDistance(v){
    if(!(v>0))return 0;const p=Math.pow(10,Math.floor(Math.log10(v))),q=v/p;
    return(q>=5?5:q>=2?2:1)*p;
  }
  function updateScale(){
    const el=document.querySelector('.premium-scale');if(!el||!S.projection||!(S.z>0)){if(el)el.style.display='none';return;}
    const node=current(),cp=node?.f?.cp||[105,35],lon=Number(cp?.[0])||105,lat=Math.max(5,Math.min(60,Number(cp?.[1])||35));
    const a=project([lon,lat]),b=project([lon+1,lat]),projected=Math.hypot(b[0]-a[0],b[1]-a[1]);
    const pxPerDegree=projected*S.projection.scale*S.z,kmPerDegree=111.32*Math.cos(lat*Math.PI/180);
    if(!(pxPerDegree>0&&kmPerDegree>0)){el.style.display='none';return;}
    const kmPerPx=kmPerDegree/pxPerDegree,nice=niceDistance(kmPerPx*92),width=Math.max(38,Math.min(160,nice/kmPerPx));
    el.style.display='block';el.querySelector('.premium-scale-bar').style.width=width.toFixed(1)+'px';
    el.querySelector('.premium-scale-label').textContent=nice>=1?`${Math.round(nice)} km`:`${Math.round(nice*1000)} m`;
  }

  function currentAnchor(b){return[b.cp[0]*S.z+S.x,b.cp[1]*S.z+S.y];}
  function captureLayout(){
    layoutState={z:S.z,x:S.x,y:S.y};labelBaseline=[];
    for(const g of labels.querySelectorAll('g[data-label-id]')){
      const id=String(g.getAttribute('data-label-id')),b=S.base.find(x=>String(x.f.id)===id);if(!b)continue;
      const anchor=currentAnchor(b),scale=1/Math.max(1,S.z);
      g.setAttribute('transform',`translate(${anchor[0].toFixed(2)} ${anchor[1].toFixed(2)}) scale(${scale.toFixed(5)}) translate(${-anchor[0].toFixed(2)} ${-anchor[1].toFixed(2)})`);
      labelBaseline.push({g,b,anchor,scale});
    }
    pinBaseline=[...labels.querySelectorAll('.campuspin,.campuspin-hit')].map(el=>({el,x:Number(el.getAttribute('cx')),y:Number(el.getAttribute('cy'))}));
  }
  function pointFromLayout(x,y){
    if(!layoutState)return[x,y];const k=S.z/layoutState.z;
    return[S.x+k*(x-layoutState.x),S.y+k*(y-layoutState.y)];
  }
  function fastLabels(){
    if(!layoutState)return;
    for(const rec of labelBaseline){
      const now=currentAnchor(rec.b),dx=now[0]-rec.anchor[0],dy=now[1]-rec.anchor[1],a=rec.anchor,s=rec.scale;
      rec.g.setAttribute('transform',`translate(${dx.toFixed(2)} ${dy.toFixed(2)}) translate(${a[0].toFixed(2)} ${a[1].toFixed(2)}) scale(${s.toFixed(5)}) translate(${-a[0].toFixed(2)} ${-a[1].toFixed(2)})`);
    }
    for(const pin of pinBaseline){const p=pointFromLayout(pin.x,pin.y);pin.el.setAttribute('cx',p[0].toFixed(2));pin.el.setAttribute('cy',p[1].toFixed(2));}
  }
  function clearTransient(){
    for(const rec of labelBaseline)rec.g.removeAttribute('transform');
    for(const pin of pinBaseline){pin.el.setAttribute('cx',pin.x);pin.el.setAttribute('cy',pin.y);}
  }

  drawLabels=function(){
    clearTimeout(settleTimer);cancelAnimationFrame(settleRAF);clearTransient();
    const t=performance.now();metrics.layoutCount++;baseDrawLabels();
    // V5.9's default state is strictly zero-leader. The current geographic-honesty layer already
    // keeps labels inside their regions; this guard prevents a future fallback from reintroducing wires.
    let leaders=0;for(const el of [...labels.querySelectorAll('.leader,line')]){if(el.closest('#labelLayer')){leaders++;el.remove();}}
    metrics.leadersRendered=0;document.body.dataset.premiumLeaders='0';captureLayout();updateScale();
    metrics.lastSettleMs=Number((performance.now()-t).toFixed(2));metrics.lastReason='layout';
    return leaders;
  };

  function scheduleSettle(reason='interaction',delay=SETTLE_MS){
    metrics.lastReason=reason;clearTimeout(settleTimer);cancelAnimationFrame(settleRAF);document.body.classList.add('premium-zooming');
    settleTimer=setTimeout(()=>{settleRAF=requestAnimationFrame(()=>{
      document.body.classList.remove('premium-zooming');document.body.classList.add('premium-settling');
      drawLabels();setTimeout(()=>document.body.classList.remove('premium-settling'),180);
    });},delay);
  }
  function fastTransform(reason='transform'){
    metrics.fastTransformCount++;
    const t=`translate(${S.x} ${S.y}) scale(${S.z})`;shapes.setAttribute('transform',t);edges.setAttribute('transform',t);
    fastLabels();$('zoomInfo').textContent=Math.round(S.z*100)+'%';updateScale();scheduleSettle(reason);
  }

  // app.js calls applyTransform for wheel, drag, pinch and buttons. Make that path geometry-only.
  applyTransform=()=>fastTransform('transform');

  // Coalesce a wheel burst into one transform per animation frame. The old bubble listener is stopped
  // in capture phase, so dozens of wheel events cannot trigger dozens of full label layouts.
  map.addEventListener('wheel',e=>{
    e.preventDefault();e.stopImmediatePropagation();metrics.wheelEvents++;wheelDelta+=e.deltaY;
    const r=map.getBoundingClientRect();wheelPoint=[e.clientX-r.left,e.clientY-r.top];
    if(wheelRAF)return;
    wheelRAF=requestAnimationFrame(()=>{
      wheelRAF=0;metrics.wheelFrames++;const d=wheelDelta;wheelDelta=0;const[cx,cy]=wheelPoint||[S.w/2,S.h/2];
      const nz=Math.max(.65,Math.min(24,S.z*Math.exp(-d*.00145))),k=nz/S.z;
      S.x=cx-(cx-S.x)*k;S.y=cy-(cy-S.y)*k;S.z=nz;fastTransform('wheel');
    });
  },{capture:true,passive:false});

  showTip=function(e,f){
    const b=best(f),t=$('tooltip'),school=b.rawU||b.u||'暂无可比最佳高校';
    t.innerHTML=`<span class="premium-tip-region">${esc(f.name)}</span><strong class="premium-tip-school">${esc(school)}</strong>`;
    t.style.display='block';const r=map.getBoundingClientRect();
    t.style.left=Math.max(8,Math.min(r.width-t.offsetWidth-10,e.clientX-r.left+14))+'px';
    t.style.top=Math.max(76,Math.min(r.height-t.offsetHeight-10,e.clientY-r.top+14))+'px';highlight(f.id);
  };

  enter=function(f){const r=baseEnter(f);setTimeout(()=>setDrawer(true),80);return r;};
  navigateID=async function(id){const r=await baseNavigateID(id);setDrawer(true);return r;};

  premiumUi();setDrawer(false);updateScale();
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&drawerOpen)setDrawer(false);});
  window.__premium={metrics,setDrawer,updateScale,settle:()=>drawLabels()};
})();
