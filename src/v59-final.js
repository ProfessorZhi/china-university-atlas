/* V5.9.1 interaction guard. Loaded after v57-ui.js and before boot(). */
(()=>{
  /* Label packing tests the same base-space points against the same polygon rings after every zoom.
     Cache those pure point-in-ring answers so an idle settle does not repeatedly walk thousands of
     vertices. WeakMap keeps the cache tied to the ring lifetime; the small cap prevents unbounded
     growth if a user generates unusual free-form coordinates. */
  const rawInRing=inRing,ringCache=new WeakMap();
  inRing=function(pt,ring){
    if(!ring||!pt||!Number.isFinite(pt[0])||!Number.isFinite(pt[1]))return rawInRing(pt,ring);
    let m=ringCache.get(ring);if(!m){m=new Map();ringCache.set(ring,m);}const k=pt[0].toFixed(4)+','+pt[1].toFixed(4);
    if(m.has(k))return m.get(k);const v=rawInRing(pt,ring);if(m.size<768)m.set(k,v);return v;
  };

  let wheelRAF=0,wheelDelta=0,wheelPoint=null,settleTimer=0,settleRAF=0;
  const scheduleSettle=(reason='interaction',delay=180)=>{
    if(window.__premiumMetrics)window.__premiumMetrics.lastReason=reason;
    clearTimeout(settleTimer);cancelAnimationFrame(settleRAF);document.body.classList.add('premium-zooming');
    settleTimer=setTimeout(()=>{settleRAF=requestAnimationFrame(()=>{
      document.body.classList.remove('premium-zooming');document.body.classList.add('premium-settling');
      drawLabels();setTimeout(()=>document.body.classList.remove('premium-settling'),160);
    });},delay);
  };
  /* Real trackpads produce wheel batches on many consecutive display frames. V5.9 still moved every
     label and recomputed the scale bar on each of those frames, while translucent chrome forced the
     browser to re-blur moving map pixels underneath. During an active gesture we now touch only the
     two map geometry groups plus the tiny numeric zoom indicator; labels are hidden and rebuilt once
     after idle. */
  applyTransform=function(){
    const t0=performance.now(),t=`translate(${S.x} ${S.y}) scale(${S.z})`;
    $('shapes').setAttribute('transform',t);$('edgeLayer').setAttribute('transform',t);
    $('zoomInfo').textContent=Math.round(S.z*100)+'%';
    if(window.__premiumMetrics){const m=window.__premiumMetrics;m.fastTransformCount=(m.fastTransformCount||0)+1;m.maxTransformWorkMs=Math.max(m.maxTransformWorkMs||0,performance.now()-t0);}
    scheduleSettle('transform');
  };

  /* Own wheel input in document capture, before legacy map listeners. Multiple events arriving before
     the next paint are coalesced into one geometry update. Sustained gestures still yield multiple
     animation frames, but each frame follows the compositor-light path above. */
  document.addEventListener('wheel',e=>{
    const map=e.target?.closest?.('#map');if(!map)return;
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
    if(window.__premiumMetrics)window.__premiumMetrics.wheelEvents++;
    wheelDelta+=e.deltaY;const r=map.getBoundingClientRect();wheelPoint=[e.clientX-r.left,e.clientY-r.top];
    if(wheelRAF)return;
    wheelRAF=requestAnimationFrame(()=>{
      wheelRAF=0;if(window.__premiumMetrics)window.__premiumMetrics.wheelFrames++;
      const d=wheelDelta;wheelDelta=0;const p=wheelPoint||[S.w/2,S.h/2],cx=p[0],cy=p[1];
      const nz=Math.max(.65,Math.min(24,S.z*Math.exp(-d*.00145))),k=nz/S.z;
      S.x=cx-(cx-S.x)*k;S.y=cy-(cy-S.y)*k;S.z=nz;applyTransform();
    });
  },{capture:true,passive:false});

  /* The layout engine allows a tiny predictive corner tolerance on jagged borders. Verify rendered
     centres once after layout. Use a map lookup rather than S.base.find() per label; this removes the
     old O(labels × regions) post-pass. A questionable label is hidden, never wired. */
  const prior=drawLabels;
  drawLabels=function(){
    const result=prior(),map=$('map').getBoundingClientRect(),keep=new Set(),groups=[...$('labelLayer').querySelectorAll('g[data-label-id]')],byId=new Map(S.base.map(x=>[String(x.f.id),x]));
    for(const g of groups){
      const id=String(g.getAttribute('data-label-id')),b=byId.get(id);if(!b){g.remove();continue;}
      const r=g.getBoundingClientRect(),sx=(r.left+r.right)/2-map.left,sy=(r.top+r.bottom)/2-map.top,p=[(sx-S.x)/(S.z||1),(sy-S.y)/(S.z||1)];
      let inside=false;for(const ring of b.rings)if(inRing(p,ring))inside=!inside;
      if(!inside){g.remove();continue;}keep.add(id);
    }
    if(Array.isArray(S.labels))S.labels=S.labels.filter(x=>keep.has(String(x.id)));S.labelCount=keep.size;
    if(S.labelStats){const removed=Math.max(0,(S.labelStats.shown||0)-keep.size);S.labelStats.shown=keep.size;S.labelStats.hidden=(S.labelStats.hidden||0)+removed;S.labelStats.leaders=0;S.labelStats.displaced=0;}
    document.body.dataset.premiumLeaders='0';return result;
  };
})();
