// usage: node bench.cjs <port>   (cwd-main/save must be populated). Spawns only its own server child.
const { spawn, spawnSync } = require('child_process')
const path = require('path'), http = require('http'), crypto = require('crypto')
const D = __dirname
const port = +process.argv[2] || 6041
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
function req(method, p, o, headers = {}) {
    return new Promise((resolve, reject) => {
        const body = o ? JSON.stringify(o) : null
        const h = { ...headers }
        if (body) { h['content-type'] = 'application/json'; h['content-length'] = Buffer.byteLength(body) }
        const t0 = process.hrtime.bigint()
        const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: h, agent: false }, (res) => {
            const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => {
                const t1 = process.hrtime.bigint()
                const buf = Buffer.concat(c)
                resolve({ status: res.statusCode, buf, ms: Number(t1 - t0) / 1e6 })
            })
        })
        r.on('error', reject); r.end(body)
    })
}
const rss = (pid) => {
    const o = spawnSync('powershell', ['-NoProfile', '-Command', `$p=Get-Process -Id ${pid}; "$([math]::Round($p.WorkingSet64/1MB,1)) $([math]::Round($p.PeakWorkingSet64/1MB,1))"`]).stdout.toString().trim().split(' ')
    return { rssMB: +o[0], peakMB: +o[1] }
}
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }
const stats = (a) => ({ n: a.length, p50: +q(a, .5).toFixed(1), p95: +q(a, .95).toFixed(1), min: +Math.min(...a).toFixed(1), max: +Math.max(...a).toFixed(1) })
;(async () => {
    const cwd = path.join(D, 'cwd-main')
    const child = spawn(process.execPath, [path.join(D, 'server.cjs')], { cwd, env: { ...process.env, PORT: String(port), NODE_PATH: 'C:\\Projects\\RisuAI\\node_modules' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (c) => out += c); child.stderr.on('data', (c) => out += c)
    const res = {}
    try {
        const t0 = Date.now()
        while (!out.includes('server is running')) { if (child.exitCode !== null) throw new Error('exit ' + out); if (Date.now() - t0 > 60000) throw new Error('start timeout ' + out); await new Promise(r => setTimeout(r, 50)) }
        res.startMs = Date.now() - t0
        res.rssIdle = rss(child.pid)
        const { publicKey, privateKey } = await crypto.webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
        const pub = await crypto.webcrypto.subtle.exportKey('jwk', publicKey)
        const digest = (await req('POST', '/api/crypto', { data: 'nodelist-scratch' })).buf.toString()
        const sp = await req('POST', '/api/set_password', { password: digest })
        const lg = await req('POST', '/api/login', { password: digest, publicKey: pub })
        if (sp.status !== 200 || lg.status !== 200) throw new Error('auth ' + sp.status + ' ' + lg.status + sp.buf + lg.buf)
        const iat = Math.floor(Date.now() / 1000)
        const head = b64u({ alg: 'ES256', typ: 'JWT' }), payload = b64u({ iat, exp: iat + 3000, pub })
        const sig = await crypto.webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, Buffer.from(head + '.' + payload))
        const H = { 'risu-auth': head + '.' + payload + '.' + Buffer.from(sig).toString('base64url') }

        // cold-ish: first list after fresh start (OS dentry cache is warm; true cold-cache not forced)
        const first = await req('GET', '/api/list', null, H)
        res.firstList = { status: first.status, ms: +first.ms.toFixed(1), bytes: first.buf.length }
        res.rssAfterFirst = rss(child.pid)
        const firstP = await req('GET', '/api/list-prefix?prefix=' + encodeURIComponent('store2/'), null, H)
        res.firstPrefix = { status: firstP.status, ms: +firstP.ms.toFixed(1), bytes: firstP.buf.length }

        const N = 30
        const wall = [], parse = [], filt = [], total = []
        let bytes = 0, keys = 0, kept = 0
        for (let i = 0; i < N; i++) {
            const r = await req('GET', '/api/list', null, H)
            bytes = r.buf.length
            const t1 = process.hrtime.bigint()
            const j = JSON.parse(r.buf.toString('utf-8'))
            const t2 = process.hrtime.bigint()
            const f = j.content.filter((k) => k.startsWith('store2/'))
            const t3 = process.hrtime.bigint()
            keys = j.content.length; kept = f.length
            wall.push(r.ms); parse.push(Number(t2 - t1) / 1e6); filt.push(Number(t3 - t2) / 1e6); total.push(r.ms + Number(t3 - t1) / 1e6)
        }
        res.list = { keys, kept, bytes, httpWallMs: stats(wall), clientParseMs: stats(parse), clientFilterMs: stats(filt), httpPlusParseFilterMs: stats(total) }
        res.rssAfterLists = rss(child.pid)

        const pw = [], pb = [] ; let pbytes = 0, pkeys = 0
        for (let i = 0; i < N; i++) {
            const r = await req('GET', '/api/list-prefix?prefix=' + encodeURIComponent('store2/'), null, H)
            pbytes = r.buf.length; pkeys = JSON.parse(r.buf.toString()).content.length; pw.push(r.ms)
        }
        res.prefixStore2 = { keys: pkeys, bytes: pbytes, httpWallMs: stats(pw) }
        const aw = []; let akeys = 0, abytes = 0
        for (let i = 0; i < 10; i++) { const r = await req('GET', '/api/list-prefix?prefix=' + encodeURIComponent('assets/'), null, H); abytes = r.buf.length; akeys = JSON.parse(r.buf.toString()).content.length; aw.push(r.ms) }
        res.prefixAssets = { keys: akeys, bytes: abytes, httpWallMs: stats(aw) }
        res.rssFinal = rss(child.pid)
    } finally {
        child.kill()
    }
    console.log(JSON.stringify(res, null, 1))
})().catch((e) => { console.error(e); process.exit(1) })
