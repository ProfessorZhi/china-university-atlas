/* V5.9 final interaction guard. Loaded after v57-ui.js and before boot(). */
(()=>{
  // Document-capture runs before the legacy map-target wheel listeners. It owns wheel input entirely,
  // updates the same shared S state, then calls V5.9's cheap applyTransform path.
  let raf=0,delta=0,point=null;
  document.addEventListener('wheel',e=>{
    const map=e.target?.closest?.('#map');if(!map)return;
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
    if(window.__premiumMetrics)window.__premiumMetrics.wheelEvents++;
    delta+=e.deltaY;const r=map.getBoundingClientRect();point=[e.clientX-r.left,e.clientY-r.top];
    if(raf)return;
    raf=requestAnimationFrame(()=>{
      raf=0;if(window.__premiumMetrics)window.__premiumMetrics.wheelFrames++;
      const d=delta;delta=0;const p=point||[S.w/2,S.h/2],cx=p[0],cy=p[1];
      const nz=Math.max(.65,Math.min(24,S.z*Math.exp(-d*.00145))),k=nz/S.z;
      S.x=cx-(cx-S.x)*k;S.y=cy-(cy-S.y)*k;S.z=nz;applyTransform();
    });
  },{capture:true,passive:false});

  // The layout engine permits a tiny corner spill on jagged boundaries. The rendered text bbox can
  // differ from the predictive box by a pixel or two because of font ascenders, so verify the final
  // rendered centre as a last geographic truth check. A questionable label is hidden, never wired.
  const prior=drawLabels;
  drawLabels=function(){
    const result=prior(),map=$('map').getBoundingClientRect(),keep=new Set(),groups=[...$('labelLayer').querySelectorAll('g[data-label-id]')];
    for(const g of groups){
      const id=String(g.getAttribute('data-label-id')),b=S.base.find(x=>String(x.f.id)===id);if(!b){g.remove();continue;}
      const r=g.getBoundingClientRect(),sx=(r.left+r.right)/2-map.left,sy=(r.top+r.bottom)/2-map.top,p=[(sx-S.x)/(S.z||1),(sy-S.y)/(S.z||1)];
      let inside=false;for(const ring of b.rings)if(inRing(p,ring))inside=!inside;
      if(!inside){g.remove();continue;}keep.add(id);
    }
    if(Array.isArray(S.labels))S.labels=S.labels.filter(x=>keep.has(String(x.id)));S.labelCount=keep.size;
    if(S.labelStats){const removed=Math.max(0,(S.labelStats.shown||0)-keep.size);S.labelStats.shown=keep.size;S.labelStats.hidden=(S.labelStats.hidden||0)+removed;S.labelStats.leaders=0;S.labelStats.displaced=0;}
    document.body.dataset.premiumLeaders='0';return result;
  };
})();
