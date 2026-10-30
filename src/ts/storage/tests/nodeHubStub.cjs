// Test preload for the Node server: answers every fetch to the Realm hub origin
// locally and records it in hub-requests.jsonl in the working directory, so a
// /hub-proxy test sends nothing off the machine.
const fs = require('fs')
const path = require('path')
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.startsWith('https://sv.risuai.xyz') || url.startsWith('https://nightly.sv.risuai.xyz')) {
        const body = init.body
        const length = body === undefined || body === null ? 0 : (Buffer.isBuffer(body) || body instanceof Uint8Array ? body.length : Buffer.byteLength(String(body)))
        fs.appendFileSync(path.join(process.cwd(), 'hub-requests.jsonl'), JSON.stringify({ method: init.method, url, length }) + '\n')
        return new Response('stub-ok', { status: 200, headers: { 'content-type': 'text/plain' } })
    }
    return realFetch(input, init)
}
