// Test preload for the Node server: nothing may leave the machine.
//
// 1. dns.lookup answers the synthetic names of RISU_NET_GUARD_NAMES locally. The
//    value is a JSON object: a name maps to a list of answers, each answer a
//    list of addresses. Each lookup of a name takes the next answer (the last one
//    repeats), so a test can make a name resolve to different addresses over time.
// 2. net.Socket.prototype.connect refuses, before any socket opens, a connection
//    to an address other than loopback: a literal address or one a name resolved
//    to (the lookup the connection uses is wrapped, so the resolved address is
//    seen). Every refused attempt is appended to connect-attempts.jsonl in the
//    working directory as {host, address}.
const dns = require('node:dns')
const net = require('node:net')
const fs = require('node:fs')
const path = require('node:path')

const names = JSON.parse(process.env.RISU_NET_GUARD_NAMES || '{}')
const lookupCounts = new Map()
const realLookup = dns.lookup

function isLoopback(address) {
    const bare = String(address).split('%')[0].toLowerCase()
    return bare === '::1' || bare === '::ffff:127.0.0.1' || /^127\./.test(bare)
}

function record(host, address) {
    fs.appendFileSync(path.join(process.cwd(), 'connect-attempts.jsonl'), JSON.stringify({ host, address }) + '\n')
}

function refusal(host, address) {
    const error = new Error(`connect ECONNREFUSED ${address} (test net guard)`)
    error.code = 'ECONNREFUSED'
    error.address = address
    error.host = host
    return error
}

dns.lookup = function guardedLookup(hostname, options, callback) {
    let lookupOptions = options
    let done = callback
    if (typeof options === 'function') {
        done = options
        lookupOptions = {}
    }
    if (typeof lookupOptions === 'number') {
        lookupOptions = { family: lookupOptions }
    }
    const answers = names[String(hostname).toLowerCase()]
    if (answers === undefined) {
        return realLookup.call(dns, hostname, lookupOptions, done)
    }
    const calls = lookupCounts.get(hostname) ?? 0
    lookupCounts.set(hostname, calls + 1)
    const addresses = answers[Math.min(calls, answers.length - 1)].map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
    process.nextTick(() => {
        if (lookupOptions.all) {
            done(null, addresses)
        } else {
            done(null, addresses[0].address, addresses[0].family)
        }
    })
}

const realConnect = net.Socket.prototype.connect
net.Socket.prototype.connect = function guardedConnect(...args) {
    let options = args[0]
    if (Array.isArray(options)) {
        options = options[0]
    }
    if (typeof options === 'number' || typeof options === 'string') {
        // (port[, host][, cb]) and (path[, cb]) forms
        if (typeof options === 'number') {
            options = { port: options, host: typeof args[1] === 'string' ? args[1] : 'localhost' }
            args = [options, ...args.slice(typeof args[1] === 'string' ? 2 : 1)]
        } else {
            return realConnect.apply(this, args)
        }
    }
    if (options === null || typeof options !== 'object' || typeof options.path === 'string') {
        return realConnect.apply(this, args)
    }
    const host = options.host ?? 'localhost'
    if (net.isIP(host) !== 0) {
        if (!isLoopback(host)) {
            record(host, host)
            const error = refusal(host, host)
            process.nextTick(() => this.destroy(error))
            return this
        }
        return realConnect.apply(this, args)
    }
    const innerLookup = options.lookup || dns.lookup
    const guardedOptions = {
        ...options,
        lookup: (lookupHost, lookupOptions, lookupCallback) => {
            innerLookup(lookupHost, lookupOptions, (error, first, second) => {
                if (error) {
                    lookupCallback(error)
                    return
                }
                const addresses = Array.isArray(first) ? first.map((entry) => entry.address) : [first]
                const outside = addresses.find((address) => !isLoopback(address))
                if (outside !== undefined) {
                    record(lookupHost, outside)
                    lookupCallback(refusal(lookupHost, outside))
                    return
                }
                lookupCallback(null, first, second)
            })
        },
    }
    return realConnect.apply(this, [guardedOptions, ...args.slice(1)])
}
