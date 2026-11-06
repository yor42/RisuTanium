// Long-running: logs every request host/method/url prefix of the page to <out>/hosts.log (started before the first load).
import { connect, outDir } from './lib.mjs'
import fs from 'node:fs'
import path from 'node:path'
const HOSTS_LOG = path.join(outDir(), 'hosts.log')
const c = await connect()
c.on(m => { if (m.method === 'Network.requestWillBeSent') { let h = '?'; try { h = new URL(m.params.request.url).host } catch {} fs.appendFileSync(HOSTS_LOG,h + ' ' + m.params.request.method + ' ' + m.params.request.url.slice(0, 100) + '\n') } })
await c.send('Network.enable')
setInterval(() => {}, 1e6)
