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
const mode=process.argv[5]||'apply'; const idx = JSON.parse(fs.readFileSync(path.join(packs,'index.json'),'utf8')); const res=[]
for (const p of idx) {
  await send('Page.navigate',{url:'http://127.0.0.1:6013/'}); for(let i=0;i<60;i++){ try{ if(await ev('window.__ready===true')) break }catch{} await new Promise(r=>setTimeout(r,300)) }; await new Promise(r=>setTimeout(r,1500))
  if (mode==='phases'){ const o=await ev(`runPhases(${JSON.stringify(p.name)})`); res.push({label:p.label,...o}); console.log(JSON.stringify(res.at(-1))); continue }
  const pids = await rendererPid(); const base = rssMiB(pids)
  let peak = base; let stop=false
  const poll=(async()=>{ while(!stop && !process.env.NOPOLL){ peak=Math.max(peak,rssMiB(await rendererPid())); await new Promise(r=>setTimeout(r,150)) } })()
  const r = await ev(`runArchive(${JSON.stringify(p.name)},${JSON.stringify(p.key)},${process.env.REPS||3},${process.env.SLEEP||800})`)
  stop=true; await poll
  const after = rssMiB(await rendererPid())
  res.push({ label:p.label, archiveMiB:+(p.bytes/1048576).toFixed(1), entries:p.entries, baselineRssMiB:+base.toFixed(0), peakRssMiB:+peak.toFixed(0), afterRssMiB:+after.toFixed(0), applyMs:r.rows.map(x=>+x.ms.toFixed(0)),marks:r.rows.map(x=>x.m), blobs:r.rows[0].blobs })
  console.log(JSON.stringify(res.at(-1)))
}
fs.writeFileSync(out, JSON.stringify(res,null,1)); chrome.kill(); srv.close(); process.exit(0)





