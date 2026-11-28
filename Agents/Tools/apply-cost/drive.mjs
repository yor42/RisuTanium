import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process'
const dist = process.argv[2], out = process.argv[3], N = Number(process.argv[4] || 15)
const mime = { '.js':'text/javascript', '.html':'text/html', '.css':'text/css', '.wasm':'application/wasm' }
const srv = http.createServer((q,r)=>{ let p = path.join(dist, decodeURIComponent(q.url.split('?')[0])); if (p.endsWith(path.sep)||q.url==='/') p = path.join(dist,'index.html'); fs.readFile(p,(e,b)=>{ if(e){r.writeHead(404);r.end();return} r.writeHead(200,{'content-type':mime[path.extname(p)]||'application/octet-stream'}); r.end(b)})}).listen(6013)
const prof = fs.mkdtempSync(path.join(process.env.TEMP,'chrome-ac-'))
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new','--remote-debugging-port=9731','--user-data-dir='+prof,'--no-first-run','--disable-extensions','--disable-background-timer-throttling','about:blank'], { stdio:'ignore' })
await new Promise(r=>setTimeout(r,3000))
const tabs = await (await fetch('http://127.0.0.1:9731/json')).json()
const ws = new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r)
let id=0; const pend=new Map(); ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id)}}
const send=(method,params={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method,params}))})
const ev=async(expr)=>{const m=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true}); if(m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0,600)); return m.result.result.value}
await send('Page.navigate',{url:'http://127.0.0.1:6013/'})
for(let i=0;i<60;i++){ if(await ev('window.__ready===true')) break; await new Promise(r=>setTimeout(r,500)) }
const ua = await ev('navigator.userAgent'); const res=[{ua}]
for (const rep of [1,2]) for (const slug of ['scratch-white','office-sheet','origin-navy']) for (const strip of [false,true]) { if(slug==='origin-navy'&&strip) continue; res.push({rep, ...(await ev(`runApply('${slug}',${N},${strip})`))}) }
fs.writeFileSync(out, JSON.stringify(res,null,1)); console.log(JSON.stringify(res,null,1))
chrome.kill(); srv.close(); process.exit(0)

