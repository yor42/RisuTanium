// Server side of the streamed .bin export. The page stays the only producer of
// .bin framing and uploads its bytes to a staging file; the server splices each
// asset body in from a pin (a hard link to the asset's file, or, where links fail,
// the file's identity) so asset bytes never cross the page. A job is a few files
// under `<exportsDir>/<id>/`: `staged.bin` (the page's bytes, contiguous),
// `segments.ndjson` (one line per append: where its bytes sit and which pin is
// spliced into them) and the pin links. Every operation on one job runs in that
// job's promise chain, and the download stream only reads lengths the chain has
// committed, so a failed or replayed append never shows in the download.
//
// A splice is valid only while a key file's bytes are the key's value bytes: a
// change of the storage layout or an at-rest encoding must update `keyFile` or
// turn the feature off (RISU_EXPORT_STREAM=off).
const crypto = require('crypto')
const path = require('path')
const { assetKeyFromHex } = require('./assetRoute.cjs')

const JOB_ID_PATTERN = /^[0-9a-f]{32}$/
const TICKET_PATTERN = /^[0-9a-f]{64}$/
const FILENAME_PATTERN = /^[A-Za-z0-9._-]+\.bin$/
const FORMAT = 'bin'
const FORMAT_VERSION = 1
const GIB = 1024 * 1024 * 1024
const STREAM_CHUNK_BYTES = 1024 * 1024
const TABLE_READ_BYTES = 64 * 1024

// A non-negative integer from the environment, else `fallback`.
function integerFromEnv(env, name, fallback, minimum) {
    const text = env[name]
    if (typeof text !== 'string' || !/^\d+$/.test(text.trim())) {
        return fallback
    }
    const value = Number(text)
    return Number.isSafeInteger(value) && value >= minimum ? value : fallback
}

function refusal(status, error, code, extra) {
    return { status, body: { error, code, ...extra } }
}

function goneAnswer() {
    return refusal(404, 'Export is gone', 'export-gone')
}

function sha256Hex(value) {
    return crypto.createHash('sha256').update(value).digest('hex')
}

// A refusal that carries its own answer out of the append steps.
class AnswerError extends Error {
    constructor(answer) {
        super(answer.body.error)
        this.answer = answer
    }
}

// A download that cannot continue; `failure` is what the status route reports.
class StreamFailure extends Error {
    constructor(failure, key) {
        super(failure)
        this.failure = failure
        this.key = key
    }
}

class ClientGone extends Error {}

function createExportJobs(options) {
    const { fs, keyFile, statfs, saveDir, exportsDir } = options
    const env = options.env ?? {}
    const now = options.now ?? Date.now
    const randomBytes = options.randomBytes ?? crypto.randomBytes
    const log = options.log ?? (() => {})

    const enabled = env.RISU_EXPORT_STREAM !== 'off'
    const pinDisabled = env.RISU_EXPORT_PIN === 'off'
    const stagedCap = integerFromEnv(env, 'RISU_EXPORT_STAGED_CAP_BYTES', null, 1)
    const freeReserve = integerFromEnv(env, 'RISU_EXPORT_FREE_RESERVE_BYTES', GIB, 0)
    const ticketTtlMs = integerFromEnv(env, 'RISU_EXPORT_TICKET_TTL_MS', 120 * 1000, 1)
    const idleMs = integerFromEnv(env, 'RISU_EXPORT_IDLE_MS', 6 * 60 * 60 * 1000, 1)
    const stallMs = integerFromEnv(env, 'RISU_EXPORT_STALL_MS', 30 * 60 * 1000, 1)
    const tombstoneMs = integerFromEnv(env, 'RISU_EXPORT_TOMBSTONE_MS', 10 * 60 * 1000, 1)

    const jobs = new Map()
    const tombstones = new Map()
    let freeSpaceNoted = false

    function runInChain(job, fn) {
        const result = job.chain.then(fn)
        job.chain = result.then(() => undefined, () => undefined)
        return result
    }

    function failureAnswer(error, what) {
        const code = typeof error?.code === 'string' ? error.code : 'WRITE_FAILED'
        log(`${what}: ${code}`)
        return refusal(code === 'ENOSPC' || code === 'EDQUOT' ? 507 : 500, what, code)
    }

    function lookup(id) {
        if (typeof id !== 'string' || !JOB_ID_PATTERN.test(id)) {
            return { answer: refusal(400, 'Invalid export id', 'export-id') }
        }
        const job = jobs.get(id)
        return job === undefined ? { answer: goneAnswer() } : { job }
    }

    function stagedTotal() {
        let total = 0
        for (const job of jobs.values()) {
            total += job.stagedLength
        }
        return total
    }

    // Free bytes on the save volume, or null where the platform cannot say.
    async function freeBytes() {
        if (freeReserve === 0) {
            return null
        }
        let reason = null
        if (typeof statfs !== 'function') {
            reason = 'unavailable'
        } else {
            try {
                const stats = await statfs(saveDir)
                const free = Number(stats.bavail) * Number(stats.bsize)
                if (Number.isFinite(free)) {
                    return free
                }
                reason = 'unreadable'
            } catch (error) {
                reason = error?.code ?? 'failed'
            }
        }
        if (!freeSpaceNoted) {
            freeSpaceNoted = true
            log(`The free-space reserve is not enforced (${reason})`)
        }
        return null
    }

    function spaceRefusal() {
        return refusal(507, 'Not enough free space to stage the export', 'export-space')
    }

    function capRefusal() {
        return refusal(507, 'The staged export bytes are over the server limit', 'export-cap')
    }

    async function begin(body) {
        if (!enabled) {
            return goneAnswer()
        }
        const request = typeof body === 'object' && body !== null ? body : {}
        if (request.format !== FORMAT || request.v !== FORMAT_VERSION) {
            return refusal(400, 'Unsupported export format', 'export-version')
        }
        if (typeof request.filename !== 'string' || !FILENAME_PATTERN.test(request.filename)) {
            return refusal(400, 'Invalid export file name', 'export-filename')
        }
        const free = await freeBytes()
        if (free !== null && free < freeReserve) {
            return spaceRefusal()
        }
        if (stagedCap !== null && stagedTotal() > stagedCap) {
            return capRefusal()
        }
        const id = randomBytes(16).toString('hex')
        const dir = path.join(exportsDir, id)
        let staged
        let table
        try {
            await fs.mkdir(dir, { recursive: true })
            staged = await fs.open(path.join(dir, 'staged.bin'), 'wx')
            table = await fs.open(path.join(dir, 'segments.ndjson'), 'wx')
        } catch (error) {
            await staged?.close().catch(() => {})
            await table?.close().catch(() => {})
            await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
            return failureAnswer(error, 'Failed to start export')
        }
        jobs.set(id, {
            id,
            dir,
            filename: request.filename,
            state: 'staging',
            staged,
            table,
            stagedLength: 0,
            tableLength: 0,
            splicedTotal: 0,
            total: null,
            seq: 0,
            lastDigest: null,
            lastAnswer: null,
            openPin: null,
            ticketHash: null,
            ticketExpires: 0,
            lastTouch: now(),
            chain: Promise.resolve(),
            res: null,
            sent: 0,
            endReason: null,
            pumpSettled: Promise.resolve(),
        })
        return { status: 200, body: { id } }
    }

    async function writeAll(handle, buffer, position) {
        let written = 0
        while (written < buffer.length) {
            const { bytesWritten } = await handle.write(buffer, written, buffer.length - written, position + written)
            written += bytesWritten
        }
    }

    // Pins the asset file for the splice that a later append performs. The answer
    // is `missing` for an absent file, else the pin record.
    async function pinAsset(job, keyHex, seq) {
        const source = keyFile(keyHex)
        const file = `p${seq}`
        let linked = false
        if (!pinDisabled) {
            try {
                await fs.link(source, path.join(job.dir, file))
                linked = true
            } catch (error) {
                if (error?.code === 'ENOENT') {
                    return { missing: true }
                }
                if (error?.code === 'ENOSPC' || error?.code === 'EDQUOT') {
                    throw error
                }
                // Any other failure takes the identity mode: this filesystem may not
                // link at all, or not this file.
            }
        }
        if (linked) {
            const stat = await fs.stat(path.join(job.dir, file))
            return { pin: { kind: 'pin', keyHex, size: stat.size, file }, created: file }
        }
        let handle
        try {
            handle = await fs.open(source, 'r')
        } catch (error) {
            if (error?.code === 'ENOENT') {
                return { missing: true }
            }
            throw error
        }
        try {
            const stat = await handle.stat()
            if (!stat.isFile()) {
                throw new AnswerError(refusal(400, 'The pinned key is not a file', 'export-key'))
            }
            return { pin: { kind: 'identity', keyHex, size: stat.size, ino: stat.ino, mtimeMs: stat.mtimeMs }, created: null }
        } finally {
            await handle.close().catch(() => {})
        }
    }

    function appendDigest(seq, spliceAt, pinKey, body) {
        const hash = crypto.createHash('sha256')
        hash.update(`${seq}\n${spliceAt ?? ''}\n${pinKey ?? ''}\n`)
        hash.update(body)
        return hash.digest('hex')
    }

    // `request`: id, seq, spliceAt and pinKey as the raw header values, body a Buffer.
    async function append(request) {
        const found = lookup(request.id)
        if (found.job === undefined) {
            return found.answer
        }
        const job = found.job
        if (typeof request.seq !== 'string' || !/^\d+$/.test(request.seq) || !Number.isSafeInteger(Number(request.seq))) {
            return refusal(400, 'export-seq is required and must be a non-negative integer', 'export-seq')
        }
        const seq = Number(request.seq)
        let spliceAt = null
        if (request.spliceAt !== undefined) {
            if (typeof request.spliceAt !== 'string' || !/^\d+$/.test(request.spliceAt) || !Number.isSafeInteger(Number(request.spliceAt))) {
                return refusal(400, 'splice-at must be a non-negative integer', 'export-frame')
            }
            spliceAt = Number(request.spliceAt)
        }
        let pinKey = null
        if (request.pinKey !== undefined) {
            const key = typeof request.pinKey === 'string' ? assetKeyFromHex(request.pinKey) : null
            if (key === null || !key.startsWith('assets/')) {
                return refusal(400, 'The pinned key is not an asset key', 'export-key')
            }
            pinKey = request.pinKey.toLowerCase()
        }
        if (!Buffer.isBuffer(request.body)) {
            return refusal(400, 'An export chunk is required', 'export-body')
        }
        job.lastTouch = now()
        return await runInChain(job, () => appendInChain(job, seq, spliceAt, pinKey, request.pinKey, request.body))
    }

    async function appendInChain(job, seq, spliceAt, pinKey, rawPinKey, body) {
        if (jobs.get(job.id) !== job) {
            return goneAnswer()
        }
        if (job.state !== 'staging') {
            return refusal(409, 'The export is not staging', 'export-state')
        }
        const digest = appendDigest(seq, spliceAt, rawPinKey, body)
        if (seq === job.seq - 1 && job.lastAnswer !== null && digest === job.lastDigest) {
            return job.lastAnswer
        }
        if (seq !== job.seq) {
            return refusal(409, 'Export sequence mismatch', 'export-seq', { expected: job.seq })
        }

        // The frame: with a pin open, this append must carry the splice point, and
        // the four bytes before it are the entry header's size field of that pin.
        if (job.openPin !== null) {
            if (spliceAt === null) {
                return refusal(409, 'An open asset entry needs its splice point', 'export-frame')
            }
            if (spliceAt < 4 || spliceAt > body.length || body.readUInt32LE(spliceAt - 4) !== job.openPin.size) {
                return refusal(400, 'The splice point does not follow the pinned size', 'export-frame')
            }
        } else if (spliceAt !== null) {
            return refusal(400, 'There is no open asset entry to splice', 'export-frame')
        }

        if (stagedCap !== null && stagedTotal() + body.length > stagedCap) {
            return capRefusal()
        }
        const free = await freeBytes()
        if (free !== null && free - body.length < freeReserve) {
            return spaceRefusal()
        }

        const stagedAt = job.stagedLength
        const tableAt = job.tableLength
        let created = null
        let pinAnswer = null
        let newPin = null
        let line
        try {
            if (body.length > 0) {
                await writeAll(job.staged, body, stagedAt)
            }
            if (pinKey !== null) {
                const result = await pinAsset(job, pinKey, seq)
                if (result.missing === true) {
                    pinAnswer = 'missing'
                } else {
                    created = result.created
                    newPin = result.pin
                    pinAnswer = { size: result.pin.size }
                }
            }
            line = Buffer.from(`${JSON.stringify({
                at: stagedAt,
                n: body.length,
                spliceAfter: spliceAt,
                splice: spliceAt === null ? null : job.openPin,
            })}\n`)
            await writeAll(job.table, line, tableAt)
        } catch (error) {
            await job.staged.truncate(stagedAt).catch((truncateError) => log(`Could not roll back the staged bytes: ${truncateError?.code ?? truncateError}`))
            await job.table.truncate(tableAt).catch((truncateError) => log(`Could not roll back the segment table: ${truncateError?.code ?? truncateError}`))
            if (created !== null) {
                await fs.unlink(path.join(job.dir, created)).catch(() => {})
            }
            return error instanceof AnswerError ? error.answer : failureAnswer(error, 'Failed to stage export bytes')
        }

        job.stagedLength = stagedAt + body.length
        job.tableLength = tableAt + line.length
        if (spliceAt !== null) {
            job.splicedTotal += job.openPin.size
            job.openPin = null
        }
        if (newPin !== null) {
            job.openPin = newPin
        }
        job.seq = seq + 1
        job.lastDigest = digest
        job.lastAnswer = { status: 200, body: { ok: true, pin: pinAnswer } }
        job.lastTouch = now()
        return job.lastAnswer
    }

    async function finalize(id) {
        const found = lookup(id)
        if (found.job === undefined) {
            return found.answer
        }
        const job = found.job
        job.lastTouch = now()
        return await runInChain(job, async () => {
            if (jobs.get(job.id) !== job) {
                return goneAnswer()
            }
            if (job.state === 'streaming') {
                return refusal(409, 'The export is already downloading', 'export-state')
            }
            if (job.openPin !== null) {
                return refusal(409, 'An open asset entry has no splice point', 'export-frame')
            }
            const ticket = randomBytes(32).toString('hex')
            job.state = 'ready'
            job.total = job.stagedLength + job.splicedTotal
            job.ticketHash = sha256Hex(ticket)
            job.ticketExpires = now() + ticketTtlMs
            job.lastTouch = now()
            return { status: 200, body: { ticket, total: job.total } }
        })
    }

    // Takes the response over and returns null, or returns the refusal to send.
    async function download(ticket, res) {
        const refused = () => ({ status: 404, body: { error: 'Not found' } })
        if (typeof ticket !== 'string' || !TICKET_PATTERN.test(ticket)) {
            return refused()
        }
        const hash = sha256Hex(ticket)
        let found
        for (const job of jobs.values()) {
            if (job.ticketHash === hash) {
                found = job
                break
            }
        }
        if (found === undefined) {
            return refused()
        }
        const job = found
        return await runInChain(job, async () => {
            if (jobs.get(job.id) !== job || job.ticketHash !== hash || now() > job.ticketExpires) {
                return refused()
            }
            job.ticketHash = null
            job.state = 'streaming'
            job.lastTouch = now()
            startStream(job, res)
            return null
        })
    }

    function startStream(job, res) {
        job.res = res
        job.sent = 0
        const pump = streamJob(job, res)
        job.pumpSettled = pump.then(() => undefined)
        pump.then((outcome) => endJob(job, outcome))
    }

    function failedOutcome(failure, key) {
        return key === undefined ? { state: 'failed', failure } : { state: 'failed', failure, key }
    }

    // Streams the committed bytes of a job. It never throws; the outcome says how
    // it ended.
    async function streamJob(job, res) {
        const closed = new Promise((resolve) => res.once('close', resolve))
        const chunk = Buffer.allocUnsafe(STREAM_CHUNK_BYTES)
        let stallTimer = null
        const arm = () => {
            clearTimeout(stallTimer)
            stallTimer = setTimeout(() => {
                job.endReason ??= 'stalled'
                res.destroy()
            }, stallMs)
        }
        const send = (buffer) => new Promise((resolve, reject) => {
            if (res.destroyed) {
                reject(new ClientGone())
                return
            }
            const onClose = () => reject(new ClientGone())
            res.once('close', onClose)
            res.write(buffer, (error) => {
                res.off('close', onClose)
                if (error) {
                    reject(new ClientGone())
                    return
                }
                job.sent += buffer.length
                arm()
                resolve()
            })
        })
        const sendRange = async (handle, start, length, onShort) => {
            let position = start
            let remaining = length
            while (remaining > 0) {
                const { bytesRead } = await handle.read(chunk, 0, Math.min(remaining, chunk.length), position)
                if (bytesRead === 0) {
                    throw onShort()
                }
                await send(chunk.subarray(0, bytesRead))
                position += bytesRead
                remaining -= bytesRead
            }
        }
        const withHandle = async (file, fn) => {
            const handle = await fs.open(file, 'r')
            try {
                return await fn(handle)
            } finally {
                await handle.close().catch(() => {})
            }
        }
        const changed = (keyHex) => new StreamFailure('asset-changed', Buffer.from(keyHex, 'hex').toString('utf8'))
        const sendSplice = async (splice) => {
            const gone = () => changed(splice.keyHex)
            if (splice.kind === 'pin') {
                await withHandle(path.join(job.dir, splice.file), (handle) => sendRange(handle, 0, splice.size, gone))
                return
            }
            let opened
            try {
                opened = await fs.open(keyFile(splice.keyHex), 'r')
            } catch (error) {
                throw error?.code === 'ENOENT' ? gone() : error
            }
            try {
                const stat = await opened.stat()
                if (stat.size !== splice.size || stat.ino !== splice.ino || stat.mtimeMs !== splice.mtimeMs) {
                    throw gone()
                }
                await sendRange(opened, 0, splice.size, gone)
            } finally {
                await opened.close().catch(() => {})
            }
        }

        let outcome
        try {
            res.writeHead(200, {
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': `attachment; filename="${job.filename}"`,
                'Content-Length': String(job.total),
                'Cache-Control': 'no-store',
                'X-Content-Type-Options': 'nosniff',
            })
            arm()
            const stagedShort = () => new StreamFailure('staged-short')
            await withHandle(path.join(job.dir, 'staged.bin'), async (staged) => {
                await withHandle(path.join(job.dir, 'segments.ndjson'), async (table) => {
                    for await (const segment of readSegments(table, job.tableLength)) {
                        const end = segment.at + segment.n
                        if (!Number.isSafeInteger(end) || end > job.stagedLength) {
                            throw new StreamFailure('segment-invalid')
                        }
                        if (segment.splice === null) {
                            await sendRange(staged, segment.at, segment.n, stagedShort)
                            continue
                        }
                        await sendRange(staged, segment.at, segment.spliceAfter, stagedShort)
                        await sendSplice(segment.splice)
                        await sendRange(staged, segment.at + segment.spliceAfter, segment.n - segment.spliceAfter, stagedShort)
                    }
                })
            })
            if (job.sent !== job.total) {
                throw new StreamFailure('length-mismatch')
            }
            const finished = new Promise((resolve) => res.end(resolve))
            const first = await Promise.race([finished.then(() => 'finish'), closed.then(() => 'close')])
            if (first === 'close' && !res.writableFinished) {
                throw new ClientGone()
            }
            outcome = { state: 'done' }
        } catch (error) {
            if (error instanceof ClientGone) {
                outcome = failedOutcome(job.endReason ?? 'client-closed')
            } else if (error instanceof StreamFailure) {
                outcome = failedOutcome(error.failure, error.key)
            } else {
                log(`Export download failed: ${error?.code ?? error?.message ?? error}`)
                outcome = failedOutcome('read-error')
            }
            res.destroy()
        } finally {
            clearTimeout(stallTimer)
        }
        return outcome
    }

    // The segment lines up to `length` bytes of the table, one at a time; the
    // table is never parsed whole.
    async function* readSegments(handle, length) {
        const buffer = Buffer.allocUnsafe(TABLE_READ_BYTES)
        let position = 0
        let carry = ''
        while (position < length) {
            const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, length - position), position)
            if (bytesRead === 0) {
                break
            }
            position += bytesRead
            carry += buffer.toString('latin1', 0, bytesRead)
            let index = carry.indexOf('\n')
            while (index !== -1) {
                const text = carry.slice(0, index)
                carry = carry.slice(index + 1)
                if (text !== '') {
                    yield JSON.parse(text)
                }
                index = carry.indexOf('\n')
            }
        }
    }

    function endJob(job, outcome) {
        return runInChain(job, async () => {
            if (jobs.get(job.id) === job) {
                await removeJob(job, outcome)
            }
        }).catch((error) => log(`Export cleanup failed: ${error?.code ?? error?.message ?? error}`))
    }

    // Ends a job: destroys an active download, waits for its read handles to
    // close, then removes the job's own directory and nothing else. Runs in the
    // job's chain.
    async function removeJob(job, outcome) {
        jobs.delete(job.id)
        job.state = 'ended'
        tombstones.set(job.id, { ...outcome, sent: job.sent, total: job.total, expires: now() + tombstoneMs })
        if (job.res !== null) {
            job.res.destroy()
        }
        await job.pumpSettled
        await job.staged.close().catch(() => {})
        await job.table.close().catch(() => {})
        try {
            await fs.rm(job.dir, { recursive: true, force: true })
        } catch (error) {
            log(`Could not remove the export directory: ${error?.code ?? error}`)
        }
    }

    function status(id) {
        const found = lookup(id)
        if (found.job !== undefined) {
            const job = found.job
            job.lastTouch = now()
            return { status: 200, body: { state: job.state, sent: job.sent, total: job.total } }
        }
        if (found.answer.status === 404) {
            const tombstone = tombstones.get(id)
            if (tombstone !== undefined) {
                if (tombstone.expires > now()) {
                    const { expires, ...visible } = tombstone
                    return { status: 200, body: visible }
                }
                tombstones.delete(id)
            }
        }
        return found.answer
    }

    async function abort(id) {
        const found = lookup(id)
        if (found.job === undefined) {
            return found.answer
        }
        const job = found.job
        return await runInChain(job, async () => {
            if (jobs.get(job.id) !== job) {
                return goneAnswer()
            }
            job.endReason = 'aborted'
            await removeJob(job, { state: 'aborted' })
            return { status: 200, body: { ok: true } }
        })
    }

    // Removes the staging and ready jobs nobody has touched for the idle bound, and
    // the tombstones past their time. A downloading job is bounded by the stall
    // timer instead.
    async function reap() {
        for (const [id, tombstone] of [...tombstones]) {
            if (tombstone.expires <= now()) {
                tombstones.delete(id)
            }
        }
        for (const job of [...jobs.values()]) {
            const idle = () => (job.state === 'staging' || job.state === 'ready') && now() - job.lastTouch > idleMs
            if (!idle()) {
                continue
            }
            await runInChain(job, async () => {
                if (jobs.get(job.id) === job && idle()) {
                    await removeJob(job, failedOutcome('idle'))
                }
            }).catch((error) => log(`Export reap failed: ${error?.code ?? error?.message ?? error}`))
        }
    }

    function startReaper() {
        const interval = Math.max(50, Math.min(30 * 1000, Math.floor(idleMs / 4)))
        const timer = setInterval(() => {
            reap().catch((error) => log(`Export reap failed: ${error?.code ?? error?.message ?? error}`))
        }, interval)
        timer.unref()
        return timer
    }

    return {
        enabled,
        caps: () => (enabled ? { exportStream: true, exportStreamVersion: FORMAT_VERSION } : {}),
        begin,
        append,
        finalize,
        download,
        status,
        abort,
        reap,
        startReaper,
    }
}

module.exports = { createExportJobs }
