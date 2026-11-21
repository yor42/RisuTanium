// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: {} },
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
        MobileGUI: writable(false),
        loadedStore: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))
vi.mock(import('src/ts/process/index.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return { doingChat: writable(false) } as unknown as typeof import('src/ts/process/index.svelte')
})
vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
    alertConfirm: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    markIdentitySeen: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))
vi.mock(import('src/ts/characters'), () => ({
    characterFormatUpdate: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: vi.fn(async () => ({
        read: async () => ({ bytes: null, version: null }),
        has: async () => false,
    })),
}) as unknown as typeof import('src/ts/storage/store/appStore'))

import { chaIdOf, chars, parsedKey, runLoopOver, until, type LoopHandle } from './lineFixtures'
import { bootB, ffSetup, ffTeardown, ffWorld, runLoopWorld, signal, sleepMs, type PageB } from './ffFixtures'
import { isColdStub } from 'src/ts/storage/store2/codec'
import { createFastForward } from 'src/ts/storage/store2/fastForward'
import { defaultKeyEnv } from 'src/ts/storage/store2/format'
import { fakeLists } from './codecFixtures'
import type { Store2Backend } from 'src/ts/storage/store2/backend/types'
import type { FastForwardFrame, FastForwardPort } from 'src/ts/storage/store2/fastForward'

/**
 * The fast-forward's deferral and its safety net over the real save loop: a record that changes a send's view waits for
 * the send, a swap waits for a busy action, and a plan that would write back what was taken from a peer is not
 * committed: the page asks once and the question stays until it is answered.
 */

let hostHandle: ReturnType<typeof ffSetup>

beforeEach(() => {
    hostHandle = ffSetup()
})

afterEach(() => {
    ffTeardown()
})

async function caughtUp(b: PageB, memory: Parameters<typeof parsedKey>[0], timeoutMs = 8000): Promise<void> {
    await until(async () => b.context.encoder.manifestKey === (await parsedKey(memory)).current?.key, 'the page to take the peer tree', timeoutMs)
}

async function commitOwnEdit(loop: LoopHandle, b: PageB, index: number, text: string): Promise<void> {
    const before = loop.state.saved
    chars(b.db)[index].personality = text
    loop.mark(chaIdOf(b.db, index))
    await until(() => loop.state.saved > before, 'the own commit', 4000)
}

describe('deferral', () => {
    test('G1 a persona record taken from a peer waits for a running send, then applies', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const loop = runLoopOver(b.context, b.db)
        hostHandle.host.state.sending = true
        await page.commitEdit((db) => {
            Reflect.set(db, 'personas', [{ name: 'A', note: '' }, { name: 'B', note: '' }])
            Reflect.set(db, 'selectedPersona', 1)
        })
        signal(loop)
        await sleepMs(300)
        expect(Reflect.get(b.db, 'selectedPersona')).not.toBe(1)
        expect(b.context.encoder.manifestKey).not.toBe((await parsedKey(memory)).current?.key)
        expect(b.peer.asked).toEqual([])
        hostHandle.host.state.sending = false
        await caughtUp(b, memory)
        expect(Reflect.get(b.db, 'selectedPersona')).toBe(1)
        expect(b.peer.asked).toEqual([])
        expect(b.peer.clean).toEqual([])
    })

    test('G2 a character the peer changed is swapped for its stub only when no busy action is in flight', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const loop = runLoopOver(b.context, b.db)
        hostHandle.host.state.busy = true
        await page.commitEdit((db) => { chars(db)[3].personality = 'peer edit' })
        signal(loop)
        await sleepMs(300)
        expect(isColdStub(chars(b.db)[3])).toBe(false)
        hostHandle.host.state.busy = false
        await caughtUp(b, memory)
        expect(isColdStub(chars(b.db)[3])).toBe(true)
    })

    test('G2b a busy action that never ends parks the page as busy-stuck once two hours have passed, with nothing applied', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        try {
            const { memory, page } = await ffWorld()
            const b = await bootB(memory)
            const loop = runLoopOver(b.context, b.db)
            hostHandle.host.state.busy = true
            await page.commitEdit((db) => { chars(db)[3].personality = 'peer edit' })
            signal(loop)
            await sleepMs(300)
            expect(b.peer.clean).toEqual([])
            vi.setSystemTime(Date.now() + 2 * 60 * 60_000 + 1000)
            await until(() => b.peer.clean.length >= 1, 'the busy-stuck park', 6000)
            expect(isColdStub(chars(b.db)[3])).toBe(false)
            expect(b.context.encoder.manifestKey).not.toBe((await parsedKey(memory)).current?.key)
            expect(loop.crashed).toEqual([])
        } finally {
            vi.useRealTimers()
        }
    })

    test('G2c the cap restarts after a park: a busy deferral that follows one that ended in a park counts from its own start', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        try {
            const { memory, page } = await ffWorld()
            const b = await bootB(memory)
            const fastForward = createFastForward({ backend: memory, kind: 'node', lists: fakeLists, env: defaultKeyEnv })
            await page.commitEdit((db) => { chars(db)[3].personality = 'peer edit' })
            const port = (): FastForwardPort => ({ getDatabase: () => b.db, now: () => Date.now() })
            const frame = async (): Promise<FastForwardFrame> => ({
                read: await memory.readCommit(),
                key: await parsedKey(memory),
                baseKey: b.context.encoder.manifestKey,
                encoder: b.context.encoder,
                port: port(),
                snapshot: null,
            })
            hostHandle.host.state.busy = true
            expect((await fastForward.run(await frame())).kind).toBe('deferred')
            hostHandle.host.state.busy = false
            // A same-record conflict ends the deferral in a park: this page and the peer changed the same card.
            const original = chars(b.db)[3].personality
            chars(b.db)[3].personality = 'my edit'
            expect((await fastForward.run(await frame())).kind).toBe('park')
            chars(b.db)[3].personality = original
            vi.setSystemTime(Date.now() + 3 * 60 * 60_000)
            hostHandle.host.state.busy = true
            expect((await fastForward.run(await frame())).kind).toBe('deferred')
        } finally {
            vi.useRealTimers()
        }
    })

    test('G3 a character in use here is never swapped: a peer body change is merged into the same full character', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const loop = runLoopOver(b.context, b.db)
        hostHandle.host.state.inUse.add(chaIdOf(b.db, 3))
        await page.commitEdit((db) => { chars(db)[3].personality = 'peer edit' })
        signal(loop)
        await caughtUp(b, memory)
        expect(isColdStub(chars(b.db)[3])).toBe(false)
        expect(chars(b.db)[3].personality).toBe('peer edit')
        expect(b.peer.clean).toEqual([])
    })

    test('G3b a character in use here parks when this page changed the same record, and stays a full character with its edit', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const loop = runLoopOver(b.context, b.db)
        hostHandle.host.state.inUse.add(chaIdOf(b.db, 3))
        chars(b.db)[3].personality = 'my edit'
        await page.commitEdit((db) => { chars(db)[3].personality = 'peer edit' })
        signal(loop)
        await until(() => b.peer.clean.length >= 1 || b.peer.asked.length >= 1, 'the notice', 4000)
        expect(isColdStub(chars(b.db)[3])).toBe(false)
        expect(chars(b.db)[3].personality).toBe('my edit')
    })

    test('G1b a send that outlasts 30 s shows the waiting line without stopping saving, and the apply clears it', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        try {
            const { memory, page } = await ffWorld()
            const b = await bootB(memory)
            const loop = runLoopWorld(b.context, b.db)
            hostHandle.host.state.sending = true
            await page.commitEdit((db) => { Reflect.set(db, 'selectedPersona', 1) ; Reflect.set(db, 'personas', [{ name: 'A' }, { name: 'B' }]) })
            signal(loop)
            await sleepMs(200)
            vi.setSystemTime(Date.now() + 31_000)
            await until(() => loop.peerWaiting, 'the waiting line', 5000)
            hostHandle.host.state.sending = false
            await caughtUp(b, memory)
            expect(loop.peerWaiting).toBe(false)
            expect(loop.state.stopped).toBe('')
        } finally {
            vi.useRealTimers()
        }
    })
})

describe('gates', () => {
    /** The fast-forward run by hand over a booted page, to test its gates and its read without the loop. */
    async function frameOver(b: PageB, memory: Parameters<typeof parsedKey>[0], overrides: Partial<FastForwardFrame> = {}, replyOwners: () => ReadonlySet<string> = () => new Set()): Promise<FastForwardFrame> {
        const key = await parsedKey(memory)
        const port: FastForwardPort = { getDatabase: () => b.db, replyOwners, now: () => Date.now() }
        return { read: await memory.readCommit(), key, baseKey: b.context.encoder.manifestKey, encoder: b.context.encoder, port, snapshot: null, ...overrides }
    }

    test('G5a an attempt of unknown outcome is never fast-forwarded over', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        await page.commitEdit((db) => { db.temperature = 31 })
        const fastForward = createFastForward({ backend: memory, kind: 'node', lists: fakeLists, env: defaultKeyEnv })
        const frame = await frameOver(b, memory, { encoder: Object.create(b.context.encoder, { pendingKey: { value: 'pending-attempt' } }) })
        expect(await fastForward.run(frame)).toEqual({ kind: 'park', reason: 'pending' })
    })

    test('G16 a base that moved since the judge parks with nothing applied', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        await page.commitEdit((db) => { db.temperature = 31 })
        const fastForward = createFastForward({ backend: memory, kind: 'node', lists: fakeLists, env: defaultKeyEnv })
        const frame = await frameOver(b, memory, { baseKey: 'another-manifest' })
        expect(await fastForward.run(frame)).toEqual({ kind: 'park', reason: 'base-moved' })
        expect(b.db.temperature).not.toBe(31)
    })

    test('G17c a commit key that moved while the units were read is read again once, and applied', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const stale = await memory.readCommit()
        await page.commitEdit((db) => { db.temperature = 31 })
        let staleOnce = true
        const backend: Store2Backend = {
            ...memory,
            readUnits: keys => memory.readUnits(keys),
            readCommit: async () => {
                if (staleOnce) {
                    staleOnce = false
                    return stale
                }
                return memory.readCommit()
            },
        }
        const fastForward = createFastForward({ backend, kind: 'node', lists: fakeLists, env: defaultKeyEnv })
        expect(await fastForward.run(await frameOver(b, memory))).toEqual({ kind: 'applied' })
    })

    test('G17d a deferred fast-forward reads the peer\'s units once, not at every attempt', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        await page.commitEdit((db) => { Reflect.set(db, 'selectedPersona', 1) ; Reflect.set(db, 'personas', [{ name: 'A' }, { name: 'B' }]) })
        let unitReads = 0
        const backend: Store2Backend = { ...memory, readUnits: async (keys) => { unitReads += 1; return memory.readUnits(keys) }, readCommit: () => memory.readCommit() }
        const fastForward = createFastForward({ backend, kind: 'node', lists: fakeLists, env: defaultKeyEnv })
        hostHandle.host.state.sending = true
        const frame = await frameOver(b, memory)
        expect((await fastForward.run(frame)).kind).toBe('deferred')
        const afterFirst = unitReads
        expect((await fastForward.run(frame)).kind).toBe('deferred')
        expect(unitReads).toBe(afterFirst)
    })

    test('R9d a deferral over a reply owner does not settle while the owner is listed, though no send runs', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        await page.commitEdit((db) => { Reflect.set(db, 'selectedPersona', 1) ; Reflect.set(db, 'personas', [{ name: 'A' }, { name: 'B' }]) })
        const fastForward = createFastForward({ backend: memory, kind: 'node', lists: fakeLists, env: defaultKeyEnv })
        let owners: ReadonlySet<string> = new Set(['someone'])
        const outcome = await fastForward.run(await frameOver(b, memory, {}, () => owners))
        expect(outcome.kind).toBe('deferred')
        if (outcome.kind !== 'deferred') {
            return
        }
        let settled = false
        void outcome.settled.then(() => { settled = true })
        await sleepMs(1500)
        expect(settled).toBe(false)
        owners = new Set()
        await outcome.settled
    })
    test('G6 a page that is not a node page never fast-forwards', async () => {
        const fastForward = createFastForward({ backend: (await ffWorld()).memory, kind: 'tauri', lists: fakeLists, env: defaultKeyEnv })
        const outcome = await fastForward.run({} as never)
        expect(outcome).toEqual({ kind: 'park', reason: 'kind' })
    })
})

describe('guard B and the ff-revert park', () => {
    test('G11 a Node page offers Reload and Export this tab first on an ff-revert park', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const loop = runLoopOver(b.context, b.db)
        const original = b.db.temperature
        await page.commitEdit((db) => { db.temperature = 123 })
        signal(loop)
        await caughtUp(b, memory)
        b.db.temperature = original
        loop.mark(chaIdOf(b.db, 0))
        await until(() => b.peer.asked.length >= 1, 'the ff-revert question', 4000)
        expect(b.peer.asked[0]).toMatchObject({ reason: 'ff-revert', saveMineUnavailable: 'node' })
        expect(b.peer.asked[0].offers).toEqual(['reload', 'export-first'])
    })

    test('G12 a value the person sets to something new is never a revert', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const loop = runLoopOver(b.context, b.db)
        await page.commitEdit((db) => { db.temperature = 123 })
        signal(loop)
        await caughtUp(b, memory)
        b.db.temperature = 77
        loop.mark(chaIdOf(b.db, 0))
        await until(() => loop.state.saved >= 1, 'the own commit', 4000)
        expect(b.peer.asked).toEqual([])
        await commitOwnEdit(loop, b, 1, 'another edit')
    })
})
