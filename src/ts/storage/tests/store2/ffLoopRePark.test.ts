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

import { chaIdOf, chars, until } from './lineFixtures'
import { bootB, ffSetup, ffTeardown, ffWorld, runLoopWorld, signal, sleepMs } from './ffFixtures'

/**
 * A clean park that a newer peer commit replaces. The clean notice is shown again when the offers change (a clean page
 * whose descent became unproven is offered the export), and a dialog built for the older park never reloads over the
 * newer one.
 */

let hostHandle: ReturnType<typeof ffSetup>

beforeEach(() => {
    hostHandle = ffSetup()
})

afterEach(() => {
    ffTeardown()
})

/** Page B parked clean on a fast-forward park (a character in use), then a peer save over a stale plan replaces that park. */
async function reparkedClean(realSleep = false) {
    const { memory, page } = await ffWorld()
    const b = await bootB(memory)
    const keys: Array<(() => string) | undefined> = []
    const original = b.peer.parkedClean
    b.peer.parkedClean = (prompt, live, requestReload, manifestKey) => {
        keys.push(manifestKey)
        original(prompt, live, requestReload, manifestKey)
    }
    const world = runLoopWorld(b.context, b.db, realSleep ? { sleep: (ms) => sleepMs(ms) } : {})
    hostHandle.host.state.inUse.add(chaIdOf(b.db, 3))
    const stale = await page.freeze()
    await page.commitEdit((db) => { chars(db)[3].personality = 'peer edit' })
    signal(world)
    await until(() => b.peer.clean.length >= 1, 'the first clean notice', 6000)
    await page.saveMine(stale, (db) => { chars(db)[2].personality = 'forced over a stale plan' })
    signal(world)
    return { b, world, keys }
}

describe('a clean park replaced by one with other offers', () => {
    test('P1 the new clean prompt offers the export first when the descent turned unproven', async () => {
        const { b, world } = await reparkedClean()
        await until(() => b.peer.clean.length >= 2, 'the second clean notice', 6000)
        expect(b.peer.clean[0].offers).toEqual(['reload'])
        expect(b.peer.clean[1].offers).toEqual(['reload', 'export-first'])
        expect(world.crashed).toEqual([])
    })

    test('P2 a Reload pressed on the older dialog after the newer park was judged is answered moved, and the newer dialog answers clean', async () => {
        const { b, world } = await reparkedClean(true)
        await until(() => b.peer.clean.length >= 2, 'the second clean notice', 6000)
        expect(await b.peer.requests[0]()).toBe('moved')
        expect(await b.peer.requests[1]()).toBe('clean')
        expect(world.crashed).toEqual([])
    })

    test('P4 a Reload pressed on the older dialog in the turn the re-park is heard is answered moved, not clean', async () => {
        const { memory, page } = await ffWorld()
        const b = await bootB(memory)
        const world = runLoopWorld(b.context, b.db, { sleep: (ms) => sleepMs(ms) })
        hostHandle.host.state.inUse.add(chaIdOf(b.db, 3))
        const stale = await page.freeze()
        await page.commitEdit((db) => { chars(db)[3].personality = 'peer edit' })
        signal(world)
        await until(() => b.peer.clean.length >= 1, 'the first clean notice', 6000)
        await page.saveMine(stale, (db) => { chars(db)[2].personality = 'forced over a stale plan' })
        signal(world)
        expect(await b.peer.requests[0]()).toBe('moved')
        expect(world.crashed).toEqual([])
    })

    test('P3 the clean notice hands the seam a manifest key that is the encoder\'s own', async () => {
        const { b, world, keys } = await reparkedClean()
        await until(() => keys.length >= 1, 'the clean notice', 6000)
        for (const key of keys) {
            expect(key).toBeDefined()
            expect(key?.()).toBe(b.context.encoder.manifestKey)
        }
        expect(world.crashed).toEqual([])
    })
})
