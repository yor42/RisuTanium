// @vitest-environment node
/**
 * The batched store2 unit read (`read_store2_units`) through the real Tauri backend over the real `createTauriFilesStore`, on
 * the desktop command and file system stand-ins, with the platform chosen per test. The integrity rule under test: the batch
 * supplies only `ok` bytes, and every other key is read per key, so a read gives the outcome the per-key path gives. The arms
 * are the default (batch) and the measurement knob `risu-measure-store2-batch=off` (per key). A pass is not evidence about the
 * Rust command or the native bridge; the fake follows the Rust key guard and budget over a shared case table.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = await vi.hoisted(async () => {
    const fs = (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true })
    const desktop = (await import('src/ts/storage/tests/tauriDesktopFake')).createDesktopInvoke(fs)
    const paths = (await import('src/ts/storage/tests/tauriPathFake')).createFakeTauriPaths()
    /** What the operating-system plugin answers; `throw` is a page without the plugin. */
    const os: { kind: string } = { kind: 'android' }
    /** The page's `document`: only the visibility the freeze rule reads. */
    const page: { visibilityState: string } = { visibilityState: 'visible' }
    /** The page's `localStorage`. */
    const knobs = new Map<string, string>()
    /** The desktop `write_durable` answers `{ flushed }` as the Rust command does. */
    async function invoke(command: string, args?: unknown, options?: { headers?: Record<string, string> }): Promise<unknown> {
        const reply = await desktop.invoke(command, args, options)
        return command === 'write_durable' ? { flushed: true } : reply
    }
    return { fs, desktop, paths, os, page, knobs, invoke }
})

vi.mock('@tauri-apps/plugin-fs', () => h.fs.module)
vi.mock('@tauri-apps/api/path', () => h.paths.pathModule)
vi.mock('@tauri-apps/api/core', () => ({ ...h.paths.coreModule, invoke: h.invoke }))
vi.mock('@tauri-apps/plugin-os', () => ({
    type: () => {
        if (h.os.kind === 'throw') {
            throw new Error('no operating-system plugin')
        }
        return h.os.kind
    },
}))

import { createHash } from 'node:crypto'
import { Store2BackendFailureError, createTauriBackend, type Store2Backend, type UnitWrite } from 'src/ts/storage/store2/backend'
import { keyOfRef, readUnit, UNIT_TYPE, type Shard, type ShardEntry } from 'src/ts/storage/store2/format'
import { readEntityBytes } from 'src/ts/storage/store2/treeBytes'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'
import { resetByteTransportForTests, type TransportKind } from 'src/ts/storage/tauriByteTransport'
import { STORE2_BATCH_TRANSPORTS, parseStore2BatchFrames, store2BatchTransport, takeStore2BatchStats } from 'src/ts/storage/tauriStore2Batch'
import { createClock, seedTree, testEnv } from '../store2SaveKit'
import { absentCommit, bytesOf, runBackendConformance, unitKey } from './backendConformance'
import { buildSmall, fakeLists } from './codecFixtures'

const KNOB = 'risu-measure-store2-batch'
// Whether the desktop transport batches; the Q1 follow-up flips the platform switch and every expectation follows.
const desktopBatches = store2BatchTransport('desktop')
const MiB = 1024 * 1024

type Os = 'android' | 'windows' | 'linux' | 'macos'

function setKnob(value: string | null): void {
    if (value === null) {
        h.knobs.delete(KNOB)
    } else {
        h.knobs.set(KNOB, value)
    }
}

/** How many batch calls a read makes on `os` when the platform switch lets the transport batch. */
function batchesOn(os: Os, calls: number): number {
    return os === 'android' || desktopBatches ? calls : 0
}

beforeEach(() => {
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => h.knobs.get(key) ?? null,
        setItem: (key: string, value: string) => { h.knobs.set(key, value) },
        removeItem: (key: string) => { h.knobs.delete(key) },
    })
    vi.stubGlobal('document', h.page)
})

afterEach(() => {
    vi.unstubAllGlobals()
})

function reset(os: string): void {
    h.os.kind = os
    h.page.visibilityState = 'visible'
    h.knobs.clear()
    h.fs.reset()
    h.desktop.reset()
    h.paths.reset()
    h.desktop.chunk.reportFlushes()
    h.fs.setPlatform(os === 'windows' ? 'windows' : 'posix')
    resetByteTransportForTests()
    takeStore2BatchStats()
}

async function open(os: string): Promise<{ store: ByteStore, backend: Store2Backend }> {
    const store = createTauriFilesStore({ platform: os === 'windows' ? 'windows' : 'posix' })
    return { store, backend: await createTauriBackend(store) }
}

/** Distinct bytes for a seed: no two units of a test share content. */
function patterned(seed: number, length: number): Uint8Array {
    const bytes = new Uint8Array(length)
    for (let i = 0; i < length; i++) {
        bytes[i] = (seed * 31 + i * 7 + (i >> 8) * 13) & 255
    }
    return bytes
}

async function commit(backend: Store2Backend, units: readonly UnitWrite[]): Promise<void> {
    await backend.commitOrdinary((await backend.readCommit()).token, units, bytesOf(9))
}

/** Commits `lengths.length` units numbered from `first` and answers their keys and bytes. */
async function putUnits(backend: Store2Backend, lengths: readonly number[], first = 1): Promise<{ keys: string[], bytes: Uint8Array[] }> {
    const keys = lengths.map((_, i) => unitKey(first + i))
    const bytes = lengths.map((length, i) => patterned(first + i, length))
    await commit(backend, keys.map((key, i) => ({ key, bytes: bytes[i] })))
    return { keys, bytes }
}

function digest(bytes: Uint8Array): string {
    return `${bytes.length}:${createHash('sha1').update(bytes).digest('hex')}`
}

const batchCalls = () => h.desktop.chunk.callsOf('read_store2_units')
const store2RangeKeys = (): string[] => h.desktop.chunk.callsOf('read_range').map((call) => String(call.args.key)).filter((key) => key.startsWith('store2/'))
const sentKeys = (): string[][] => batchCalls().map((call) => call.args.keys as string[])

type Outcome =
    | { kind: 'read', entries: { key: string, digest: string | null }[] }
    | { kind: 'error', name: string, cause: string }

async function outcomeOf(backend: Store2Backend, keys: readonly string[]): Promise<Outcome> {
    try {
        const read = await backend.readUnits(keys)
        return { kind: 'read', entries: [...read].map(([key, bytes]) => ({ key, digest: bytes === null ? null : digest(bytes) })) }
    } catch (error) {
        const cause = error instanceof Error ? error.cause : undefined
        return { kind: 'error', name: error instanceof Error ? error.constructor.name : typeof error, cause: cause instanceof Error ? cause.constructor.name : 'none' }
    }
}

interface Row {
    name: string
    /** Plants the state, sets any fault, and answers the keys to read. */
    setup(backend: Store2Backend): Promise<string[]>
    /** Batch calls the default arm makes where the transport batches. */
    calls: number
    /** What the outcome must be, so a row that agrees on nothing meaningful fails. */
    shape(outcome: Outcome): void
}

function readEntries(outcome: Outcome): { key: string, digest: string | null }[] {
    if (outcome.kind !== 'read') {
        throw new Error(`expected a read, got ${outcome.name}`)
    }
    return outcome.entries
}

const ROWS: Row[] = [
    {
        name: 'ok units',
        calls: 1,
        setup: async (backend) => (await putUnits(backend, [10, 20, 30])).keys,
        shape: (o) => expect(readEntries(o).every((entry) => entry.digest !== null)).toBe(true),
    },
    {
        name: 'an absent unit among present ones',
        calls: 1,
        setup: async (backend) => {
            const { keys } = await putUnits(backend, [10, 20])
            return [keys[0], unitKey(77), keys[1]]
        },
        shape: (o) => expect(readEntries(o).map((entry) => entry.digest === null)).toEqual([false, true, false]),
    },
    {
        name: 'a directory at a unit key',
        calls: 1,
        setup: async (backend) => {
            const { keys } = await putUnits(backend, [10, 20])
            h.fs.directories.add(unitKey(77))
            return [keys[0], unitKey(77), keys[1]]
        },
        shape: (o) => expect(o).toMatchObject({ kind: 'error', name: 'Store2BackendFailureError' }),
    },
    {
        name: 'an injected read fault on one unit',
        calls: 1,
        setup: async (backend) => {
            const { keys } = await putUnits(backend, [10, 20, 30])
            h.desktop.chunk.failBatchKey(keys[1], 'error')
            h.desktop.chunk.hooks.before = ({ key }) => {
                if (key === keys[1]) {
                    throw `failed to read ${key}: Input/output error (os error 5)`
                }
            }
            return keys
        },
        shape: (o) => expect(o).toMatchObject({ kind: 'error', name: 'Store2BackendFailureError' }),
    },
    {
        name: 'a 4.48 MiB unit among small ones',
        calls: 1,
        setup: async (backend) => (await putUnits(backend, [10, Math.round(4.48 * MiB), 30])).keys,
        // The large unit is read per key after the batch answered the others, and still holds its place in the request order.
        shape: (o) => {
            expect(readEntries(o).every((entry) => entry.digest !== null)).toBe(true)
            expect(readEntries(o).map((entry) => entry.key)).toEqual([unitKey(1), unitKey(2), unitKey(3)])
        },
    },
    {
        name: 'units summing over 4 MiB',
        calls: 2,
        setup: async (backend) => (await putUnits(backend, [1_677_722, 1_677_722, 1_677_722, 10, 20])).keys,
        shape: (o) => expect(readEntries(o).every((entry) => entry.digest !== null)).toBe(true),
    },
    {
        name: '300 units',
        calls: 2,
        setup: async (backend) => (await putUnits(backend, Array.from({ length: 300 }, (_, i) => 5 + (i % 7)))).keys,
        shape: (o) => expect(readEntries(o)).toHaveLength(300),
    },
    {
        name: 'a duplicate key',
        calls: 0,
        setup: async (backend) => {
            const { keys } = await putUnits(backend, [10, 20])
            return [keys[0], keys[1], keys[0]]
        },
        shape: (o) => expect(o).toMatchObject({ kind: 'error', name: 'RangeError' }),
    },
    {
        name: 'no key',
        calls: 0,
        setup: async () => [],
        shape: (o) => expect(readEntries(o)).toEqual([]),
    },
    {
        name: 'one key',
        calls: 0,
        setup: async (backend) => (await putUnits(backend, [10])).keys,
        shape: (o) => expect(readEntries(o)).toHaveLength(1),
    },
    {
        name: 'request order, not storage order',
        calls: 1,
        setup: async (backend) => (await putUnits(backend, [10, 20, 30, 40])).keys.reverse(),
        shape: (o) => expect(readEntries(o).map((entry) => entry.key)).toEqual([unitKey(4), unitKey(3), unitKey(2), unitKey(1)]),
    },
]

async function runArm(os: Os, arm: 'batch' | 'off', row: Row): Promise<{ outcome: Outcome, invokes: number }> {
    reset(os)
    const { backend } = await open(os)
    const keys = await row.setup(backend)
    h.desktop.chunk.calls.length = 0
    setKnob(arm === 'off' ? 'off' : null)
    const outcome = await outcomeOf(backend, keys)
    return { outcome, invokes: batchCalls().length }
}

describe('T4.3 the batch arm and the per-key arm agree, per row and platform', () => {
    for (const os of ['android', 'windows'] as const) {
        describe(os, () => {
            test.each(ROWS)('$name', async (row) => {
                const off = await runArm(os, 'off', row)
                const on = await runArm(os, 'batch', row)

                expect(off.invokes).toBe(0)
                expect(on.invokes).toBe(batchesOn(os, row.calls))
                expect(on.outcome).toEqual(off.outcome)
                row.shape(on.outcome)
            })
        })
    }
})

describe('T4.3-D the desktop switched off: the same rows make no invoke on any desktop OS', () => {
    let removed = false

    beforeEach(() => {
        const switches = STORE2_BATCH_TRANSPORTS as TransportKind[]
        const index = switches.indexOf('desktop')
        removed = index >= 0
        if (removed) {
            switches.splice(index, 1)
        }
    })

    afterEach(() => {
        if (removed) {
            (STORE2_BATCH_TRANSPORTS as TransportKind[]).push('desktop')
        }
    })

    for (const os of ['windows', 'linux', 'macos'] as const) {
        test.each(ROWS)(`${os}: $name`, async (row) => {
            const off = await runArm(os, 'off', row)
            reset(os)
            const { backend } = await open(os)
            const keys = await row.setup(backend)
            h.desktop.chunk.calls.length = 0
            const outcome = await outcomeOf(backend, keys)

            expect(batchCalls()).toHaveLength(0)
            expect(outcome).toEqual(off.outcome)
        })
    }
})

describe('T4.3 key rules: what the batch never sends or never trusts', () => {
    /** The status byte of every frame of every batch reply, in order. */
    function captureReplies(): Uint8Array[] {
        const replies: Uint8Array[] = []
        h.desktop.chunk.rewriteBatchReply((reply) => {
            replies.push(new Uint8Array(reply.slice(0)))
            return reply
        })
        return replies
    }

    function statusesOf(reply: Uint8Array, count: number): number[] {
        const view = new DataView(reply.buffer, reply.byteOffset, reply.byteLength)
        const statuses: number[] = []
        let offset = 0
        for (let i = 0; i < count; i++) {
            statuses.push(reply[offset])
            offset += 5 + view.getUint32(offset + 1, true)
        }
        return statuses
    }

    test.each(['android', 'windows'] as const)('%s: a key the store refuses (store2/../x) is named by no call, and its per-key read throws the store error', async (os) => {
        reset(os)
        const { store, backend } = await open(os)
        const { keys } = await putUnits(backend, [10, 20])
        h.desktop.chunk.calls.length = 0

        const answered = await store.readUnitBatch!([keys[0], 'store2/../x', keys[1]])

        expect(batchCalls().flatMap((call) => call.args.keys as string[])).not.toContain('store2/../x')
        expect(answered === null ? [] : [...answered.keys()].sort()).toEqual(batchesOn(os, 1) === 0 ? [] : [...keys].sort())
        await expect(store.read('store2/../x')).rejects.toThrow()
    })

    test.each(['android', 'windows'] as const)('%s with the Windows key rule: store2/a\\b is an invalid frame, never ok and never store2/a/b, and both arms reject it per key', async (os) => {
        reset(os)
        h.fs.setPlatform('windows')
        const { store, backend } = await open('windows')
        const { keys } = await putUnits(backend, [10, 20])
        const decoy = patterned(90, 15)
        h.fs.plant('store2/a/b', decoy)
        h.desktop.chunk.windowsKeyRules()
        const replies = captureReplies()
        const wire = 'store2/a\\b'

        const answered = await store.readUnitBatch!([keys[0], wire, keys[1]])

        expect(replies).toHaveLength(batchesOn(os, 1))
        if (replies.length === 1) {
            expect(statusesOf(replies[0], 3)).toEqual([0, 2, 0])
        }
        const returned = answered === null ? [] : [...answered.values()].map(digest)
        expect(returned).not.toContain(digest(decoy))
        expect(answered?.has(wire) ?? false).toBe(false)
        // The per-key read of the key is refused by the command, which is a failure and never an absence.
        await expect(store.read(wire)).rejects.toThrow()
        setKnob('off')
        expect(await store.readUnitBatch!([keys[0], wire, keys[1]])).toBeNull()
        await expect(store.read(wire)).rejects.toThrow()
    })

    test('linux: store2/a\\b planted as a literal name is read by the batch and by the per-key read alike', async () => {
        reset('linux')
        const { store, backend } = await open('linux')
        const { keys } = await putUnits(backend, [10, 20])
        const literal = patterned(91, 25)
        h.fs.plant('store2/a\\b', literal)
        const wire = 'store2/a\\b'
        h.desktop.chunk.calls.length = 0

        const answered = await store.readUnitBatch!([keys[0], wire, keys[1]])
        setKnob('off')
        const perKey = (await store.read(wire)).bytes

        if (desktopBatches) {
            expect(digest(answered?.get(wire) as Uint8Array)).toBe(digest(literal))
        } else {
            expect(answered).toBeNull()
        }
        expect(perKey === null ? null : digest(perKey)).toBe(digest(literal))
    })
})

describe('T4.5 an I/O error is never null', () => {
    test.each(['android', 'windows'] as const)('%s: an error frame and a failing per-key read reject, they do not read as absent', async (os) => {
        reset(os)
        const { backend } = await open(os)
        const { keys } = await putUnits(backend, [10, 20, 30])
        h.desktop.chunk.failBatchKey(keys[1], 'error')
        h.desktop.chunk.hooks.before = ({ key }) => {
            if (key === keys[1]) {
                throw `failed to read ${key}: Input/output error (os error 5)`
            }
        }

        await expect(backend.readUnits(keys)).rejects.toBeInstanceOf(Store2BackendFailureError)
    })
})

describe('T4.6 a missing frame raced by a present file', () => {
    test.each(['android', 'windows'] as const)('%s: the key is read per key and holds its bytes', async (os) => {
        reset(os)
        const { backend } = await open(os)
        const { keys, bytes } = await putUnits(backend, [10, 20, 30])
        h.desktop.chunk.failBatchKey(keys[1], 'missing')

        const read = await backend.readUnits(keys)

        expect(digest(read.get(keys[1]) as Uint8Array)).toBe(digest(bytes[1]))
        expect(store2RangeKeys()).toContain(keys[1])
    })
})

describe('T4.7 a malformed reply is discarded whole', () => {
    const concat = (...parts: Uint8Array[]): Uint8Array => {
        const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
        let at = 0
        for (const part of parts) {
            out.set(part, at)
            at += part.length
        }
        return out
    }
    const frame = (status: number, body: number[]): Uint8Array => {
        const out = new Uint8Array(5 + body.length)
        out[0] = status
        new DataView(out.buffer).setUint32(1, body.length, true)
        out.set(body, 5)
        return out
    }
    // Each reply opens with an ok frame of WRONG bytes, which no part of a discarded reply may reach the caller.
    const wrong = frame(0, [99, 99, 99])
    const variants: [string, () => unknown][] = [
        ['a truncated header', () => concat(wrong, Uint8Array.of(0, 1, 0)).buffer],
        ['a truncated body', () => concat(wrong, frame(0, [1, 2, 3]).subarray(0, 7)).buffer],
        ['a trailing byte', () => concat(wrong, frame(0, [1]), frame(0, [2]), Uint8Array.of(0)).buffer],
        ['an unknown status', () => concat(wrong, frame(6, []), frame(0, [2])).buffer],
        ['a body on a missing frame', () => concat(wrong, frame(1, [5]), frame(0, [2])).buffer],
        ['a body on a large frame', () => concat(wrong, frame(4, [5]), frame(0, [2])).buffer],
        ['a body on a deferred frame', () => concat(wrong, frame(5, [5]), frame(0, [2])).buffer],
        ['one frame too few', () => concat(wrong, frame(0, [1])).buffer],
        ['a string', () => 'garbage'],
    ]

    for (const os of ['android', 'windows'] as const) {
        test.each(variants)(`${os}: %s`, async (_name, make) => {
            reset(os)
            const { backend } = await open(os)
            const { keys, bytes } = await putUnits(backend, [10, 20, 30])
            h.desktop.chunk.rewriteBatchReply(() => make())

            const read = await backend.readUnits(keys)

            expect(keys.map((key) => digest(read.get(key) as Uint8Array))).toEqual(bytes.map(digest))
            if (batchesOn(os, 1) === 1) {
                expect(store2RangeKeys().sort()).toEqual([...keys].sort())
                expect(takeStore2BatchStats()).toMatchObject({ calls: 1, fallbackKeys: 3 })
            }
        })
    }
})

describe('T4.8 a failed batch call', () => {
    test.each(['android', 'windows'] as const)('%s: every key is read per key', async (os) => {
        reset(os)
        const { backend } = await open(os)
        const { keys, bytes } = await putUnits(backend, [10, 20, 30])
        h.desktop.chunk.failBatchCalls('transport lost')

        const read = await backend.readUnits(keys)

        expect(keys.map((key) => digest(read.get(key) as Uint8Array))).toEqual(bytes.map(digest))
        expect(batchCalls()).toHaveLength(batchesOn(os, 1))
        expect(store2RangeKeys().sort()).toEqual([...keys].sort())
    })
})

describe('T4.9 large and deferred keys', () => {
    test.each(['android', 'windows'] as const)('%s: a unit over 4 MiB is read per key and the small ones are not', async (os) => {
        reset(os)
        const { backend } = await open(os)
        const { keys, bytes } = await putUnits(backend, [10, Math.round(4.48 * MiB), 20, 30])
        h.desktop.chunk.calls.length = 0

        const read = await backend.readUnits(keys)

        expect(keys.map((key) => digest(read.get(key) as Uint8Array))).toEqual(bytes.map(digest))
        expect(batchCalls()).toHaveLength(batchesOn(os, 1))
        if (batchesOn(os, 1) === 1) {
            expect(store2RangeKeys().length).toBeGreaterThanOrEqual(1)
            expect(new Set(store2RangeKeys())).toEqual(new Set([keys[1]]))
        }
    })

    test.each(['android', 'windows'] as const)('%s: three 1.6 MiB units and two small ones take two calls, the second naming exactly the deferred tail', async (os) => {
        reset(os)
        const { backend } = await open(os)
        const { keys, bytes } = await putUnits(backend, [1_677_722, 1_677_722, 1_677_722, 10, 20])
        h.desktop.chunk.calls.length = 0

        const read = await backend.readUnits(keys)

        expect(keys.map((key) => digest(read.get(key) as Uint8Array))).toEqual(bytes.map(digest))
        expect(batchCalls()).toHaveLength(batchesOn(os, 2))
        if (batchesOn(os, 2) === 2) {
            expect(sentKeys()).toEqual([keys, keys.slice(2)])
            expect(store2RangeKeys()).toEqual([])
        }
    })
})

describe('T4.10 a call holds at most 256 keys', () => {
    test.each(['android', 'windows'] as const)('%s: 300 keys are asked in calls of 256 and 44', async (os) => {
        reset(os)
        const { backend } = await open(os)
        const { keys, bytes } = await putUnits(backend, Array.from({ length: 300 }, (_, i) => 5 + (i % 7)))
        h.desktop.chunk.calls.length = 0

        const read = await backend.readUnits(keys)

        expect(keys.map((key) => digest(read.get(key) as Uint8Array))).toEqual(bytes.map(digest))
        expect(sentKeys().map((sent) => sent.length)).toEqual(os === 'android' || desktopBatches ? [256, 44] : [])
    })

    test('the stand-in refuses more than 256 keys as the command does', async () => {
        reset('android')
        await expect(h.desktop.chunk.invoke('read_store2_units', { keys: Array.from({ length: 257 }, (_, i) => unitKey(i)) })).rejects.toMatch(/^refused:/)
    })
})

describe('T4.11 when no batch is made', () => {
    async function twoUnits(os: string): Promise<{ backend: Store2Backend, keys: string[] }> {
        reset(os)
        const { backend } = await open(os)
        const { keys } = await putUnits(backend, [10, 20])
        h.desktop.chunk.calls.length = 0
        return { backend, keys }
    }

    test('android with its page hidden: no call, the read still returns', async () => {
        const { backend, keys } = await twoUnits('android')
        h.page.visibilityState = 'hidden'

        const read = await backend.readUnits(keys)

        expect(batchCalls()).toHaveLength(0)
        expect(keys.every((key) => read.get(key) !== null)).toBe(true)
    })

    test('the page hidden after the first call of a deferral: no second call, the rest is read per key', async () => {
        reset('android')
        const { backend } = await open('android')
        const { keys, bytes } = await putUnits(backend, [1_677_722, 1_677_722, 1_677_722, 10, 20])
        h.desktop.chunk.calls.length = 0
        h.desktop.chunk.rewriteBatchReply((reply) => {
            h.page.visibilityState = 'hidden'
            return reply
        })

        const read = await backend.readUnits(keys)

        expect(batchCalls()).toHaveLength(1)
        expect(keys.map((key) => digest(read.get(key) as Uint8Array))).toEqual(bytes.map(digest))
        expect(store2RangeKeys().sort()).toEqual(keys.slice(2).sort())
    })

    test('windows with its page hidden: the desktop page does not freeze, so the batch is used', async () => {
        const { backend, keys } = await twoUnits('windows')
        h.page.visibilityState = 'hidden'

        await backend.readUnits(keys)

        expect(batchCalls()).toHaveLength(desktopBatches ? 1 : 0)
    })

    test('a page without the operating-system plugin: no call', async () => {
        const { backend, keys } = await twoUnits('android')
        h.os.kind = 'throw'

        await backend.readUnits(keys).catch(() => undefined)

        expect(batchCalls()).toHaveLength(0)
    })

    test.each(['android', 'windows'] as const)('%s: the knob off makes no call and counts the read', async (os) => {
        const { backend, keys } = await twoUnits(os)
        setKnob('off')

        await backend.readUnits(keys)

        expect(batchCalls()).toHaveLength(0)
        expect(takeStore2BatchStats()).toMatchObject({ calls: 0, offCalls: 1 })
    })

    test('one key, and no key: no call', async () => {
        const { backend, keys } = await twoUnits('android')

        await backend.readUnits([keys[0]])
        await backend.readUnits([])

        expect(batchCalls()).toHaveLength(0)
    })

    test('the knob is read on every call: a change takes effect on the next read', async () => {
        const { backend, keys } = await twoUnits('android')
        takeStore2BatchStats()

        await backend.readUnits(keys)
        expect(batchCalls()).toHaveLength(1)

        setKnob('off')
        await backend.readUnits(keys)
        expect(batchCalls()).toHaveLength(1)
        expect(takeStore2BatchStats()).toMatchObject({ offCalls: 1 })

        setKnob(null)
        await backend.readUnits(keys)
        expect(batchCalls()).toHaveLength(2)
    })
})

describe('T4.12 every unit owns exactly its bytes', () => {
    test.each(['android', 'windows'] as const)('%s: no unit is a view into the reply, and overwriting one leaves the others', async (os) => {
        reset(os)
        const { backend } = await open(os)
        const { keys, bytes } = await putUnits(backend, [1_677_722, 1_677_722, 1_677_722, 10, 20])

        const read = await backend.readUnits(keys)

        for (const key of keys) {
            const unit = read.get(key) as Uint8Array
            expect(unit.byteOffset).toBe(0)
            expect(unit.buffer.byteLength).toBe(unit.byteLength)
        }
        ;(read.get(keys[0]) as Uint8Array).fill(0)
        expect(keys.slice(1).map((key) => digest(read.get(key) as Uint8Array))).toEqual(bytes.slice(1).map(digest))
    })
})

describe('T4.19 an entity read gives the same outcome through the batch and per key', () => {
    function shardEntries(shards: readonly Parameters<typeof keyOfRef>[0][]): ShardEntry[] {
        return shards.flatMap((ref) => {
            const stored = h.fs.files.get(keyOfRef(ref))
            const parsed = stored === undefined ? undefined : readUnit(stored, UNIT_TYPE.shard)
            if (parsed === undefined || (parsed.status !== 'ok' && parsed.status !== 'stale')) {
                throw new Error('the shard unit does not parse')
            }
            return (parsed.value.body as Shard).entries
        })
    }

    async function seeded(os: Os) {
        reset(os)
        const { backend } = await open(os)
        const clock = createClock()
        const tree = await seedTree(backend, JSON.parse(JSON.stringify(buildSmall(2))), testEnv(clock, 4242), fakeLists)
        const entry = shardEntries(tree.tree.manifest.shards)[0]
        const leaves = [entry.core, entry.lore, entry.scripts, entry.al, entry.il, ...entry.chats.flatMap((chat) => [chat.core, ...chat.chunks])]
            .flatMap((ref) => (ref === null ? [] : [keyOfRef(ref)]))
        return { backend, entry, leaves }
    }

    async function readBoth(backend: Store2Backend, entry: ShardEntry) {
        h.desktop.chunk.calls.length = 0
        setKnob(null)
        const batch = await readEntityBytes(backend, entry)
        const batched = batchCalls().length
        setKnob('off')
        const perKey = await readEntityBytes(backend, entry)
        return { batch, perKey, batched }
    }

    test.each(['android', 'windows'] as const)('%s: an intact entity reads ok with the same bytes', async (os) => {
        const { backend, entry, leaves } = await seeded(os)

        const { batch, perKey, batched } = await readBoth(backend, entry)

        expect(batch.status).toBe('ok')
        expect(batched).toBeGreaterThanOrEqual(batchesOn(os, 1))
        if (batch.status === 'ok' && perKey.status === 'ok') {
            expect(batch.bytes).toBe(perKey.bytes)
            for (const key of leaves) {
                expect(digest(batch.source.get(key) as Uint8Array)).toBe(digest(perKey.source.get(key) as Uint8Array))
            }
        } else {
            throw new Error(`the entity read ${batch.status} and ${perKey.status}`)
        }
    })

    test.each(['android', 'windows'] as const)('%s: a CRC-damaged unit and an absent unit are damaged in both arms, flagged alike', async (os) => {
        const { backend, entry, leaves } = await seeded(os)
        const damagedKey = leaves[1]
        const absentKey = leaves[2]
        const stored = h.fs.files.get(damagedKey) as Uint8Array
        const flipped = new Uint8Array(stored)
        flipped[flipped.length - 1] ^= 0xff
        h.fs.files.set(damagedKey, flipped)
        h.fs.files.delete(absentKey)

        const { batch, perKey } = await readBoth(backend, entry)

        expect(batch.status).toBe('damaged')
        expect(perKey).toEqual(batch)
    })
})

/**
 * The shared conformance suite through the batch path. A key whose frame was `ok` must never be read per key by the same
 * multi-key `readUnits` (that would be the ok bytes ignored or read twice), and the suite must have made batch calls at all.
 */
function batchConformance(name: string, os: Os, expectBatches: boolean): void {
    describe(name, () => {
        const violations: string[] = []
        let totalBatches = 0
        const okKeysOfCalls: Set<string>[] = []

        afterEach(() => {
            expect(violations).toEqual([])
        })

        afterAll(() => {
            expect(totalBatches > 0).toBe(expectBatches)
        })

        runBackendConformance(name, async () => {
            reset(os)
            const { backend } = await open(os)
            h.desktop.chunk.rewriteBatchReply((reply, keys) => {
                const frames = parseStore2BatchFrames(reply, keys.length)
                okKeysOfCalls.push(new Set(keys.filter((_, i) => frames[i].status === 'ok')))
                return reply
            })
            const readUnits = backend.readUnits.bind(backend)
            return {
                backend: {
                    ...backend,
                    readUnits: async (keys: readonly string[]) => {
                        const callsBefore = h.desktop.chunk.calls.length
                        const okBefore = okKeysOfCalls.length
                        const read = await readUnits(keys)
                        const slice = h.desktop.chunk.calls.slice(callsBefore)
                        const batches = slice.filter((call) => call.command === 'read_store2_units').length
                        totalBatches += batches
                        const okKeys = new Set(okKeysOfCalls.slice(okBefore).flatMap((set) => [...set]))
                        for (const call of slice) {
                            if (call.command === 'read_range' && keys.length >= 2 && okKeys.has(String(call.args.key))) {
                                violations.push(`${String(call.args.key)} was read per key after an ok frame`)
                            }
                        }
                        return read
                    },
                },
                plant: async (key, bytes) => {
                    if (key !== 'store2') {
                        h.fs.plant(key, bytes)
                    }
                },
            }
        }, { compare: 'bytes', atomicUnits: false })
    })
}

batchConformance('T4.4 tauri batch (android)', 'android', true)
batchConformance('T4.4 tauri batch (desktop)', 'windows', desktopBatches)

describe('T4.22 the per-key arm through the conformance suite', () => {
    let batches = 0

    afterAll(() => {
        expect(batches).toBe(0)
    })

    runBackendConformance('tauri per-key (desktop, knob off)', async () => {
        reset('windows')
        setKnob('off')
        const { backend } = await open('windows')
        return {
            backend: {
                ...backend,
                readUnits: async (keys: readonly string[]) => {
                    const read = await backend.readUnits(keys)
                    batches += batchCalls().length
                    h.desktop.chunk.calls.length = 0
                    return read
                },
            },
            plant: async (key, bytes) => {
                if (key !== 'store2') {
                    h.fs.plant(key, bytes)
                }
            },
        }
    }, { compare: 'bytes', atomicUnits: false })
})
