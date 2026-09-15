// V5.9.1 sustained interaction gate: exercise many animation frames, not one synthetic burst.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawn,execFileSync} from 'node:child_process';import {pathToFileURL,fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-sustained-')),wait=ms=>new Promise(r=>setTimeout(r,ms));let proc,ws;
async function main(){
 const chrome=process.env.CHROME_BIN||execFileSync('which',['google-chrome'],{encoding:'utf8'}).trim();
 proc=spawn(chrome,['--headless','--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
 const pf=path.join(profile,'DevToolsActivePort');for(let i=0;i<300&&!fs.existsSync(pf);i++)await wait(100);if(!fs.existsSync(pf))throw Error('Chrome startup failed');
 const port=fs.readFileSync(pf,'utf8').split('\n')[0],tabs=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json(),tab=tabs.find(t=>t.type==='page');
 ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no});let seq=0;const pending=new Map(),http=[],errors=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);else if(m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url))http.push(m.params.request.url);};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 const evaljs=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:pathToFileURL(path.join(ROOT,'dist/china-university-atlas.html')).href});let ready=false;for(let i=0;i<300;i++){await wait(100);if(await evaljs('!!window.__atlas&&!!window.__premium')){ready=true;break;}}if(!ready)throw Error('Premium atlas did not boot');await wait(260);
 const before=await evaljs(`(()=>({metrics:{...__premiumMetrics},layouts:__premiumMetrics.layoutCount,labels:document.querySelectorAll('#labelLayer g[data-label-id]').length}))()`);
 /* Dispatch on actual animation frames so the gesture cadence cannot be distorted by background timer
    throttling in headless Chrome. Two wheel packets per frame emulate a high-resolution trackpad; one
    extra RAF lets the map's own wheelRAF consume the last pair before we sample the active state. */
 const gesture=await evaljs(`(async()=>{const m=document.getElementById('map'),r=m.getBoundingClientRect(),t=performance.now();for(let i=0;i<36;i++){await new Promise(requestAnimationFrame);for(let j=0;j<2;j++)m.dispatchEvent(new WheelEvent('wheel',{deltaY:-3.5,clientX:r.left+r.width*.54,clientY:r.top+r.height*.51,bubbles:true,cancelable:true}));}await new Promise(requestAnimationFrame);return{ms:performance.now()-t};})()`);
 const during=await evaljs(`(()=>{const l=document.getElementById('labelLayer'),h=document.querySelector('.header');return{metrics:{...__premiumMetrics},layouts:__premiumMetrics.layoutCount,zooming:document.body.classList.contains('premium-zooming'),labelOpacity:getComputedStyle(l).opacity,labelTransforms:document.querySelectorAll('#labelLayer g[transform]').length,headerBlur:getComputedStyle(h).backdropFilter||getComputedStyle(h).webkitBackdropFilter||'',leaders:document.querySelectorAll('#labelLayer .leader').length};})()`);
 /* Headless Chrome may throttle timers after the gesture finishes, so the exact 80ms phase is
    informational only. What matters for responsiveness is zero full layout while wheel frames are
    flowing, followed by exactly one settle layout after the gesture. */
 await wait(80);
 const preIdle=await evaljs(`(()=>({layouts:__premiumMetrics.layoutCount,zooming:document.body.classList.contains('premium-zooming')}))()`);
 await wait(220);
 const after=await evaljs(`(()=>({metrics:{...__premiumMetrics},layouts:__premiumMetrics.layoutCount,zooming:document.body.classList.contains('premium-zooming'),labels:document.querySelectorAll('#labelLayer g[data-label-id]').length,leaders:document.querySelectorAll('#labelLayer .leader').length}))()`);
 const layoutDuring=during.layouts-before.layouts,layoutBeforeIdle=preIdle.layouts-before.layouts,layoutAfter=after.layouts-before.layouts,frames=after.metrics.wheelFrames-before.metrics.wheelFrames,events=after.metrics.wheelEvents-before.metrics.wheelEvents,maxWork=Number(after.metrics.maxTransformWorkMs||0);
 const checks={sustainedAcrossFrames:frames>=24,eventsDelivered:events===72,noLayoutDuringGesture:layoutDuring===0,oneIdleLayout:layoutAfter===1,labelsNotMovedIndividually:during.labelTransforms===0,labelsSuspended:during.labelOpacity==='0',blurSuspended:/none/.test(during.headerBlur),zeroLeaders:during.leaders===0&&after.leaders===0,transformWorkLight:maxWork<5,offline:http.length===0,runtimeClean:errors.length===0};
 const result={pass:Object.values(checks).every(Boolean),checks,gestureMs:Number(gesture.ms.toFixed(1)),events,frames,layoutDuring,layoutBeforeIdle,layoutAfter,maxTransformWorkMs:Number(maxWork.toFixed(3)),before,during,preIdle,after,httpRequests:http,runtimeErrors:errors,artifact:'dist/china-university-atlas.html'};
 fs.writeFileSync(path.join(ROOT,'reports/premium-sustained.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));await send('Browser.close').catch(()=>{});if(!result.pass)throw Error('Sustained premium interaction test failed');
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>{if(ws)ws.close();if(proc)proc.kill();setTimeout(()=>{try{fs.rmSync(profile,{recursive:true,force:true})}catch{}},400)});
