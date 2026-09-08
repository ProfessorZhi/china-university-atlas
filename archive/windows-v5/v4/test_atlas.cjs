const fs=require('fs'),path=require('path'),{spawn}=require('child_process'),{pathToFileURL}=require('url');
const P=__dirname,OUT=path.join(require('os').homedir(),'Downloads','全国高校离线地图');
const profile=path.join(P,'test_profile_'+Date.now()),chrome=path.win32.normalize('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');
const errors=[],network=[];let proc,ws;const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 proc=spawn(chrome,['--headless','--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
 let portFile=path.join(profile,'DevToolsActivePort');for(let i=0;i<200&&!fs.existsSync(portFile);i++)await wait(100);if(!fs.existsSync(portFile))throw Error('DevTools did not start');
 const port=fs.readFileSync(portFile,'utf8').split('\n')[0];const tabs=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();const tab=tabs.find(t=>t.type==='page');
 ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});let seq=0;const pending=new Map();
 ws.onmessage=e=>{let m=JSON.parse(e.data);if(m.id){let p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}}else{if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url))network.push(m.params.request.url)}};
 function send(method,params={}){return new Promise((resolve,reject)=>{let id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));})}
 async function evaluate(expression){let r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:pathToFileURL(path.join(OUT,'全国高校地图_离线数据增强版.html')).href});
 let ready=false;for(let i=0;i<200;i++){await wait(100);if(await evaluate('!!window.__atlas')){ready=true;break;}}
 if(!ready)throw Error('Atlas did not boot: '+await evaluate('document.body.innerText'));
 const result=await evaluate('window.__atlas.selfTest()');result.browserNetworkOffline=true;result.httpRequests=network;result.runtimeErrors=errors;
 console.log('SELFTEST',JSON.stringify(result));fs.writeFileSync(path.join(OUT,'断网测试结果.json'),JSON.stringify(result,null,2));
 const samp=await evaluate("['330100','341800','440300'].map(id=>{let n=__atlas.D.regions[id];return {city:n.name,schools:__atlas.schoolRows(n.p,n.c).length,first:__atlas.schoolRows(n.p,n.c).slice(0,3).map(u=>u.u)}})");console.log('SAMPLES',JSON.stringify(samp));
 const shots=[['national_desktop.png',null,1440,1000],['zhejiang_desktop.png','330000',1440,1000],['hangzhou_desktop.png','330100',1440,1000],['xihu_desktop.png','330106',1440,1000],['national_mobile.png',null,390,844]];
 for(const[name,id,w,h]of shots){await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:w<500});await evaluate(id?`__atlas.navigateID('${id}')`:'__atlas.navigateID("100000")');await wait(400);let q=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(P,name),Buffer.from(q.data,'base64'));}
 console.log('SCREENSHOTS_DONE');
 await send('Browser.close').catch(()=>{});ws.close();
}
main().catch(e=>{console.error(e.stack);fs.writeFileSync(path.join(P,'test_error.txt'),e.stack+'\n'+JSON.stringify(errors));if(ws)ws.close();if(proc)proc.kill();process.exitCode=1;});
