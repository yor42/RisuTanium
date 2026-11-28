import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { spawn, execSync } from 'node:child_process'
const dist = process.argv[2], packs = process.argv[3], out = process.argv[4]
const mime = { '.js':'text/javascript', '.html':'text/html', '.css':'text/css', '.wasm':'application/wasm' }
const srv = http.createServer((q,r)=>{ const u=decodeURIComponent(q.url.split('?')[0]); if(u.startsWith('/packs/')){ const f=path.join(packs,path.basename(u)); r.writeHead(200,{'content-length':fs.statSync(f).size}); fs.createReadStream(f).pipe(r); return } let p=path.join(dist,u); if(u==='/') p=path.join(dist,'index.html'); fs.readFile(p,(e,b)=>{ if(e){r.writeHead(404);r.end();return} r.writeHead(200,{'content-type':mime[path.extname(p)]||'application/octet-stream'}); r.end(b)})}).listen(6013)
const prof = fs.mkdtempSync(path.join(process.env.TEMP,'chrome-ac-'))
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new','--remote-debugging-port=9731','--user-data-dir='+prof,'--no-first-run','--disable-extensions','about:blank'], { stdio:'ignore' })
await new Promise(r=>setTimeout(r,3000))
const conn = async (url)=>{ const ws=new WebSocket(url); await new Promise(r=>ws.onopen=r); let id=0; const pend=new Map(); ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id)}}; return (method,params={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method,params}))}) }
const ver = await (await fetch('http://127.0.0.1:9731/json/version')).json()
const tabs = await (await fetch('http://127.0.0.1:9731/json')).json()
const bsend = await conn(ver.webSocketDebuggerUrl); const send = await conn(tabs.find(t=>t.type==='page').webSocketDebuggerUrl)
const ev=async(expr)=>{const m=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true}); if(m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0,600)); return m.result.result.value}
await send('Page.navigate',{url:'http://127.0.0.1:6013/'})
for(let i=0;i<60;i++){ if(await ev('window.__ready===true')) break; await new Promise(r=>setTimeout(r,500)) }
const rendererPid = async ()=>{ const m=await bsend('SystemInfo.getProcessInfo'); return m.result.processInfo.filter(p=>p.type==='renderer').map(p=>p.id) }
const rssMiB = (pids)=>{ let t=0; for(const p of pids){ try{ const o=execSync(`tasklist /FI "PID eq ${p}" /FO CSV /NH`,{encoding:'utf8'}); const m=/"([\d,]+) K"\s*$/m.exec(o.trim()); if(m) t=Math.max(t, parseInt(m[1].replace(/,/g,''))/1024) }catch{} } return t }
const idx = JSON.parse(fs.readFileSync(path.join(packs,'index.json'),'utf8')); const res=[]
for (const p of idx) {
  await send('Page.navigate',{url:'http://127.0.0.1:6013/'}); for(let i=0;i<60;i++){ try{ if(await ev('window.__ready===true')) break }catch{} await new Promise(r=>setTimeout(r,300)) }; await new Promise(r=>setTimeout(r,1500))
  const pr = ev('runStages('+JSON.stringify(p.name)+')')
  pr.catch(e=>{console.log('ERR',e.message);process.exit(1)})
  const row={label:p.label,archiveMiB:+(p.bytes/1048576).toFixed(0),baseline:+rssMiB(await rendererPid()).toFixed(0)}
  for(let k=0;k<5;k++){ let at=''; for(let t=0;t<900&&!at;t++){ at=await ev("window.__at||''"); if(!at) await new Promise(r=>setTimeout(r,50)) } await new Promise(r=>setTimeout(r,700)); row[at]=+rssMiB(await rendererPid()).toFixed(0); await ev('window.__resume()') }
  await pr; res.push(row); console.log(JSON.stringify(row))
}
fs.writeFileSync(out, JSON.stringify(res,null,1)); chrome.kill(); srv.close(); process.exit(0)

