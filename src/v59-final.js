/* V5.9.2 raster-gesture interaction guard. Loaded after v57-ui.js and before boot(). */
(()=>{
  /* Label packing repeatedly tests the same base-space points against the same rings after zoom.
     Cache those pure point-in-ring answers so idle settles do not walk thousands of vertices again. */
  const rawInRing=inRing,ringCache=new WeakMap();
  inRing=function(pt,ring){
    if(!ring||!pt||!Number.isFinite(pt[0])||!Number.isFinite(pt[1]))return rawInRing(pt,ring);
    let m=ringCache.get(ring);if(!m){m=new Map();ringCache.set(ring,m);}const k=pt[0].toFixed(4)+','+pt[1].toFixed(4);
    if(m.has(k))return m.get(k);const v=rawInRing(pt,ring);if(m.size<768)m.set(k,v);return v;
  };

  if(window.__premiumMetrics)window.__premiumMetrics.version='5.9.2';
  const raster=window.__rasterZoom={version:'5.9.2',snapshotReady:false,active:false,rasterFrames:0,svgFallbackFrames:0,snapshotBuildMs:0,lastFrameMs:0,maxFrameMs:0};
  let wheelRAF=0,wheelDelta=0,wheelPoint=null,settleTimer=0,settleRAF=0,snapshotTimer=0,snapshotToken=0;
  let snap={ready:false,route:'',z:1,x:0,y:0,w:0,h:0,scaleWidth:0};

  function routeKey(){return S.stack.map(n=>n.id).join('>')+`:${S.w}x${S.h}`;}
  function ensureCanvas(){
    let c=document.querySelector('.premium-gesture-canvas');
    if(c)return c;
    c=document.createElement('canvas');c.className='premium-gesture-canvas';c.setAttribute('aria-hidden','true');c.style.pointerEvents='none';
    document.querySelector('.mapcard')?.append(c);return c;
  }
  function syncCanvasBox(c){
    const map=$('map')?.getBoundingClientRect(),card=document.querySelector('.mapcard')?.getBoundingClientRect();if(!map||!card)return;
    c.style.left=(map.left-card.left)+'px';c.style.top=(map.top-card.top)+'px';c.style.width=map.width+'px';c.style.height=map.height+'px';
  }
  async function decodeSvg(blob){
    if('createImageBitmap' in window){try{return await createImageBitmap(blob);}catch(_){}}
    return await new Promise((resolve,reject)=>{const u=URL.createObjectURL(blob),img=new Image();img.onload=()=>{URL.revokeObjectURL(u);resolve(img)};img.onerror=e=>{URL.revokeObjectURL(u);reject(e)};img.src=u;});
  }
  async function refreshSnapshot(){
    const token=++snapshotToken,map=$('map');if(!map||!(S.w>0&&S.h>0))return;
    const key=routeKey(),t0=performance.now(),clone=map.cloneNode(true);
    clone.setAttribute('xmlns',NS);clone.setAttribute('width',String(S.w));clone.setAttribute('height',String(S.h));clone.setAttribute('viewBox',`0 0 ${S.w} ${S.h}`);
    clone.querySelector('#measureLayer')?.remove();clone.querySelector('#labelLayer')?.remove();
    const blob=new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml'});
    let bitmap;try{bitmap=await decodeSvg(blob);}catch(_){raster.snapshotReady=false;snap.ready=false;return;}
    if(token!==snapshotToken||key!==routeKey()){bitmap.close?.();return;}
    const c=ensureCanvas(),dpr=Math.min(2,Math.max(1,window.devicePixelRatio||1));syncCanvasBox(c);c.width=Math.max(1,Math.round(S.w*dpr));c.height=Math.max(1,Math.round(S.h*dpr));
    const ctx=c.getContext('2d',{alpha:false,desynchronized:true});if(!ctx){bitmap.close?.();return;}ctx.setTransform(dpr,0,0,dpr,0,0);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.fillStyle=MAP_STYLE.canvas;ctx.fillRect(0,0,S.w,S.h);ctx.drawImage(bitmap,0,0,S.w,S.h);bitmap.close?.();
    const bar=document.querySelector('.premium-scale-bar');snap={ready:true,route:key,z:S.z,x:S.x,y:S.y,w:S.w,h:S.h,scaleWidth:bar?.getBoundingClientRect().width||0};
    raster.snapshotReady=true;raster.snapshotBuildMs=Number((performance.now()-t0).toFixed(2));
  }
  function queueSnapshot(delay=36){clearTimeout(snapshotTimer);snap.ready=false;raster.snapshotReady=false;snapshotTimer=setTimeout(()=>{(window.requestIdleCallback||((fn)=>setTimeout(fn,0)))(()=>refreshSnapshot(),{timeout:220});},delay);}
  function baselineMatches(){return snap.ready&&snap.route===routeKey()&&Math.abs(snap.z-S.z)<1e-6&&Math.abs(snap.x-S.x)<.05&&Math.abs(snap.y-S.y)<.05;}
  function beginRaster(){
    if(raster.active)return true;if(!baselineMatches())return false;const c=ensureCanvas();syncCanvasBox(c);c.style.transform='translate3d(0,0,0) scale(1)';document.body.classList.add('premium-raster-active');raster.active=true;raster.snapshotReady=true;return true;
  }
  function updateScaleGesture(k){const bar=document.querySelector('.premium-scale-bar');if(!bar||!snap.scaleWidth)return;bar.style.transformOrigin='left center';bar.style.transform=`scaleX(${Math.max(.15,Math.min(8,k)).toFixed(5)})`;}
  function resetScaleGesture(){const bar=document.querySelector('.premium-scale-bar');if(bar)bar.style.transform='';}
  function commitSvgTransform(){const t=`translate(${S.x} ${S.y}) scale(${S.z})`;$('shapes').setAttribute('transform',t);$('edgeLayer').setAttribute('transform',t);}
  function rasterTransform(){
    const c=ensureCanvas(),t0=performance.now(),k=S.z/(snap.z||1),dx=S.x-k*snap.x,dy=S.y-k*snap.y;
    c.style.transform=`translate3d(${dx.toFixed(3)}px,${dy.toFixed(3)}px,0) scale(${k.toFixed(6)})`;updateScaleGesture(k);$('zoomInfo').textContent=Math.round(S.z*100)+'%';raster.rasterFrames++;
    const work=performance.now()-t0;raster.lastFrameMs=work;raster.maxFrameMs=Math.max(raster.maxFrameMs,work);if(window.__premiumMetrics){const m=window.__premiumMetrics;m.fastTransformCount=(m.fastTransformCount||0)+1;m.maxTransformWorkMs=Math.max(m.maxTransformWorkMs||0,work);}
  }
  const scheduleSettle=(reason='interaction',delay=165)=>{
    if(window.__premiumMetrics)window.__premiumMetrics.lastReason=reason;
    clearTimeout(settleTimer);cancelAnimationFrame(settleRAF);document.body.classList.add('premium-zooming');
    settleTimer=setTimeout(()=>{settleRAF=requestAnimationFrame(()=>{
      commitSvgTransform();resetScaleGesture();document.body.classList.remove('premium-zooming');document.body.classList.add('premium-settling');
      drawLabels();document.body.classList.remove('premium-raster-active');raster.active=false;const c=ensureCanvas();c.style.transform='';
      setTimeout(()=>document.body.classList.remove('premium-settling'),150);
    });},delay);
  };

  /* During an active gesture never mutate complex SVG paths. If a pre-rendered snapshot is ready,
     only the canvas texture is translated/scaled; otherwise we keep the old SVG path as a fallback. */
  applyTransform=function(){
    if(raster.active||beginRaster())rasterTransform();
    else{commitSvgTransform();$('zoomInfo').textContent=Math.round(S.z*100)+'%';raster.svgFallbackFrames++;if(window.__premiumMetrics){const m=window.__premiumMetrics;m.fastTransformCount=(m.fastTransformCount||0)+1;}}
    scheduleSettle('transform');
  };

  /* Pointer-down begins a pan while S still matches the idle snapshot. This lets subsequent drag
     updates stay on the raster path even though legacy drag code changes S before calling applyTransform. */
  for(const type of['pointerdown','mousedown','touchstart'])document.addEventListener(type,e=>{if(e.target?.closest?.('#map'))beginRaster();},{capture:true,passive:true});

  /* Own wheel input in document capture before legacy listeners. High-resolution trackpad packets are
     coalesced per display frame; each frame only changes the raster texture plus the zoom number. */
  document.addEventListener('wheel',e=>{
    const map=e.target?.closest?.('#map');if(!map)return;
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();if(!raster.active)beginRaster();
    if(window.__premiumMetrics)window.__premiumMetrics.wheelEvents++;
    wheelDelta+=e.deltaY;const r=map.getBoundingClientRect();wheelPoint=[e.clientX-r.left,e.clientY-r.top];
    if(wheelRAF)return;
    wheelRAF=requestAnimationFrame(()=>{
      wheelRAF=0;if(window.__premiumMetrics)window.__premiumMetrics.wheelFrames++;
      const d=wheelDelta;wheelDelta=0;const p=wheelPoint||[S.w/2,S.h/2],cx=p[0],cy=p[1],nz=Math.max(.65,Math.min(24,S.z*Math.exp(-d*.00145))),k=nz/S.z;
      S.x=cx-(cx-S.x)*k;S.y=cy-(cy-S.y)*k;S.z=nz;applyTransform();
    });
  },{capture:true,passive:false});

  /* Keep the geographic label guard from V5.9.1, but rebuild the raster snapshot only after a full
     idle label layout. A questionable label is hidden; no leader line is ever introduced. */
  const prior=drawLabels;
  drawLabels=function(){
    const result=prior(),map=$('map').getBoundingClientRect(),keep=new Set(),groups=[...$('labelLayer').querySelectorAll('g[data-label-id]')],byId=new Map(S.base.map(x=>[String(x.f.id),x]));
    for(const g of groups){
      const id=String(g.getAttribute('data-label-id')),b=byId.get(id);if(!b){g.remove();continue;}
      const r=g.getBoundingClientRect(),sx=(r.left+r.right)/2-map.left,sy=(r.top+r.bottom)/2-map.top,p=[(sx-S.x)/(S.z||1),(sy-S.y)/(S.z||1)];
      let inside=false;for(const ring of b.rings)if(inRing(p,ring))inside=!inside;if(!inside){g.remove();continue;}keep.add(id);
    }
    if(Array.isArray(S.labels))S.labels=S.labels.filter(x=>keep.has(String(x.id)));S.labelCount=keep.size;
    if(S.labelStats){const removed=Math.max(0,(S.labelStats.shown||0)-keep.size);S.labelStats.shown=keep.size;S.labelStats.hidden=(S.labelStats.hidden||0)+removed;S.labelStats.leaders=0;S.labelStats.displaced=0;}
    document.body.dataset.premiumLeaders='0';queueSnapshot();return result;
  };
})();
