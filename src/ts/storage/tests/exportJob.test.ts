// @vitest-environment node
/**
 * The streamed-export job module (`server/node/exportJob.cjs`) with injected
 * file-system faults, free-space answers and key resolution. Entries are framed
 * by the real `encodeBackupEntryHeader`; the real HTTP routes are covered in
 * `nodeExportRoutes.test.ts`.
 */
import { EventEmitter } from 'node:events'
import * as realFs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { encodeBackupEntryHeader } from 'src/ts/exportWriters'

// exportWriters is imported only for its pure header encoder; its page-side
// dependencies are replaced.
vi.mock('src/ts/alert', () => ({}))
vi.mock('src/ts/platform', () => ({ isTauri: false, isNodeServer: true, isWeb: false }))
vi.mock('src/lang', () => ({ language: {} }))
vi.mock('src/ts/vendor/streamSaver', () => ({ default: {} }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn() }))

interface Answer {
    status: number
    body: Record<string, unknown>
}

interface AppendRequest {
    id: string
    seq: string
    spliceAt?: string
    pinKey?: string
    body: Buffer
}

interface ExportJobs {
    caps(): Record<string, unknown>
    begin(body: unknown): Promise<Answer>
    append(request: AppendRequest): Promise<Answer>
    finalize(id: string): Promise<Answer>
    download(ticket: string, res: FakeResponse): Promise<Answer | null>
    status(id: string): Answer
    abort(id: string): Promise<Answer>
}

type FsLike = typeof realFs

interface JobOptions {
    fs: FsLike
    keyFile: (hex: string) => string
    statfs?: (target: string) => Promise<{ bavail: number, bsize: number }>
    saveDir: string
    exportsDir: string
    env: Record<string, string>
    log: (message: string) => void
}

const { createExportJobs } = createRequire(import.meta.url)('../../../../server/node/exportJob.cjs') as {
    createExportJobs(options: JobOptions): ExportJobs
}

/** The response a download is written to: it keeps every chunk and ends like a socket does. */
class FakeResponse extends EventEmitter {
    chunks: Buffer[] = []
    destroyed = false
    writableFinished = false
    headers: Record<string, string> = {}
    writeHead(_status: number, headers: Record<string, string>): void {
        this.headers = headers
    }
    write(chunk: Uint8Array, callback: (error?: Error) => void): boolean {
        this.chunks.push(Buffer.from(chunk))
        setImmediate(() => callback())
        return true
    }
    end(callback: () => void): void {
        this.writableFinished = true
        setImmediate(() => {
            callback()
            this.emit('close')
        })
    }
    destroy(): void {
        if (!this.destroyed) {
            this.destroyed = true
            setImmediate(() => this.emit('close'))
        }
    }
    body(): Buffer {
        return Buffer.concat(this.chunks)
    }
}

const hexOf = (key: string) => Buffer.from(key, 'utf-8').toString('hex')

let root: string
let keyDir: string
let exportsDir: string
let logged: string[]

beforeEach(async () => {
    root = await realFs.mkdtemp(join(tmpdir(), 'risu-export-job-'))
    keyDir = join(root, 'keys')
    exportsDir = join(root, 'exports')
    await realFs.mkdir(keyDir)
    logged = []
})

afterEach(async () => {
    await realFs.rm(root, { recursive: true, force: true })
})

function makeJobs(overrides: Partial<JobOptions> = {}): ExportJobs {
    return createExportJobs({
        fs: realFs,
        keyFile: (hex) => join(keyDir, hex),
        statfs: undefined,
        saveDir: root,
        exportsDir,
        env: { RISU_EXPORT_FREE_RESERVE_BYTES: '0' },
        log: (message) => logged.push(message),
        ...overrides,
    })
}

async function writeKey(key: string, bytes: Buffer): Promise<string> {
    const file = join(keyDir, hexOf(key))
    await realFs.writeFile(file, bytes)
    return file
}

async function beginJob(jobs: ExportJobs): Promise<string> {
    const answer = await jobs.begin({ filename: 'out.bin', format: 'bin', v: 1 })
    expect(answer.status).toBe(200)
    return String(answer.body.id)
}

function append(jobs: ExportJobs, id: string, seq: number, body: Buffer, extra: { spliceAt?: number, pinKey?: string } = {}): Promise<Answer> {
    return jobs.append({
        id,
        seq: String(seq),
        spliceAt: extra.spliceAt === undefined ? undefined : String(extra.spliceAt),
        pinKey: extra.pinKey,
        body,
    })
}

function entryHeader(key: string, size: number): Buffer {
    return Buffer.from(encodeBackupEntryHeader(Buffer.from(key, 'utf-8'), size))
}

async function waitEnded(jobs: ExportJobs, id: string): Promise<Answer> {
    for (let attempt = 0; attempt < 400; attempt++) {
        const answer = jobs.status(id)
        if (answer.status === 200 && answer.body.state !== 'streaming' && answer.body.state !== 'ready' && answer.body.state !== 'staging') {
            return answer
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error('The download did not end')
}

async function download(jobs: ExportJobs, id: string): Promise<{ bytes: Buffer, tombstone: Answer }> {
    const finalized = await jobs.finalize(id)
    expect(finalized.status).toBe(200)
    const res = new FakeResponse()
    expect(await jobs.download(String(finalized.body.ticket), res)).toBeNull()
    const tombstone = await waitEnded(jobs, id)
    return { bytes: res.body(), tombstone }
}

/** One asset entry split as the page sends it: prefix + pin, then header + tail with the splice point. */
async function stageEntry(jobs: ExportJobs, id: string, firstSeq: number, key: string, size: number, prefix: Buffer, tail: Buffer, pinKeyHex = hexOf(key)): Promise<Answer> {
    const pinned = await append(jobs, id, firstSeq, prefix, { pinKey: pinKeyHex })
    expect(pinned.status).toBe(200)
    const header = entryHeader(key, size)
    return await append(jobs, id, firstSeq + 1, Buffer.concat([header, tail]), { spliceAt: header.length })
}

function errorWithCode(code: string): Error {
    return Object.assign(new Error(code), { code })
}

describe('J1 concurrent same-seq appends', () => {
    test('a second append of the same seq while the first write is gated answers the same and stages once', async () => {
        const release: { fn: () => void } = { fn: () => {} }
        const gate = new Promise<void>((resolve) => { release.fn = resolve })
        const gatedFs: FsLike = {
            ...realFs,
            open: (async (file: string, flags: string) => {
                const handle = await realFs.open(file, flags)
                if (!String(file).endsWith('staged.bin')) {
                    return handle
                }
                return new Proxy(handle, {
                    get(target, property) {
                        if (property === 'write') {
                            return async (...args: Parameters<typeof target.write>) => {
                                await gate
                                return await (target.write as (...a: unknown[]) => Promise<unknown>)(...args)
                            }
                        }
                        const value = Reflect.get(target, property) as unknown
                        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
                    },
                })
            }) as FsLike['open'],
        }
        const jobs = makeJobs({ fs: gatedFs })
        const id = await beginJob(jobs)
        const body = Buffer.from('first-bytes')
        const first = append(jobs, id, 0, body)
        const second = append(jobs, id, 0, body)
        await new Promise((resolve) => setTimeout(resolve, 30))
        release.fn()
        const [a, b] = await Promise.all([first, second])
        expect(a).toEqual(b)
        expect(a.status).toBe(200)
        const result = await download(jobs, id)
        expect(result.bytes.equals(body)).toBe(true)
    })

    test('the next seq sent while the first is still being written waits for it and both apply in order', async () => {
        const release: { fn: () => void } = { fn: () => {} }
        const gate = new Promise<void>((resolve) => { release.fn = resolve })
        const gatedFs: FsLike = {
            ...realFs,
            open: (async (file: string, flags: string) => {
                const handle = await realFs.open(file, flags)
                if (!String(file).endsWith('staged.bin')) {
                    return handle
                }
                return new Proxy(handle, {
                    get(target, property) {
                        if (property === 'write') {
                            return async (...args: Parameters<typeof target.write>) => {
                                await gate
                                return await (target.write as (...a: unknown[]) => Promise<unknown>)(...args)
                            }
                        }
                        const value = Reflect.get(target, property) as unknown
                        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
                    },
                })
            }) as FsLike['open'],
        }
        const jobs = makeJobs({ fs: gatedFs })
        const id = await beginJob(jobs)
        const first = append(jobs, id, 0, Buffer.from('one-'))
        const second = append(jobs, id, 1, Buffer.from('two'))
        await new Promise((resolve) => setTimeout(resolve, 30))
        release.fn()
        const [a, b] = await Promise.all([first, second])
        expect([a.status, b.status]).toEqual([200, 200])
        expect((await download(jobs, id)).bytes.toString()).toBe('one-two')
    })
})

describe('J2 ENOSPC rolls the append back', () => {
    async function dirNames(id: string): Promise<string[]> {
        return (await realFs.readdir(join(exportsDir, id))).sort()
    }

    test('a body write that fails answers 507, stages nothing, and the same seq then succeeds', async () => {
        let failNext = true
        const faulty: FsLike = {
            ...realFs,
            open: (async (file: string, flags: string) => {
                const handle = await realFs.open(file, flags)
                if (!String(file).endsWith('staged.bin')) {
                    return handle
                }
                return new Proxy(handle, {
                    get(target, property) {
                        if (property === 'write') {
                            return async (...args: Parameters<typeof target.write>) => {
                                if (failNext) {
                                    failNext = false
                                    throw errorWithCode('ENOSPC')
                                }
                                return await (target.write as (...a: unknown[]) => Promise<unknown>)(...args)
                            }
                        }
                        const value = Reflect.get(target, property) as unknown
                        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
                    },
                })
            }) as FsLike['open'],
        }
        const jobs = makeJobs({ fs: faulty })
        const id = await beginJob(jobs)
        const body = Buffer.from('abcdef')
        expect((await append(jobs, id, 0, body)).status).toBe(507)
        expect((await append(jobs, id, 0, body)).status).toBe(200)
        expect((await download(jobs, id)).bytes.equals(body)).toBe(true)
    })

    test('a segment-table write that fails truncates the staged bytes to the committed length', async () => {
        let failNext = false
        const faulty: FsLike = {
            ...realFs,
            open: (async (file: string, flags: string) => {
                const handle = await realFs.open(file, flags)
                if (!String(file).endsWith('segments.ndjson')) {
                    return handle
                }
                return new Proxy(handle, {
                    get(target, property) {
                        if (property === 'write') {
                            return async (...args: Parameters<typeof target.write>) => {
                                if (failNext) {
                                    failNext = false
                                    throw errorWithCode('EDQUOT')
                                }
                                return await (target.write as (...a: unknown[]) => Promise<unknown>)(...args)
                            }
                        }
                        const value = Reflect.get(target, property) as unknown
                        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
                    },
                })
            }) as FsLike['open'],
        }
        const jobs = makeJobs({ fs: faulty })
        const id = await beginJob(jobs)
        expect((await append(jobs, id, 0, Buffer.from('keep'))).status).toBe(200)
        failNext = true
        expect((await append(jobs, id, 1, Buffer.from('lost-bytes'))).status).toBe(507)
        expect((await realFs.stat(join(exportsDir, id, 'staged.bin'))).size).toBe(4)
        expect((await append(jobs, id, 1, Buffer.from('later'))).status).toBe(200)
        expect((await download(jobs, id)).bytes.toString()).toBe('keeplater')
    })

    test('a segment-table write that fails after the pin was linked removes the new pin file; the same seq then succeeds', async () => {
        const key = 'assets/rolled.bin'
        const asset = Buffer.from('rolled-back-asset')
        await writeKey(key, asset)
        let failNext = true
        const faulty: FsLike = {
            ...realFs,
            open: (async (file: string, flags: string) => {
                const handle = await realFs.open(file, flags)
                if (!String(file).endsWith('segments.ndjson')) {
                    return handle
                }
                return new Proxy(handle, {
                    get(target, property) {
                        if (property === 'write') {
                            return async (...args: Parameters<typeof target.write>) => {
                                if (failNext) {
                                    failNext = false
                                    throw errorWithCode('EDQUOT')
                                }
                                return await (target.write as (...a: unknown[]) => Promise<unknown>)(...args)
                            }
                        }
                        const value = Reflect.get(target, property) as unknown
                        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
                    },
                })
            }) as FsLike['open'],
        }
        const jobs = makeJobs({ fs: faulty })
        const id = await beginJob(jobs)
        const prefix = Buffer.from('prefix')
        expect((await append(jobs, id, 0, prefix, { pinKey: hexOf(key) })).status).toBe(507)
        expect(await dirNames(id)).toEqual(['segments.ndjson', 'staged.bin'])
        expect((await realFs.stat(join(exportsDir, id, 'staged.bin'))).size).toBe(0)
        const tail = Buffer.from('tail')
        expect((await stageEntry(jobs, id, 0, key, asset.length, prefix, tail)).status).toBe(200)
        const expected = Buffer.concat([prefix, entryHeader(key, asset.length), asset, tail])
        expect((await download(jobs, id)).bytes.equals(expected)).toBe(true)
    })

    test('a pin link that fails with ENOSPC answers 507 and leaves no pin file; the same seq then succeeds', async () => {
        const key = 'assets/space.bin'
        const asset = Buffer.from('asset-bytes')
        await writeKey(key, asset)
        let failNext = true
        const faulty: FsLike = {
            ...realFs,
            link: (async (source: string, target: string) => {
                if (failNext) {
                    failNext = false
                    throw errorWithCode('ENOSPC')
                }
                await realFs.link(source, target)
            }) as FsLike['link'],
        }
        const jobs = makeJobs({ fs: faulty })
        const id = await beginJob(jobs)
        const prefix = Buffer.from('prefix')
        expect((await append(jobs, id, 0, prefix, { pinKey: hexOf(key) })).status).toBe(507)
        expect(await dirNames(id)).toEqual(['segments.ndjson', 'staged.bin'])
        const tail = Buffer.from('tail')
        expect((await stageEntry(jobs, id, 0, key, asset.length, prefix, tail)).status).toBe(200)
        const expected = Buffer.concat([prefix, entryHeader(key, asset.length), asset, tail])
        expect((await download(jobs, id)).bytes.equals(expected)).toBe(true)
    })
})

describe('J7 a replay of the previous seq must match what was applied', () => {
    test('a replay whose body, pin key or splice point differs is 409 export-seq and stages nothing', async () => {
        const jobs = makeJobs()
        const id = await beginJob(jobs)
        const first = await append(jobs, id, 0, Buffer.from('abc'))
        expect(first.status).toBe(200)
        const different = [
            await append(jobs, id, 0, Buffer.from('abd')),
            await append(jobs, id, 0, Buffer.from('abc'), { pinKey: hexOf('assets/other.bin') }),
            await append(jobs, id, 0, Buffer.from('abc'), { spliceAt: 1 }),
        ]
        for (const answer of different) {
            expect(answer.status).toBe(409)
            expect(answer.body.code).toBe('export-seq')
        }
        expect(await append(jobs, id, 0, Buffer.from('abc'))).toEqual(first)
        expect((await append(jobs, id, 1, Buffer.from('def'))).status).toBe(200)
        expect((await download(jobs, id)).bytes.toString()).toBe('abcdef')
    })
})

describe('J3 a replayed pin answer is not re-evaluated', () => {
    test('a replayed seq whose pin answered missing answers missing without linking, even after the key appears', async () => {
        const key = 'assets/late.bin'
        let links = 0
        const counting: FsLike = {
            ...realFs,
            link: (async (source: string, target: string) => {
                links++
                await realFs.link(source, target)
            }) as FsLike['link'],
        }
        const jobs = makeJobs({ fs: counting })
        const id = await beginJob(jobs)
        const body = Buffer.from('p')
        const first = await append(jobs, id, 0, body, { pinKey: hexOf(key) })
        expect(first.body.pin).toBe('missing')
        await writeKey(key, Buffer.from('now present'))
        const replay = await append(jobs, id, 0, body, { pinKey: hexOf(key) })
        expect(replay).toEqual(first)
        expect(links).toBe(1)
    })
})

describe('J8 the idle reaper leaves a streaming job alone', () => {
    test('past the idle bound an idle staging job is reaped and a job whose download is held open is not', async () => {
        class HeldResponse extends FakeResponse {
            writes = 0
            override write(chunk: Uint8Array, _callback: (error?: Error) => void): boolean {
                this.writes += 1
                this.chunks.push(Buffer.from(chunk))
                return true
            }
        }
        const jobs = makeJobs({ env: { RISU_EXPORT_FREE_RESERVE_BYTES: '0', RISU_EXPORT_IDLE_MS: '50' } })
        const idle = await beginJob(jobs)
        const streaming = await beginJob(jobs)
        expect((await append(jobs, streaming, 0, Buffer.from('held-bytes'))).status).toBe(200)
        const finalized = await jobs.finalize(streaming)
        expect(finalized.status).toBe(200)
        const res = new HeldResponse()
        expect(await jobs.download(String(finalized.body.ticket), res)).toBeNull()
        const deadline = Date.now() + 5000
        while (res.writes === 0 && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 10))
        }
        expect(res.writes).toBeGreaterThan(0)
        await new Promise((resolve) => setTimeout(resolve, 150))
        await jobs.reap()
        expect(jobs.status(idle).body).toMatchObject({ state: 'failed', failure: 'idle' })
        const held = jobs.status(streaming)
        expect(held.status).toBe(200)
        expect(held.body.state).toBe('streaming')
        expect(res.destroyed).toBe(false)
        expect((await jobs.abort(streaming)).status).toBe(200)
    })
})

describe('J4 link failures take the identity mode', () => {
    const key = 'assets/ident.bin'
    const asset = Buffer.from('identity-mode-asset')

    test.each(['EISDIR', 'ENOSYS', 'EPERM', 'EXDEV'])('a link that fails with %s pins by identity and the download is exact', async (code) => {
        await writeKey(key, asset)
        const faulty: FsLike = {
            ...realFs,
            link: (async () => {
                throw errorWithCode(code)
            }) as FsLike['link'],
        }
        const jobs = makeJobs({ fs: faulty })
        const id = await beginJob(jobs)
        const prefix = Buffer.from('head')
        const tail = Buffer.from('end')
        expect((await stageEntry(jobs, id, 0, key, asset.length, prefix, tail)).status).toBe(200)
        const expected = Buffer.concat([prefix, entryHeader(key, asset.length), asset, tail])
        const result = await download(jobs, id)
        expect(result.bytes.equals(expected)).toBe(true)
        expect(result.tombstone.body.state).toBe('done')
    })

    test('an identity open that finds nothing answers missing', async () => {
        const faulty: FsLike = {
            ...realFs,
            link: (async () => {
                throw errorWithCode('EPERM')
            }) as FsLike['link'],
        }
        const jobs = makeJobs({ fs: faulty })
        const id = await beginJob(jobs)
        expect((await append(jobs, id, 0, Buffer.from('x'), { pinKey: hexOf('assets/none.bin') })).body.pin).toBe('missing')
    })

    test('a key that is not a regular file answers 400 export-key', async () => {
        const dirKey = 'assets/dir.bin'
        const dirFile = join(keyDir, hexOf(dirKey))
        const faulty: FsLike = {
            ...realFs,
            link: (async () => {
                throw errorWithCode('EISDIR')
            }) as FsLike['link'],
            open: (async (file: string, flags: string) => {
                if (file === dirFile) {
                    return { stat: async () => ({ isFile: () => false }), close: async () => {} }
                }
                return await realFs.open(file, flags)
            }) as FsLike['open'],
        }
        const jobs = makeJobs({ fs: faulty })
        const id = await beginJob(jobs)
        const answer = await append(jobs, id, 0, Buffer.from('x'), { pinKey: hexOf(dirKey) })
        expect(answer.status).toBe(400)
        expect(answer.body.code).toBe('export-key')
        expect((await realFs.stat(join(exportsDir, id, 'staged.bin'))).size).toBe(0)
    })
})

describe('J5 free-space reserve', () => {
    const env = { RISU_EXPORT_FREE_RESERVE_BYTES: '1000' }

    test('begin below the reserve answers 507 and creates no directory', async () => {
        const jobs = makeJobs({ env, statfs: async () => ({ bavail: 999, bsize: 1 }) })
        const answer = await jobs.begin({ filename: 'out.bin', format: 'bin', v: 1 })
        expect(answer.status).toBe(507)
        await expect(realFs.readdir(exportsDir)).rejects.toMatchObject({ code: 'ENOENT' })
    })

    test('an append that would cross the reserve answers 507, stages nothing and keeps its seq', async () => {
        let free = 100000
        const jobs = makeJobs({ env, statfs: async () => ({ bavail: free, bsize: 1 }) })
        const id = await beginJob(jobs)
        free = 1005
        expect((await append(jobs, id, 0, Buffer.from('0123456789'))).status).toBe(507)
        expect((await realFs.stat(join(exportsDir, id, 'staged.bin'))).size).toBe(0)
        free = 100000
        expect((await append(jobs, id, 0, Buffer.from('0123456789'))).status).toBe(200)
    })

    test('a statfs that throws skips the check, logs once and applies the append', async () => {
        const jobs = makeJobs({
            env,
            statfs: async () => {
                throw errorWithCode('ENOSYS')
            },
        })
        const id = await beginJob(jobs)
        expect((await append(jobs, id, 0, Buffer.from('a'))).status).toBe(200)
        expect((await append(jobs, id, 1, Buffer.from('b'))).status).toBe(200)
        expect(logged.filter((line) => line.includes('free-space reserve'))).toHaveLength(1)
    })
})

describe('J6 keys resolve through the injected keyFile', () => {
    const key = 'assets/Case.bin'
    const asset = Buffer.from('sentinel-resolved')

    test.each([
        ['linked pin', {}],
        ['identity pin', { RISU_EXPORT_PIN: 'off' }],
    ])('an uppercase pin-key reaches keyFile as lowercase hex (%s)', async (_label, extraEnv) => {
        const seen: string[] = []
        const sentinel = (hex: string) => join(keyDir, `sentinel-${hex}`)
        await realFs.writeFile(sentinel(hexOf(key)), asset)
        const jobs = makeJobs({
            env: { RISU_EXPORT_FREE_RESERVE_BYTES: '0', ...extraEnv },
            keyFile: (hex) => {
                seen.push(hex)
                return sentinel(hex)
            },
        })
        const id = await beginJob(jobs)
        const prefix = Buffer.from('p')
        const tail = Buffer.from('t')
        expect((await stageEntry(jobs, id, 0, key, asset.length, prefix, tail, hexOf(key).toUpperCase())).status).toBe(200)
        const result = await download(jobs, id)
        expect(result.bytes.equals(Buffer.concat([prefix, entryHeader(key, asset.length), asset, tail]))).toBe(true)
        expect(seen.length).toBeGreaterThan(0)
        expect(seen.every((hex) => hex === hexOf(key))).toBe(true)
    })
})
