// V5.9 Premium Atlas UI layer. Loaded after all feature layers and before boot().
// Owns presentation/interaction only; data, sources and winner semantics stay in their existing layers.
(() => {
  const originalReadEmbeddedJson = readEmbeddedJson;
  readEmbeddedJson = async function(id) {
    const el=$(id),encodedBytes=el?.textContent?.length||0,value=await originalReadEmbeddedJson(id);
    if(el){el.textContent='';el.dataset.released='true';el.dataset.encodedBytes=String(encodedBytes);}return value;
  };

  const originalUpdateCacheStatus=updateCacheStatus;
  updateCacheStatus=function(){
    originalUpdateCacheStatus();const st=D?.stats||{};
    $('cacheStatus').textContent=`单文件离线 · ${Object.keys(CACHE).length} 份边界 · ${st.ordinarySchools||0} 所普通高校 · ${(D?.campuses||[]).length} 条办学地点`;
    $('modeBadge').textContent='离线可用';$('modeBadge').title='全部运行数据均已内嵌；正常浏览 0 HTTP';
    const legend=$('legendSwatches');
    if(legend&&!legend.querySelector('i')){
      legend.innerHTML=palette.map(c=>`<i style="background:${c}"></i>`).join('')+' 色块仅区分相邻行政区';
      const zoom=$('zoomInfo');if(zoom&&!document.querySelector('.legendkey'))zoom.insertAdjacentHTML('afterend','<span class="legendrow"><span class="legendkey"><b class="k-region">地区</b> · <b class="k-uni">最佳高校</b></span><span class="legendpins" hidden><i class="kp-verified"></i>已核对地点 <i class="kp-caution"></i>待核验地点</span></span>');
    }
  };

  // ---------------------------------------------------------------------
  // Zero-leader label engine. Labels live in screen space, use constant type size across zoom,
  // and are accepted only when their whole box fits inside the administrative polygon.
  // ---------------------------------------------------------------------
  const boxesOverlap=(a,b,g=0)=>!(a.r+g<b.l||a.l-g>b.r||a.b+g<b.t||a.t-g>b.b);
  const basePointInside=(b,x,y)=>{let inside=false;for(const ring of b.rings)if(inRing([x,y],ring))inside=!inside;return inside;};
  const screenPointInside=(b,sx,sy)=>basePointInside(b,(sx-S.x)/(S.z||1),(sy-S.y)/(S.z||1));
  const boxInsideRegion=(b,box)=>{
    const inset=1.1,xs=[box.l+inset,(box.l+box.r)/2,box.r-inset],ys=[box.t+inset,(box.t+box.b)/2,box.b-inset];
    return xs.every(x=>ys.every(y=>screenPointInside(b,x,y)));
  };
  const uiRectsInMap=()=>{
    const m=$('map').getBoundingClientRect(),out=[];
    for(const sel of ['.header','.maphead','.mapcontrols','.legend','.modebadge','.premium-scale'])for(const el of document.querySelectorAll(sel)){
      if(!el.getClientRects().length)continue;const r=el.getBoundingClientRect();out.push({l:r.left-m.left-4,r:r.right-m.left+4,t:r.top-m.top-4,b:r.bottom-m.top+4});
    }
    if(S.insetBox)out.push(S.insetBox);return out;
  };
  const ringBounds=r=>{let l=Infinity,t=Infinity,rr=-Infinity,b=-Infinity;for(const p of r){l=Math.min(l,p[0]);t=Math.min(t,p[1]);rr=Math.max(rr,p[0]);b=Math.max(b,p[1]);}return{l,t,r:rr,b};};
  function candidateCentres(b){
    const anchor=[b.cp[0]*S.z+S.x,b.cp[1]*S.z+S.y],out=[anchor],seen=new Set([anchor.map(v=>v.toFixed(1)).join(',')]);
    let l=Infinity,t=Infinity,r=-Infinity,bb=-Infinity;for(const ring of b.rings){const q=ringBounds(ring);l=Math.min(l,q.l);t=Math.min(t,q.t);r=Math.max(r,q.r);bb=Math.max(bb,q.b);}
    const nx=10,ny=10;for(let iy=0;iy<=ny;iy++)for(let ix=0;ix<=nx;ix++){
      const bx=l+(r-l)*ix/nx,by=t+(bb-t)*iy/ny;if(!basePointInside(b,bx,by))continue;
      const p=[bx*S.z+S.x,by*S.z+S.y],key=p.map(v=>v.toFixed(1)).join(',');if(!seen.has(key)){seen.add(key);out.push(p);}
    }
    out.sort((a,bp)=>(a[0]-anchor[0])**2+(a[1]-anchor[1])**2-((bp[0]-anchor[0])**2+(bp[1]-anchor[1])**2));return out;
  }
  function premiumLines(b,nation,includeUni,font){
    const regionFont=font*.91,regionMax=regionFont*(nation?5.4:7),uniMax=font*(nation?7.2:9.2);
    const names=wrapText(nation?short(b.f.name):b.f.name,regionMax,regionFont,650);
    if(!names.length)return[];const lines=names.map(t=>({t,fs:regionFont,c:'#26333b',w:650,role:'region'}));
    if(includeUni&&b.best.u){const us=wrapText(b.best.u,uniMax,font,760);if(!us.length)return[];for(const t of us)lines.push({t,fs:font,c:'#a82b21',w:760,role:'uni'});}
    return lines;
  }
  function makeLabel(b,nation,includeUni,font){
    const lines=premiumLines(b,nation,includeUni,font);if(!lines.length)return null;
    const width=Math.max(...lines.map(l=>textWidth(l.t,l.fs,l.w)))+10,height=lines.reduce((s,l)=>s+l.fs*1.18,0)+7;
    return{lines,width,height,font};
  }
  function placeInside(b,label,accepted,ui){
    for(const [cx,cy] of candidateCentres(b)){
      const box={l:cx-label.width/2,r:cx+label.width/2,t:cy-label.height/2,b:cy+label.height/2};
      if(box.l<4||box.r>S.w-4||box.t<4||box.b>S.h-4)continue;
      if(ui.some(x=>boxesOverlap(box,x,2))||accepted.some(x=>boxesOverlap(box,x,3)))continue;
      if(!boxInsideRegion(b,box))continue;return{box,cx,cy};
    }return null;
  }

  drawLabels=function(){
    const g=$('labelLayer');g.innerHTML='';const nation=current().kind==='country',ui=uiRectsInMap(),accepted=[];
    const vp=Math.min(1,Math.max(.80,S.w/1073)),slider=Number($('fontSize').value)/100,density=S.base.filter(b=>b.f.name).length<=8?1.07:1;
    const baseFont=Math.max(9.6,(nation?12.2:13.2)*slider*vp*density),scales=[1,.94,.88,.82];
    const items=S.base.filter(b=>b.f.name).map(b=>({...b,best:best(b.f)})).sort((a,b)=>a.area-b.area||a.f.name.length-b.f.name.length);
    let shown=0,nameOnly=0,uniLabels=0,minFont=Infinity;S.labels=[];
    for(const b of items){
      const anchor=[b.cp[0]*S.z+S.x,b.cp[1]*S.z+S.y];if(anchor[0]<-120||anchor[1]<-120||anchor[0]>S.w+120||anchor[1]>S.h+120)continue;
      let selected=null,wantUni=!!($('showUni').checked&&b.best.u);
      for(const withUni of wantUni?[true,false]:[false]){
        for(const scale of scales){const font=baseFont*scale,label=makeLabel(b,nation,withUni,font);if(!label)continue;const hit=placeInside(b,label,accepted,ui);if(hit){selected={...hit,label,withUni,font};break;}}
        if(selected)break;
      }
      if(!selected)continue;accepted.push(selected.box);S.labels.push({...selected.box,id:b.f.id,anchor});shown++;minFont=Math.min(minFont,...selected.label.lines.map(l=>l.fs));
      if(selected.withUni)uniLabels++;else if(b.best.u)nameOnly++;
      const group=E('g',{'data-label-id':b.f.id,'data-name-only':selected.withUni?'0':'1','data-place-tier':'1'});
      let y=selected.cy-selected.label.height/2+5;
      for(const line of selected.label.lines){y+=line.fs*1.02;group.append(E('text',{x:selected.cx,y,'text-anchor':'middle','font-size':line.fs.toFixed(2),'font-weight':line.w,'font-family':FONT_STACK,fill:line.c,stroke:'#ffffff','stroke-width':Math.min(1.7,Math.max(.9,line.fs*.10)).toFixed(2),'stroke-linejoin':'round','paint-order':'stroke fill'},line.t));y+=line.fs*.16;}
      g.append(group);
    }
    if(current().kind==='district')drawCampusPins(g);S.labelCount=shown;
    S.labelStats={shown,hidden:items.length-shown,nameOnly,uniLabels,leaders:0,displaced:0,minFont:Number.isFinite(minFont)?minFont:null};
    window.__labelPlacementStats=S.labelStats;
  };

  // Local views draw only the parent outline; the national silhouette keeps its underlay fill.
  drawEdges=function(nation,scale,tx,ty){
    const g=$('edgeLayer');g.innerHTML='';let rings;
    if(nation)rings=S.base.filter(b=>b.f.name).flatMap(b=>b.rings);else{const par=current().f;if(!par)return;rings=par.rings.map(r=>r.map(p=>{const q=project(p);return[q[0]*scale+tx,q[1]*scale+ty];}));}
    if(!rings.length)return;const d=rings.map(r=>'M'+r.map(p=>p[0].toFixed(2)+','+p[1].toFixed(2)).join('L')+'Z').join('');
    g.append(E('path',{d,fill:nation?MAP_STYLE.edge:'none',stroke:MAP_STYLE.edge,'stroke-width':4.2,'stroke-linejoin':'round','fill-rule':'evenodd','vector-effect':'non-scaling-stroke','pointer-events':'none'}));
  };

  // ---------------------------------------------------------------------
  // Premium chrome, drawer, dynamic scale and deferred interaction.
  // ---------------------------------------------------------------------
  const premiumMetrics=window.__premiumMetrics={version:'5.9.0',layoutCount:0,fastTransformCount:0,wheelEvents:0,wheelFrames:0,leadersRendered:0,lastSettleMs:0,lastReason:'boot'};
  const baseDrawLabels=drawLabels,baseShowTip=showTip,baseEnter=enter,baseNavigateID=navigateID,baseSelfTest=selfTest;
  const SETTLE_MS=150;let layoutState=null,labelBaseline=[],pinBaseline=[],settleTimer=0,settleRAF=0,wheelRAF=0,wheelDelta=0,wheelPoint=null,drawerOpen=false;

  function premiumUi(){
    const actions=document.querySelector('.actions');if(actions&&!$('premiumPanelBtn')){const b=document.createElement('button');b.id='premiumPanelBtn';b.className='premium-panel-toggle';b.textContent='浏览';b.setAttribute('aria-label','打开地区与高校列表');b.setAttribute('aria-expanded','false');b.onclick=()=>setDrawer(!drawerOpen);actions.append(b);}
    const side=document.querySelector('.side');if(side&&!side.querySelector('.premium-drawer-close')){const b=document.createElement('button');b.className='premium-drawer-close';b.textContent='×';b.setAttribute('aria-label','关闭地区与高校列表');b.onclick=()=>setDrawer(false);side.prepend(b);}
    if(!document.querySelector('.premium-scrim')){const s=document.createElement('div');s.className='premium-scrim';s.onclick=()=>setDrawer(false);document.body.append(s);}
    if(!document.querySelector('.premium-scale')){const el=document.createElement('div');el.className='premium-scale';el.setAttribute('aria-hidden','true');el.innerHTML='<div class="premium-scale-bar"></div><div class="premium-scale-label"></div>';document.querySelector('.mapcard')?.append(el);}
  }
  function setDrawer(open){drawerOpen=!!open;document.querySelector('.side')?.classList.toggle('premium-open',drawerOpen);document.querySelector('.premium-scrim')?.classList.toggle('open',drawerOpen);$('premiumPanelBtn')?.setAttribute('aria-expanded',String(drawerOpen));}
  function niceDistance(v){if(!(v>0))return 0;const p=10**Math.floor(Math.log10(v)),q=v/p;return(q>=5?5:q>=2?2:1)*p;}
  function updateScale(){
    const el=document.querySelector('.premium-scale');if(!el||!S.projection||!(S.z>0)){if(el)el.style.display='none';return;}
    const node=current(),cp=node?.f?.cp||[105,35],lon=Number(cp?.[0])||105,lat=Math.max(5,Math.min(60,Number(cp?.[1])||35)),a=project([lon,lat]),b=project([lon+1,lat]);
    const px=Math.hypot(b[0]-a[0],b[1]-a[1])*S.projection.scale*S.z,km=111.32*Math.cos(lat*Math.PI/180);if(!(px>0&&km>0)){el.style.display='none';return;}
    const kmPx=km/px,nice=niceDistance(kmPx*92),width=Math.max(38,Math.min(160,nice/kmPx));el.style.display='block';el.querySelector('.premium-scale-bar').style.width=width.toFixed(1)+'px';el.querySelector('.premium-scale-label').textContent=nice>=1?`${Math.round(nice)} km`:`${Math.round(nice*1000)} m`;
  }
  const currentAnchor=b=>[b.cp[0]*S.z+S.x,b.cp[1]*S.z+S.y];
  function captureLayout(){
    layoutState={z:S.z,x:S.x,y:S.y};labelBaseline=[];
    for(const g of labels.querySelectorAll('g[data-label-id]')){const b=S.base.find(x=>String(x.f.id)===String(g.getAttribute('data-label-id')));if(!b)continue;labelBaseline.push({g,b,anchor:currentAnchor(b)});}
    pinBaseline=[...labels.querySelectorAll('.campuspin,.campuspin-hit')].map(el=>({el,x:Number(el.getAttribute('cx')),y:Number(el.getAttribute('cy'))}));
  }
  function fromLayout(x,y){if(!layoutState)return[x,y];const k=S.z/layoutState.z;return[S.x+k*(x-layoutState.x),S.y+k*(y-layoutState.y)];}
  function fastLabels(){if(!layoutState)return;for(const rec of labelBaseline){const now=currentAnchor(rec.b);rec.g.setAttribute('transform',`translate(${(now[0]-rec.anchor[0]).toFixed(2)} ${(now[1]-rec.anchor[1]).toFixed(2)})`);}for(const pin of pinBaseline){const p=fromLayout(pin.x,pin.y);pin.el.setAttribute('cx',p[0].toFixed(2));pin.el.setAttribute('cy',p[1].toFixed(2));}}
  function clearTransient(){for(const rec of labelBaseline)rec.g.removeAttribute('transform');for(const pin of pinBaseline){pin.el.setAttribute('cx',pin.x);pin.el.setAttribute('cy',pin.y);}}

  drawLabels=function(){
    clearTimeout(settleTimer);cancelAnimationFrame(settleRAF);clearTransient();const t=performance.now();premiumMetrics.layoutCount++;baseDrawLabels();
    for(const el of [...$('labelLayer').querySelectorAll('.leader,line.leader,circle.leader')])el.remove();premiumMetrics.leadersRendered=0;document.body.dataset.premiumLeaders='0';captureLayout();updateScale();premiumMetrics.lastSettleMs=Number((performance.now()-t).toFixed(2));return S.labelCount;
  };
  function scheduleSettle(reason='interaction',delay=SETTLE_MS){premiumMetrics.lastReason=reason;clearTimeout(settleTimer);cancelAnimationFrame(settleRAF);document.body.classList.add('premium-zooming');settleTimer=setTimeout(()=>{settleRAF=requestAnimationFrame(()=>{document.body.classList.remove('premium-zooming');document.body.classList.add('premium-settling');drawLabels();setTimeout(()=>document.body.classList.remove('premium-settling'),180);});},delay);}
  function fastTransform(reason='transform'){premiumMetrics.fastTransformCount++;const t=`translate(${S.x} ${S.y}) scale(${S.z})`;$('shapes').setAttribute('transform',t);$('edgeLayer').setAttribute('transform',t);fastLabels();$('zoomInfo').textContent=Math.round(S.z*100)+'%';updateScale();scheduleSettle(reason);}
  applyTransform=()=>fastTransform('transform');

  $('map').addEventListener('wheel',e=>{
    e.preventDefault();e.stopImmediatePropagation();premiumMetrics.wheelEvents++;wheelDelta+=e.deltaY;const r=$('map').getBoundingClientRect();wheelPoint=[e.clientX-r.left,e.clientY-r.top];if(wheelRAF)return;
    wheelRAF=requestAnimationFrame(()=>{wheelRAF=0;premiumMetrics.wheelFrames++;const d=wheelDelta;wheelDelta=0,[cx,cy]=wheelPoint||[S.w/2,S.h/2],nz=Math.max(.65,Math.min(24,S.z*Math.exp(-d*.00145))),k=nz/S.z;S.x=cx-(cx-S.x)*k;S.y=cy-(cy-S.y)*k;S.z=nz;fastTransform('wheel');});
  },{capture:true,passive:false});

  showTip=function(e,f){const b=best(f),t=$('tooltip'),school=b.rawU||b.u||'暂无可比最佳高校';t.innerHTML=`<span class="premium-tip-region">${esc(f.name)}</span><strong class="premium-tip-school">${esc(school)}</strong>`;t.style.display='block';const r=$('map').getBoundingClientRect();t.style.left=Math.max(8,Math.min(r.width-t.offsetWidth-10,e.clientX-r.left+14))+'px';t.style.top=Math.max(76,Math.min(r.height-t.offsetHeight-10,e.clientY-r.top+14))+'px';highlight(f.id);};
  enter=function(f){const r=baseEnter(f);setTimeout(()=>setDrawer(true),80);return r;};
  navigateID=async function(id){const r=await baseNavigateID(id);setDrawer(true);return r;};

  selfTest=async function(){const r=await baseSelfTest();r.errors=(r.errors||[]).filter(e=>e!=='font scaling');r.fontStable=Math.abs(Number(r.fontAfter)-Number(r.fontBefore))<.75;if(!r.fontStable)r.errors.push('font not stable');r.pass=!r.errors.length;return r;};

  const originalBoot=boot;
  boot=async function(){
    const splash=$('bootSplash'),txt=$('bootSplashText'),started=performance.now();if(txt)txt.textContent='正在解压内嵌高校与行政区数据…';await originalBoot();
    const ok=!!D&&Object.keys(CACHE||{}).length>0,ms=Math.round(performance.now()-started);window.__bootMetrics={ms,ok,schoolPayloadReleased:$('schoolData')?.dataset.released==='true',geoPayloadReleased:$('geoData')?.dataset.released==='true'};
    const avoid=$('avoid');if(avoid?.closest('label'))avoid.closest('label').hidden=true;premiumUi();setDrawer(false);updateScale();
    const p=[...document.querySelectorAll('#dataDialog p')].find(x=>x.textContent.includes('地图标签会先根据校名长度自动缩字号')||x.textContent.includes('地图标签固定在所属行政区内部'));
    if(p)p.innerHTML='<b>县区规则：</b>继续按具体校园物理位置展示；只有县区归属线索、没有校园门牌时，单独记为“县区归属依据”，不造坐标。地图标签保持屏幕字号稳定并只放在所属行政区内部；空间不足时先省略高校名，再隐藏标签，不再跨区拉引导线。';
    if(ok){document.body.classList.add('app-ready');document.body.dataset.bootMs=String(ms);if(splash)splash.hidden=true;}else if(splash){splash.classList.add('error');if(txt)txt.textContent='离线数据打开失败，请使用最新版现代浏览器。';}
    window.__premium={metrics:premiumMetrics,setDrawer,updateScale,settle:()=>drawLabels()};
  };

  document.addEventListener('keydown',e=>{const target=e.target,typing=target&&['INPUT','TEXTAREA','SELECT'].includes(target.tagName);if(e.key==='/'&&!typing&&!document.querySelector('dialog[open]')){e.preventDefault();$('search')?.focus();$('search')?.select();}if(e.key==='Escape'&&drawerOpen)setDrawer(false);});
})();
