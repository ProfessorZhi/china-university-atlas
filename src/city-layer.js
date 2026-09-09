// V5.3: a university has one host city at city-ranking level.
// Physical branch campuses remain visible at district level; city hover can disclose two external tiers.
function cityAffiliatesFor(p,c){return(D.cityAffiliates||{})[keyOf(p,c)]||null;}
function hasCityAffiliates(a){return!!a&&((a.undergraduate||[]).length>0||(a.graduate||[]).length>0);}
function localCityRows(p,c){return(UIX.get(keyOf(p,c))||[]).filter(allowed).map(u=>({...u,campuses:[],associations:[],branch:false})).sort(compareU);}
function schoolRows(p,c='',d=''){
  if(c&&!d)return localCityRows(p,c);
  const map=new Map(),cr=campusRows(p,c,d),ar=associationRows(p,c,d);
  for(const u of UIX.get(keyOf(p,c,d))||[])if(allowed(u))map.set(u.id,{...u,campuses:[],associations:[],branch:false});
  for(const r of cr){const u=UM.get(r.uid);if(!u)continue;if(!map.has(u.id))map.set(u.id,{...u,campuses:[],associations:[],branch:!!d&&(u.p!==p||u.c!==c)});map.get(u.id).campuses.push(r);}
  for(const a of ar){const u=UM.get(a.uid);if(!u)continue;if(!map.has(u.id))map.set(u.id,{...u,campuses:[],associations:[],branch:false});map.get(u.id).associations.push(a);}
  const rows=[...map.values()];return rows.sort((a,b)=>d?((b.campuses.length>0)-(a.campuses.length>0)||compareU(a,b)):compareU(a,b));
}
function best(f,node=current()){
  const l=locationFor(f,node),isP=node.kind==='country';
  if(node.kind==='province'&&f.level==='city'){
    const rs=localCityRows(l.p,l.c),extra=cityAffiliatesFor(l.p,l.c),showExtra=$('includeBranch').checked&&hasCityAffiliates(extra);
    if(rs.length){const u=rs[0];return{u:u.u+(showExtra?'＋':''),rawU:u.u,uid:u.id,level:u.level,cityAffiliates:showExtra?extra:null,meta:[u.level,u.level==='专科'?'专科补位':'',rawRank(u),showExtra?'有异地办学层级 · 悬浮查看':'本地主体高校'].filter(Boolean).join(' · '),count:rs.length,sample:false};}
    return{u:'',meta:showExtra?'本地主体高校尚未匹配 · 有异地办学层级，悬浮查看':'本地主体高校尚未匹配',count:0,cityAffiliates:showExtra?extra:null};
  }
  let rs;if(isP)rs=(UIX.get(keyOf(f.name))||[]).filter(allowed).slice().sort(compareU);else rs=schoolRows(l.p,l.c,(node.kind==='city'&&node.noChildren)?'':l.d);
  if(rs.length){const exact=l.d?rs.filter(x=>x.campuses?.length):rs,pool=exact.length?exact:rs,u=pool[0],cp=u.campuses?.[0],a=u.associations?.[0];return{u:u.u,rawU:u.u,uid:u.id,level:u.level,meta:[u.level,u.level==='专科'?'专科补位':'',rawRank(u),cp?quality(cp):a?'县区归属依据 · 非精确校区地址':'名录所在地'].filter(Boolean).join(' · '),sample:!!cp,campus:cp,count:rs.length,uncertain:!!a||!!cp&&!cp.verified};}
  if(isP&&D.provinceBest[f.name])return{u:D.provinceBest[f.name],rawU:D.provinceBest[f.name],meta:'沿用参考标签；港澳台名录尚未系统纳入',count:0,sample:false};
  return{u:'',meta:l.d?'尚无校区或县区归属证据；不代表当地没有高校':'当前口径未匹配本地主体高校；不代表当地没有高校',count:0,sample:false};
}
function affiliateLines(a){const lines=[];if(a?.undergraduate?.length)lines.push(['本科异地办学',a.undergraduate.map(x=>x.name).join('、')]);if(a?.graduate?.length)lines.push(['研究生办学',a.graduate.map(x=>x.name).join('、')]);return lines;}
function showTip(e,f){
  const b=best(f),t=$('tooltip'),main=b.rawU||b.u||'本地主体高校待补',tiers=affiliateLines(b.cityAffiliates);
  let html=`<strong>${esc(f.name)}</strong><br><b>${esc(main)}</b><br><span style="opacity:.75">${esc(b.meta)}</span>`;
  if(tiers.length)html+='<div class="citytiers">'+tiers.map(([k,v])=>`<div><em>${esc(k)}</em><br>${esc(v)}</div>`).join('')+'</div>';
  t.innerHTML=html;t.style.display='block';const r=$('map').getBoundingClientRect();t.style.left=Math.max(5,Math.min(r.width-t.offsetWidth-8,e.clientX-r.left+15))+'px';t.style.top=Math.max(7,Math.min(r.height-t.offsetHeight-8,e.clientY-r.top+15))+'px';highlight(f.id);
}
function drawLabels(){
  const g=$('labelLayer');g.innerHTML='';const nation=current().kind==='country',baseFont=Math.max(8,Math.min(24,(nation?11.3:12.7)*Number($('fontSize').value)/100*Math.pow(S.z,.38))),avoid=$('avoid').checked,accepted=[];
  if(nation&&S.insetBox)accepted.push(S.insetBox);const controlRect=document.querySelector('.mapcontrols').getBoundingClientRect(),mapRect=$('map').getBoundingClientRect();accepted.push({l:controlRect.left-mapRect.left-3,r:controlRect.right-mapRect.left+3,t:controlRect.top-mapRect.top-3,b:controlRect.bottom-mapRect.top+3});
  const items=S.base.filter(b=>b.f.name).map(b=>({...b,best:best(b.f)})).sort((a,b)=>Number(!!b.best.u)-Number(!!a.best.u)||b.area-a.area);let shown=0;S.labels=[];
  for(const b of items){const x=b.cp[0]*S.z+S.x,y=b.cp[1]*S.z+S.y;if(x<-100||y<-100||x>S.w+100||y>S.h+100)continue;const longest=Math.max(b.f.name.length,(b.best.u||'').length),start=longest>=13?.72:longest>=10?.80:longest>=8?.9:1,factors=[start,start*.9,start*.8,start*.7,.62];let selected=null;
    for(const factor of factors){const font=Math.max(7.2,baseFont*factor),names=wrap(nation?short(b.f.name):b.f.name,11),us=$('showUni').checked&&b.best.u?wrap(b.best.u,nation?8:10):[],lines=names.map(t=>({t,fs:font*.91,c:'#274b5a',w:650})).concat(us.map(t=>({t,fs:font,c:'#c62d28',w:800}))),width=Math.max(...lines.map(l=>textWidth(l.t,l.fs,l.w)))+8,height=lines.length*font*1.23+4;let offsets=[[0,0],[0,-15],[0,15],[-22,0],[22,0],[0,-30],[0,30],[-40,-20],[40,-20],[-40,20],[40,20],[-60,0],[60,0]];if(S.z>1.6)offsets=offsets.slice(0,7);for(const[dx,dy]of offsets){const box={l:x+dx-width/2,r:x+dx+width/2,t:y+dy-height/2,b:y+dy+height/2};if(box.l<3||box.r>S.w-3||box.t<110||box.b>S.h-35)continue;if(!avoid||!accepted.some(a=>!(box.r+2<a.l||box.l-2>a.r||box.b+2<a.t||box.t-2>a.b))){selected={...box,dx,dy,font,lines,height};break;}}if(selected)break;}
    if(!selected)continue;accepted.push(selected);S.labels.push(selected);shown++;if(Math.abs(selected.dx)+Math.abs(selected.dy)>20){g.append(E('line',{x1:x,y1:y,x2:x+selected.dx,y2:y+selected.dy,stroke:'#648896','stroke-width':.65,opacity:.75}));g.append(E('circle',{cx:x,cy:y,r:1.8,fill:'#648896'}));}const group=E('g',{'data-label-id':b.f.id});selected.lines.forEach((l,i)=>group.append(E('text',{x:x+selected.dx,y:y+selected.dy-selected.height/2+selected.font*1.05+i*selected.font*1.23,'text-anchor':'middle','font-size':l.fs.toFixed(2),'font-weight':l.w,'font-family':'"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif',fill:l.c,stroke:'#ffffff','stroke-width':2.4,'stroke-linejoin':'round','paint-order':'stroke fill'},l.t)));g.append(group);
  }
  if(current().kind==='district')drawCampusPins(g);S.labelCount=shown;
}
