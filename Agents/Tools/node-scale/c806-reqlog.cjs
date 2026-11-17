// CHORE-806: request log shim for the self-hosted Node server, loaded with `node --require c806-reqlog.cjs server.cjs`.
// It appends one JSON line per finished request to the file named by C806_REQLOG and changes no response: it only listens to
// the 'request' event and to the response's own finish and close events.
// Line fields: t0 and t1 (epoch ms with sub-millisecond fraction, taken from hrtime against one anchor), method, route (path without
// the query), keys (the decoded store keys of the file-path header, when there are at most 64), keyCount, classes (counts per key
// class), ifMatch (the raw if-match-revision header), status, inBytes and outBytes (socket byte counters from the 'request'
// event to the end of the answer: inBytes is the request body only, because the request headers were read before the event;
// outBytes includes the response headers; exact because a socket carries one request at a time), limited (true for a 429) and
// aborted (the connection closed before the answer finished).
// Key classes: store2-commit, store2-fence, store2-sweep, store2/m (manifest), store2/s (shard), store2/u (unit), store2/g
// (staging), asset, other.
'use strict'
const http = require('http')
const fs = require('fs')

const target = process.env.C806_REQLOG
if (!target) {
    throw new Error('C806_REQLOG must name the request log file.')
}
const fd = fs.openSync(target, 'a')
const anchorEpoch = Date.now()
const anchorHr = process.hrtime.bigint()
const nowMs = () => anchorEpoch + Number(process.hrtime.bigint() - anchorHr) / 1e6

function decodeKey(hex) {
    try {
        return Buffer.from(hex, 'hex').toString('utf8')
    } catch {
        return ''
    }
}

function classOf(key) {
    if (key === 'store2-commit' || key === 'store2-fence' || key === 'store2-sweep') return key
    if (key.startsWith('store2/')) {
        const tail = key.slice('store2/'.length)
        const kind = tail.slice(0, 2)
        if (kind === 'm-' || kind === 's-' || kind === 'u-' || kind === 'g-') return 'store2/' + kind[0]
        return 'store2/other'
    }
    if (key.startsWith('assets/')) return 'asset'
    return 'other'
}

function keysOfHeader(value) {
    if (typeof value !== 'string' || value === '') return []
    return value.split('$$').map(part => decodeKey(part))
}

const original = http.Server.prototype.emit
http.Server.prototype.emit = function (event, req, res) {
    if (event === 'request' && req && res) {
        try {
            const t0 = nowMs()
            const socket = req.socket
            const readBefore = socket ? socket.bytesRead : 0
            const writtenBefore = socket ? socket.bytesWritten : 0
            let done = false
            const finish = (aborted) => {
                if (done) return
                done = true
                try {
                    const keys = keysOfHeader(req.headers['file-path'])
                    const classes = {}
                    for (const key of keys) {
                        const name = classOf(key)
                        classes[name] = (classes[name] || 0) + 1
                    }
                    const route = String(req.url || '').split('?')[0]
                    const line = {
                        t0: +t0.toFixed(3), t1: +nowMs().toFixed(3), method: req.method, route,
                        keys: keys.length <= 64 ? keys : undefined, keyCount: keys.length, classes,
                        ifMatch: req.headers['if-match-revision'], status: res.statusCode,
                        inBytes: socket ? socket.bytesRead - readBefore : 0, outBytes: socket ? socket.bytesWritten - writtenBefore : 0,
                        limited: res.statusCode === 429, aborted,
                    }
                    fs.writeSync(fd, JSON.stringify(line) + '\n')
                } catch {
                    // a logging failure never reaches the request
                }
            }
            res.once('finish', () => finish(false))
            res.once('close', () => finish(!res.writableFinished))
        } catch {
            // a logging failure never reaches the request
        }
    }
    return original.apply(this, arguments)
}
